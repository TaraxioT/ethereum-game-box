// The live smoke test, against Sepolia (LIVE=1). It runs against the deployed Workers, or, with LIVE_DEV=1, against
// both Workers under `wrangler dev`. It claims a fresh test name, waits for a heartbeat, opens a pop-up and reports a
// result, checks each through the Universal Resolver with stock viem at the receipt's block, and prints the
// Etherscan links. It spends real Sepolia ETH from the relayer (about 0.02 ETH at a 2 gwei tip).
//
// Needs SEPOLIA_RPC_URL (and for LIVE_DEV, DEMO_BOX_P256_KEY and the `sepolia-relayer` keystore).

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type DemoBoxView,
  type RelayerHealth,
  type ReportResponse,
  type TxView,
  claimNameTypedData,
  contractAddress,
  fullName,
  popupLabel,
  titleName,
} from '@egb/shared/names';
import { type Address, createPublicClient, formatEther, http, isAddressEqual, parseEther } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DEPLOYED = {
  relayer: 'https://gamebox-relayer.mathew.workers.dev',
  demoBox: 'https://gamebox-demo-box.mathew.workers.dev',
};
const MIN_BALANCE = parseEther('0.1');

const rpcUrl = process.env.SEPOLIA_RPC_URL;
if (!rpcUrl) throw new Error('SEPOLIA_RPC_URL is not set');
const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

const urls = { ...DEPLOYED };
const workers: ChildProcess[] = [];
let secrets: string | undefined;
const report: string[] = [];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Errors from fetch can carry the URL; ours are public, but keep the RPC out of anything printed. */
const redact = (text: string) => text.split(rpcUrl).join('<rpc>');

async function call<T>(base: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T };
}

/** Polls `GET /tx/:id` until the request is `done` (or fails the test). */
async function done(id: string, what: string): Promise<TxView> {
  for (let i = 0; i < 90; i++) {
    const { body } = await call<TxView>(urls.relayer, `/tx/${id}`);
    if (body.status === 'failed') throw new Error(`${what} failed: ${body.error}`);
    if (body.status === 'done') {
      report.push(`${what.padEnd(22)} gas ${String(body.gasUsed).padStart(9)}  ${body.etherscan}`);
      return body;
    }
    await sleep(4000);
  }
  throw new Error(`${what} is not done after 6 minutes`);
}

async function waitFor(url: string) {
  for (let i = 0; i < 60; i++) {
    if (await fetch(url).then(() => true, () => false)) return;
    await sleep(1000);
  }
  throw new Error(`${url} did not start`);
}

function startDev(dir: string, port: number, env: Record<string, string>) {
  const file = join(secrets!, `${port}.env`);
  writeFileSync(file, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n'), { mode: 0o600 });
  const worker = spawn(
    'wrangler',
    ['dev', '--port', String(port), '--env-file', file, '--persist-to', join(secrets!, `state-${port}`), '--log-level', 'warn'],
    { cwd: fileURLToPath(new URL(dir, import.meta.url)), stdio: 'ignore' },
  );
  workers.push(worker);
}

beforeAll(async () => {
  if (!process.env.LIVE_DEV) return;
  secrets = mkdtempSync(join(tmpdir(), 'egb-smoke-'));
  const relayerKey = execFileSync('cast', ['wallet', 'private-key', '--account', 'sepolia-relayer', '--password', ''], {
    encoding: 'utf8',
  }).trim();
  const origins = 'https://gamebox-names.pages.dev,http://localhost:*';
  startDev('../../', 8787, { RELAYER_PRIVATE_KEY: relayerKey, SEPOLIA_RPC_URL: rpcUrl, ALLOWED_ORIGINS: origins });
  await waitFor('http://localhost:8787/health');
  startDev('../../../demo-box/', 8788, {
    DEMO_BOX_P256_KEY: process.env.DEMO_BOX_P256_KEY ?? '',
    SEPOLIA_RPC_URL: rpcUrl,
    RELAYER_URL: 'http://localhost:8787',
    ALLOWED_ORIGINS: origins,
  });
  await waitFor('http://localhost:8788/box');
  Object.assign(urls, { relayer: 'http://localhost:8787', demoBox: 'http://localhost:8788' });
}, 120_000);

afterAll(() => {
  for (const worker of workers) worker.kill();
  if (secrets) rmSync(secrets, { recursive: true, force: true });
  console.log(`\nSmoke test against ${urls.relayer} and ${urls.demoBox}\n${report.join('\n')}\n`);
});

describe('the Game Box names, live on Sepolia', () => {
  const badge = privateKeyToAccount(generatePrivateKey());
  const label = `smoke-${Date.now().toString(36)}`;
  const start = Math.floor(Date.now() / 1000);

  it('has a funded relayer', async () => {
    const { body } = await call<RelayerHealth>(urls.relayer, '/health');
    report.push(`relayer ${body.address} holds ${formatEther(BigInt(body.balance))} ETH, head ${body.block}`);
    expect(BigInt(body.balance), 'the relayer needs funding before the live test').toBeGreaterThanOrEqual(MIN_BALANCE);
  });

  it('refuses a forged claim with no gas spent', async () => {
    const deadline = BigInt(start + 600);
    const forger = privateKeyToAccount(generatePrivateKey());
    const signature = await forger.signTypedData(
      claimNameTypedData({ label, badge: badge.address, deadline }, contractAddress('GameBoxNames')),
    );
    const res = await call<{ error: string }>(urls.relayer, '/names/claim', {
      label,
      badge: badge.address,
      deadline: String(deadline),
      signature,
    });
    expect(res.status).toBe(401);
  });

  it('claims a fresh player name', async () => {
    const deadline = BigInt(start + 600);
    const signature = await badge.signTypedData(
      claimNameTypedData({ label, badge: badge.address, deadline }, contractAddress('GameBoxNames')),
    );
    const res = await call<TxView>(urls.relayer, '/names/claim', {
      label,
      badge: badge.address,
      deadline: String(deadline),
      signature,
    });
    expect(res.status, redact(JSON.stringify(res.body))).toBe(202);
    const tx = await done(res.body.id, `claim ${label}`);
    const address = await client.getEnsAddress({ name: fullName(label), blockNumber: BigInt(tx.block!) });
    expect(address).toBe(badge.address);
  });

  it('sends a heartbeat for mumbai-01', async () => {
    let view: DemoBoxView | undefined;
    for (let i = 0; i < 80 && !(view && view.lastSeen !== null && view.lastSeen >= start); i++) {
      if (i > 0) await sleep(5000);
      view = (await call<DemoBoxView>(urls.demoBox, '/box')).body;
    }
    expect(view?.lastSeen, 'no heartbeat within 6.5 minutes').toBeGreaterThanOrEqual(start);
    const txs = await Promise.all(view!.heartbeat.map((id, i) => done(id, `heartbeat write ${i + 1}`)));
    const block = BigInt(Math.max(...txs.map((tx) => tx.block!)));
    const lastSeen = await client.getEnsText({ name: fullName(view!.label), key: 'lastSeen', blockNumber: block });
    expect(Number(lastSeen)).toBeGreaterThanOrEqual(view!.lastSeen!);
  });

  it('opens a pop-up Box', async () => {
    const popup = `s${Date.now().toString(36).slice(-6)}`;
    const res = await call<TxView>(urls.relayer, '/box/popup', { label: popup });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const tx = await done(res.body.id, `pop-up ${popup}`);
    const name = fullName(popupLabel(popup));
    const blockNumber = BigInt(tx.block!);
    const account = await client.getEnsAddress({ name, blockNumber });
    expect(isAddressEqual(account!, contractAddress('DemoBoxAccount'))).toBe(true);
    expect(await client.getEnsText({ name, key: 'status', blockNumber })).toBe('active');
  });

  it('reports a result: the stats and the title move', async () => {
    const loser = (await client.getEnsAddress({ name: fullName('bot') })) as Address;
    expect(loser, 'bot.gamebox.eth must resolve').toBeTruthy();
    const res = await call<ReportResponse>(urls.demoBox, '/result', {
      box: 'mumbai-01',
      game: 'quickdraw',
      winner: badge.address,
      loser,
      draw: false,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const tx = await done(res.body.id, `result round ${res.body.round}`);
    const blockNumber = BigInt(tx.block!);
    const stats = await client.getEnsText({ name: fullName(label), key: 'stats', blockNumber });
    expect(JSON.parse(stats!)).toMatchObject({ quickdraw: { wins: 1, losses: 0 } });
    const champion = await client.getEnsAddress({ name: titleName('quickdraw'), blockNumber });
    expect(champion).toBe(badge.address);
  });
});
