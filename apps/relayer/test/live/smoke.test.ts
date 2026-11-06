// The live smoke test, against Sepolia (LIVE=1). It runs against the deployed Workers, or, with LIVE_DEV=1, against
// both Workers under `wrangler dev`. It claims two fresh test names (one with its primary name), waits for a
// heartbeat, opens a pop-up, tops both players up with USDC (one by its ENS name), opens a 10 USDC pot through
// demo-01, and reports the match through demo-01. It checks each at the receipt's block, straight from the contracts
// and each name's own resolver, and, once `gamebox.eth` points at our registry, through the Universal Resolver with
// stock viem: the pot paid the winner, the title moved, and the championship's standings changed. It prints the
// Etherscan links and the gas, and spends real Sepolia ETH from the relayer (about 0.03 ETH at 2 gwei).
//
// Needs SEPOLIA_RPC_URL. LIVE_DEV also needs the `sepolia-deployer` keystore, and DEMO_BOX_P256_KEY and AGENT_P256_KEY in
// the environment: those keys live only as the demo Box Worker's secrets, so a local run uses test keys of its own.
// The heartbeat, pot and result steps need demo-01 registered with the demo Box's key, the pop-up step mumbai-01, and
// the standings step an open championship on stockduel (the test says so if its window has passed).

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CUP_KEYS,
  type DemoBoxView,
  PARENT_NAME,
  type RelayerHealth,
  type ReportResponse,
  type TxView,
  boxResultsAbi,
  championshipName,
  championshipsAbi,
  claimNameTypedData,
  contractAddress,
  duelPotAbi,
  ensAddress,
  fakeUsdcAbi,
  formatUsdc,
  fullName,
  gameBoxNamesAbi,
  parseStandings,
  permissionedRegistryAbi,
  permissionedResolverAbi,
  popupLabel,
  primaryNameMessage,
  resolverProfilesAbi,
  stakeDigest,
  titleName,
  usdc,
} from '@egb/shared/names';
import { p256 } from '@noble/curves/nist.js';
import {
  type Address,
  bytesToHex,
  createPublicClient,
  hexToBytes,
  parseEventLogs,
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
/** Below this, the deployer needs funding, and the test stops before spending anything. */
const MIN_BALANCE = parseEther('0.5');
/** The demo Box's Box, and the game and stake of its match. */
const DEMO_BOX = 'demo-01';
const GAME = 'stockduel';
const STAKE = usdc(10);

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
  const rival = privateKeyToAccount(generatePrivateKey());
  const label = `smoke-${Date.now().toString(36)}`;
  const rivalLabel = `${label}-b`;
  const token = { address: contractAddress('FakeUSDC'), abi: fakeUsdcAbi } as const;
  const pot = { address: contractAddress('DuelPot'), abi: duelPotAbi } as const;
  const cups = { address: contractAddress('Championships'), abi: championshipsAbi } as const;
  const balanceOf = (player: Address, blockNumber?: bigint) =>
    client.readContract({ ...token, functionName: 'balanceOf', args: [player], blockNumber });
  /** The pot demo-01 opened, once it has. */
  let round: bigint | undefined;
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

  /** Claims `<label>.gamebox.eth` for `who` through `/names/claim`, optionally with its primary name. */
  async function claim(who: typeof badge, name: string, primary: boolean): Promise<TxView> {
    const deadline = BigInt(start + 600);
    const expiry = BigInt(start + 1800);
    const raw = primaryNameMessage({ badge: who.address, name: fullName(name), expiry }, ensAddress('DefaultReverseRegistrar'));
    const res = await call<TxView>(urls.relayer, '/names/claim', {
      label: name,
      badge: who.address,
      deadline: String(deadline),
      signature: await who.signTypedData(claimNameTypedData({ label: name, badge: who.address, deadline }, names.address)),
      ...(primary && { primaryName: { expiry: String(expiry), signature: await who.signMessage({ message: { raw } }) } }),
    });
    expect(res.status, redact(JSON.stringify(res.body))).toBe(202);
    return done(res.body.id, `claim ${name}`);
  }

  it("claims two fresh player names, and sets the first as its badge's primary name", async () => {
    const [tx] = await Promise.all([claim(badge, label, true), claim(rival, rivalLabel, false)]);
    expect(tx.primaryName?.status).toBe('done');
    const name = fullName(label);
    const blockNumber = BigInt(tx.block!);
    expect(await client.readContract({ ...names, functionName: 'labelOf', args: [badge.address], blockNumber })).toBe(label);
    expect(await registryRead('getOwner', label, blockNumber)).toBe(badge.address);
    const resolver = await registryRead('getResolver', label, blockNumber);
    expect(await record(resolver, name, 'stats', blockNumber)).toBe('');
    expect(await client.readContract({ ...names, functionName: 'labelOf', args: [rival.address] })).toBe(rivalLabel);
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

  it('sends a heartbeat for demo-01', async () => {
    let view: DemoBoxView | undefined;
    for (let i = 0; i < 80 && !(view && view.lastSeen !== null && view.lastSeen >= start); i++) {
      if (i > 0) await sleep(5000);
      view = (await call<DemoBoxView>(urls.demoBox, '/box')).body;
    }
    expect(view?.lastSeen, 'no heartbeat within 6.5 minutes').toBeGreaterThanOrEqual(start);
    expect(view!.label).toBe(DEMO_BOX);
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

  it('tops both players up with 100 USDC, one by its ENS name, and refuses a second top-up', async () => {
    const byName = resolvable ? fullName(rivalLabel) : rival.address;
    const [first, second] = await Promise.all(
      [badge.address, byName].map((player) => call<TxView>(urls.relayer, '/usdc/topup', { player })),
    );
    expect(first!.status, JSON.stringify(first!.body)).toBe(202);
    expect(second!.status, JSON.stringify(second!.body)).toBe(202);
    const txs = await Promise.all([done(first!.body.id, 'top-up by address'), done(second!.body.id, `top-up by ${byName}`)]);
    const blockNumber = BigInt(Math.max(...txs.map((tx) => tx.block!)));
    expect(await balanceOf(badge.address, blockNumber)).toBe(usdc(100));
    expect(await balanceOf(rival.address, blockNumber)).toBe(usdc(100));
    const again = await call<{ error: string }>(urls.relayer, '/usdc/topup', { player: badge.address });
    expect(again.status, again.body.error).toBe(409);
  });

  it('refuses a stake signed by a key that is not the Box\'s, with no gas spent', async () => {
    const stake = { box: DEMO_BOX, game: GAME, round: 1n << 64n, a: badge.address, b: rival.address, amount: STAKE, deadline: BigInt(start + 600) };
    const signature = p256.sign(hexToBytes(stakeDigest(stake, pot.address)), p256.utils.randomSecretKey(), { prehash: false, lowS: true });
    const res = await call<{ error: string }>(urls.relayer, '/duel/open', {
      stake: { ...stake, round: String(stake.round), amount: String(stake.amount), deadline: String(stake.deadline) },
      r: bytesToHex(signature.subarray(0, 32)),
      s: bytesToHex(signature.subarray(32)),
    });
    expect(res.status, res.body.error).toBe(401);
  });

  it('opens a 10 USDC pot through demo-01', async () => {
    const res = await call<ReportResponse>(urls.demoBox, '/stake', {
      box: DEMO_BOX,
      game: GAME,
      a: badge.address,
      b: rival.address,
      amount: String(STAKE),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    round = BigInt(res.body.round);
    const tx = await done(res.body.id, `pot ${DEMO_BOX} round ${round}`);
    const blockNumber = BigInt(tx.block!);
    const opened = await client.readContract({ ...pot, functionName: 'getPot', args: [DEMO_BOX, round], blockNumber });
    expect(opened).toMatchObject({ a: badge.address, b: rival.address, amount: STAKE, state: 1 });
    expect(await balanceOf(badge.address, blockNumber)).toBe(usdc(90));
    expect(await balanceOf(rival.address, blockNumber)).toBe(usdc(90));
    report.push(`pot opened: both players 100 -> 90 USDC, the pot holds ${formatUsdc(2n * STAKE)}`);
  });

  it('reports the match through demo-01: the pot pays the winner, the title moves, the standings change', async () => {
    expect(round, 'the pot step ran').toBeDefined();
    const cupId = await client.readContract({ ...cups, functionName: 'openCup', args: [GAME] });
    const cup = cupId === 0n ? undefined : await client.readContract({ ...cups, functionName: 'getCup', args: [cupId] });
    const cupName = cup && championshipName(cup.label, GAME);
    const standingsAt = (blockNumber: bigint) => record(cup!.resolver, cupName!, CUP_KEYS.standings, blockNumber);
    const before = await client.getBlockNumber();
    const titleBefore = await client.readContract({ ...names, functionName: 'getTitle', args: [GAME], blockNumber: before });
    const standingsBefore = cup ? await standingsAt(before) : undefined;

    const res = await call<ReportResponse>(urls.demoBox, '/result', {
      box: DEMO_BOX,
      game: GAME,
      winner: badge.address,
      loser: rival.address,
      draw: false,
      round: String(round),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(BigInt(res.body.round)).toBe(round);
    const tx = await done(res.body.id, `result ${DEMO_BOX} round ${round}`);
    const blockNumber = BigInt(tx.block!);

    // The pot paid the winner both stakes.
    const settled = await client.readContract({ ...pot, functionName: 'getPot', args: [DEMO_BOX, round!], blockNumber });
    expect(settled.state).toBe(2);
    expect(await balanceOf(badge.address, blockNumber)).toBe(usdc(110));
    expect(await balanceOf(rival.address, blockNumber)).toBe(usdc(90));
    report.push(`pot settled: the winner 90 -> 110 USDC (+${formatUsdc(2n * STAKE)}), the loser stays at 90`);

    // The title moved to the winner.
    const title = await client.readContract({ ...names, functionName: 'getTitle', args: [GAME], blockNumber });
    expect(title.holder).toBe(badge.address);
    report.push(`${titleName(GAME)}: ${titleBefore.holder} -> ${title.holder}, streak ${title.streak}`);
    const resolver = await registryRead('getResolver', label, blockNumber);
    expect(JSON.parse(await record(resolver, fullName(label), 'stats', blockNumber))).toMatchObject({ [GAME]: { wins: 1, losses: 0 } });
    if (resolvable) expect(await client.getEnsAddress({ name: titleName(GAME), blockNumber })).toBe(badge.address);

    // The championship scored it, if one is open.
    const receipt = await client.getTransactionReceipt({ hash: tx.hash! });
    const skipped = parseEventLogs({ abi: boxResultsAbi, eventName: 'ScoreSkipped', logs: receipt.logs });
    expect(skipped, 'the championship skipped this result').toHaveLength(0);
    const block = await client.getBlock({ blockNumber });
    if (!cup || block.timestamp >= cup.ends) {
      report.push(`standings: no open championship on ${GAME} at block ${blockNumber}${cup ? ` (${cupName} ended at ${cup.ends})` : ''}; not checked`);
      return;
    }
    const standingsAfter = await standingsAt(blockNumber);
    expect(standingsAfter).not.toBe(standingsBefore);
    const rows = parseStandings(standingsAfter);
    expect(rows.find((row) => row.addr === badge.address)).toMatchObject({ name: fullName(label), points: 3, wins: 1 });
    expect(await record(cup.resolver, cupName!, CUP_KEYS.leader, blockNumber)).toBe(rows[0]!.name);
    report.push(`${cupName} standings: ${standingsBefore} -> ${standingsAfter}`);
  });
});
