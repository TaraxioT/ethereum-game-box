// The live smoke test, against Sepolia (LIVE=1). It runs against the deployed Workers, or, with LIVE_DEV=1, against
// both Workers under `wrangler dev`. It claims a fresh test name with its primary name, waits for a heartbeat, opens
// a pop-up and reports a result. It checks each at the receipt's block, straight from the registry and each name's
// own resolver, and, once `gamebox.eth` points at our registry, through the Universal Resolver with stock viem. It
// prints the Etherscan links and the gas, and spends real Sepolia ETH from the relayer (about 0.02 ETH at 2 gwei).
//
// Needs SEPOLIA_RPC_URL. LIVE_DEV also needs the `sepolia-deployer` keystore, and DEMO_BOX_P256_KEY and AGENT_P256_KEY in
// the environment: those keys live only as the demo Box Worker's secrets, so a local run uses test keys of its own.
// The heartbeat and result steps need mumbai-01 registered, and the result step needs bot.gamebox.eth claimed.

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type DemoBoxView,
  PARENT_NAME,
  type RelayerHealth,
  type ReportResponse,
  type TxView,
  claimNameTypedData,
  contractAddress,
  ensAddress,
  fullName,
  gameBoxNamesAbi,
  permissionedRegistryAbi,
  permissionedResolverAbi,
  popupLabel,
  primaryNameMessage,
  resolverProfilesAbi,
  titleName,
} from '@egb/shared/names';
import {
  type Address,
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  formatEther,
  http,
  isAddressEqual,
  labelhash,
  namehash,
  parseEther,
  toHex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { packetToBytes } from 'viem/ens';
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
/** Keep the RPC URL out of anything printed. */
const redact = (text: string) => text.split(rpcUrl).join('<rpc>');

async function call<T>(base: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T };
}

const line = (what: string, gas: string | undefined, link: string | undefined) =>
  `${what.padEnd(30)} gas ${String(gas).padStart(9)}  ${link}`;

/** Polls `GET /tx/:id` until the request is `done` (or fails the test). */
async function done(id: string, what: string): Promise<TxView> {
  for (let i = 0; i < 90; i++) {
    const { body } = await call<TxView>(urls.relayer, `/tx/${id}`);
    if (body.status === 'failed') throw new Error(`${what} failed: ${body.error}`);
    if (body.status === 'done') {
      report.push(line(what, body.gasUsed, body.etherscan));
      const step = body.primaryName;
      if (step) report.push(line(`${what}: primary name`, step.gasUsed, step.etherscan ?? step.error));
      return body;
    }
    await sleep(4000);
  }
  throw new Error(`${what} is not done after 6 minutes`);
}

async function waitFor(url: string, log: () => string) {
  for (let i = 0; i < 60; i++) {
    if (await fetch(url).then(() => true, () => false)) return;
    await sleep(1000);
  }
  throw new Error(`${url} did not start:\n${log()}`);
}

function startDev(dir: string, port: number, env: Record<string, string>) {
  const file = join(secrets!, `${port}.env`);
  writeFileSync(file, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n'), { mode: 0o600 });
  const log = openSync(join(secrets!, `${port}.log`), 'w');
  const worker = spawn(
    'wrangler',
    [
      'dev',
      ...['--port', String(port), '--inspector-port', String(port + 1000)],
      ...['--env-file', file, '--persist-to', join(secrets!, `state-${port}`)],
    ],
    { cwd: fileURLToPath(new URL(dir, import.meta.url)), stdio: ['ignore', log, log] },
  );
  workers.push(worker);
  return () => redact(readFileSync(join(secrets!, `${port}.log`), 'utf8').split('\n').slice(-15).join('\n'));
}

beforeAll(async () => {
  if (!process.env.LIVE_DEV) return;
  secrets = mkdtempSync(join(tmpdir(), 'egb-smoke-'));
  const relayerKey = execFileSync('cast', ['wallet', 'private-key', '--account', 'sepolia-deployer', '--password', ''], {
    encoding: 'utf8',
  }).trim();
  const origins = 'https://gamebox-names.pages.dev,http://localhost:*';
  const relayerLog = startDev('../../', 8917, { RELAYER_PRIVATE_KEY: relayerKey, SEPOLIA_RPC_URL: rpcUrl, ALLOWED_ORIGINS: origins });
  await waitFor('http://localhost:8917/health', relayerLog);
  const demoBoxLog = startDev('../../../demo-box/', 8918, {
    DEMO_BOX_P256_KEY: process.env.DEMO_BOX_P256_KEY ?? '',
    AGENT_P256_KEY: process.env.AGENT_P256_KEY ?? '',
    SEPOLIA_RPC_URL: rpcUrl,
    RELAYER_URL: 'http://localhost:8917',
    PUBLIC_URL: 'http://localhost:8918',
    ALLOWED_ORIGINS: origins,
  });
  await waitFor('http://localhost:8918/box', demoBoxLog);
  Object.assign(urls, { relayer: 'http://localhost:8917', demoBox: 'http://localhost:8918' });
}, 120_000);

afterAll(() => {
  for (const worker of workers) worker.kill();
  if (secrets) rmSync(secrets, { recursive: true, force: true });
  process.stdout.write(`\nSmoke test against ${urls.relayer} and ${urls.demoBox}\n${report.join('\n')}\n`);
});

describe('the Game Box names, live on Sepolia', () => {
  const badge = privateKeyToAccount(generatePrivateKey());
  const label = `smoke-${Date.now().toString(36)}`;
  const start = Math.floor(Date.now() / 1000);
  const names = { address: contractAddress('GameBoxNames'), abi: gameBoxNamesAbi } as const;
  let registry: Address;
  /** Whether `gamebox.eth` points at our registry, so its names resolve through the Universal Resolver. */
  let resolvable = false;

  const registryRead = <F extends 'getOwner' | 'getResolver'>(functionName: F, arg: string, blockNumber?: bigint) =>
    client.readContract({
      address: registry,
      abi: permissionedRegistryAbi,
      functionName,
      args: [functionName === 'getOwner' ? BigInt(labelhash(arg)) : arg],
      blockNumber,
    } as never) as Promise<Address>;

  /** A text record read straight from a name's own resolver (ENSIP-10 `resolve`), at `blockNumber`. */
  async function record(resolver: Address, name: string, key: string, blockNumber: bigint): Promise<string> {
    const data = encodeFunctionData({ abi: resolverProfilesAbi, functionName: 'text', args: [namehash(name), key] });
    const answer = await client.readContract({
      address: resolver,
      abi: permissionedResolverAbi,
      functionName: 'resolve',
      args: [toHex(packetToBytes(name)), data],
      blockNumber,
    });
    return decodeFunctionResult({ abi: resolverProfilesAbi, functionName: 'text', data: answer });
  }

  beforeAll(async () => {
    registry = await client.readContract({ ...names, functionName: 'REGISTRY' });
    const current = await client.readContract({
      address: ensAddress('ETHRegistry'),
      abi: permissionedRegistryAbi,
      functionName: 'getSubregistry',
      args: [PARENT_NAME.split('.')[0]!],
    });
    resolvable = isAddressEqual(current, registry);
    report.push(`${PARENT_NAME} ${resolvable ? 'points at' : 'does not yet point at'} our registry ${registry}`);
  });

  it('has a funded relayer', async () => {
    const { body } = await call<RelayerHealth>(urls.relayer, '/health');
    report.push(`relayer ${body.address} holds ${formatEther(BigInt(body.balance))} ETH at block ${body.block}`);
    expect(BigInt(body.balance), 'the relayer needs funding before the live test').toBeGreaterThanOrEqual(MIN_BALANCE);
  });

  it('refuses a forged claim with no gas spent', async () => {
    const deadline = BigInt(start + 600);
    const forger = privateKeyToAccount(generatePrivateKey());
    const signature = await forger.signTypedData(claimNameTypedData({ label, badge: badge.address, deadline }, names.address));
    const res = await call<{ error: string }>(urls.relayer, '/names/claim', {
      label,
      badge: badge.address,
      deadline: String(deadline),
      signature,
    });
    expect(res.status).toBe(401);
  });

  it("claims a fresh player name, and sets it as the badge's primary name", async () => {
    const deadline = BigInt(start + 600);
    const expiry = BigInt(start + 1800);
    const name = fullName(label);
    const raw = primaryNameMessage({ badge: badge.address, name, expiry }, ensAddress('DefaultReverseRegistrar'));
    const res = await call<TxView>(urls.relayer, '/names/claim', {
      label,
      badge: badge.address,
      deadline: String(deadline),
      signature: await badge.signTypedData(claimNameTypedData({ label, badge: badge.address, deadline }, names.address)),
      primaryName: { expiry: String(expiry), signature: await badge.signMessage({ message: { raw } }) },
    });
    expect(res.status, redact(JSON.stringify(res.body))).toBe(202);
    const tx = await done(res.body.id, `claim ${label}`);
    expect(tx.primaryName?.status).toBe('done');
    const blockNumber = BigInt(tx.block!);
    expect(await client.readContract({ ...names, functionName: 'labelOf', args: [badge.address], blockNumber })).toBe(label);
    expect(await registryRead('getOwner', label, blockNumber)).toBe(badge.address);
    const resolver = await registryRead('getResolver', label, blockNumber);
    expect(await record(resolver, name, 'stats', blockNumber)).toBe('');
    if (resolvable) {
      expect(await client.getEnsAddress({ name, blockNumber })).toBe(badge.address);
      const primaryBlock = BigInt(tx.primaryName!.block!);
      expect(await client.getEnsName({ address: badge.address, blockNumber: primaryBlock })).toBe(name);
    }
  });

  it('drips the new player a little ETH, once', async () => {
    const res = await call<TxView>(urls.relayer, '/names/drip', { badge: badge.address });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const tx = await done(res.body.id, 'drip');
    expect(await client.getBalance({ address: badge.address, blockNumber: BigInt(tx.block!) })).toBe(parseEther('0.0003'));
    expect((await call(urls.relayer, '/names/drip', { badge: badge.address })).status).toBe(409);
  });

  it('sends a heartbeat for mumbai-01', async () => {
    let view: DemoBoxView | undefined;
    for (let i = 0; i < 80 && !(view && view.lastSeen !== null && view.lastSeen >= start); i++) {
      if (i > 0) await sleep(5000);
      view = (await call<DemoBoxView>(urls.demoBox, '/box')).body;
    }
    expect(view?.lastSeen, 'no heartbeat within 6.5 minutes').toBeGreaterThanOrEqual(start);
    const txs = await Promise.all(view!.heartbeat.map((id, i) => done(id, `heartbeat write ${i + 1}`)));
    const blockNumber = BigInt(Math.max(...txs.map((tx) => tx.block!)));
    const name = fullName(view!.label);
    const box = await client.readContract({ ...names, functionName: 'getBox', args: [view!.label], blockNumber });
    expect(Number(await record(box.resolver, name, 'lastSeen', blockNumber))).toBeGreaterThanOrEqual(view!.lastSeen!);
    if (resolvable) {
      expect(Number(await client.getEnsText({ name, key: 'lastSeen', blockNumber }))).toBeGreaterThanOrEqual(view!.lastSeen!);
    }
  });

  it("opens a pop-up Box that serves mumbai-01's records", async () => {
    const popup = `s${Date.now().toString(36).slice(-6)}`;
    const res = await call<TxView>(urls.relayer, '/box/popup', { label: popup });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const tx = await done(res.body.id, `pop-up ${popup}`);
    const boxLabel = popupLabel(popup);
    const name = fullName(boxLabel);
    const blockNumber = BigInt(tx.block!);
    const entry = await client.readContract({ ...names, functionName: 'getPopup', args: [boxLabel], blockNumber });
    expect(entry.ofBox).toBe('mumbai-01');
    expect(Number(entry.expiry) - start).toBeLessThanOrEqual(15 * 60);
    const box = await client.readContract({ ...names, functionName: 'getBox', args: ['mumbai-01'], blockNumber });
    expect(await registryRead('getResolver', boxLabel, blockNumber)).toBe(box.resolver);
    const status = await record(box.resolver, fullName('mumbai-01'), 'status', blockNumber);
    expect(await record(box.resolver, name, 'status', blockNumber)).toBe(status);
    if (resolvable) expect(await client.getEnsText({ name, key: 'status', blockNumber })).toBe(status);
  });

  it('reports a result: the stats and the title move', async () => {
    const loser = await registryRead('getOwner', 'bot');
    expect(await client.readContract({ ...names, functionName: 'labelOf', args: [loser] }), 'bot holds its name').toBe('bot');
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
    const resolver = await registryRead('getResolver', label, blockNumber);
    const stats = await record(resolver, fullName(label), 'stats', blockNumber);
    expect(JSON.parse(stats)).toMatchObject({ quickdraw: { wins: 1, losses: 0 } });
    const title = await client.readContract({ ...names, functionName: 'getTitle', args: ['quickdraw'], blockNumber });
    expect(title.holder).toBe(badge.address);
    if (resolvable) {
      expect(await client.getEnsText({ name: fullName(label), key: 'stats', blockNumber })).toBe(stats);
      expect(await client.getEnsAddress({ name: titleName('quickdraw'), blockNumber })).toBe(badge.address);
    }
  });
});
