// `pnpm store:e2e`: the plan's "done when", as far as a laptop reaches, on real contracts, the real Workers, a real
// container and the real Box in a real browser. Only 0G and the badges are fakes. A scenario believes the chain: its
// balances and events. The scenarios share one world and run in order, and the last one stops the verifier.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { MatchLog } from '@egb/sdk';
import { type StoreIndex, packBundle } from '@egb/sdk/bundle';
import { type AgentTurn, type AuditRecord, type JudgeStatus, jsonTextHash } from '@egb/shared/store';
import { SERVING_CONTRACT } from '@egb/verifier/test/fake-zg';
import { type Address, type Hex, type Log, bytesToHex, createPublicClient, http, recoverMessageAddress } from 'viem';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { allBlocked, noSecrets } from '../../verifier/container/test/docker/probes.ts';
import { servingAbi } from '../../verifier/src/zg-chain.ts';
import { type AgentConfig, agentConfig, killAgent, runningAgents } from '../src/agents.ts';
import { type RunningBox, ageRounds } from '../src/box.ts';
import { type Ledger, STATE, ledger, showUsdc, usdc } from '../src/ledger.ts';
import { BADGES, join, judgedOf, opened, play, sign, stakeAndPlay, toHome } from '../src/match.ts';
import { outsider } from '../src/outsider.ts';
import { TAP_RUSH, publish, variantOfTapRush } from '../src/publish.ts';
import { BOX_LABEL, type World, ZG_API_KEY, startWorld } from '../src/world.ts';

/** Every match stakes this much each, in whole USDC. */
const STAKE = 10;
const POT = usdc(STAKE * BADGES.length);
/** What a run waits for a judgement: two containers and a payment. */
const JUDGE_MS = 180_000;
const SOON = { timeout: 60_000, interval: 250 };
/** The first retry of an upload comes a minute after it fails. */
const UPLOAD_RETRY = { timeout: 150_000, interval: 1000 };
/** `StorePot.REFUND_DELAY`. */
const REFUND_DELAY_S = 3600;
/** The Box's own wait: the delay and its margin, and a minute more. */
const BOX_AGES_MS = 62 * 60_000;

/**
 * What the agent's shell tries, all at once, as a shell call gets 20 seconds. `wrangler dev`'s sidecar takes every TCP
 * connection and then drops it, so a connect proves nothing here: each of these needs an answer. In a plain container with
 * the internet, all four exit 0.
 */
const WAYS_OUT = [
  `timeout 5 bash -c 'exec 3<>/dev/tcp/1.1.1.1/80; printf "GET / HTTP/1.0\\r\\n\\r\\n" >&3; head -c 1 <&3 | grep -q .'; echo "http 1.1.1.1 exit=$?"`,
  `timeout 8 node -e 'fetch("https://1.1.1.1/").then(() => process.exit(0), () => process.exit(1))'; echo "https 1.1.1.1 exit=$?"`,
  `timeout 5 getent hosts example.com; echo "dns example.com exit=$?"`,
  `timeout 8 node -e 'fetch("https://example.com").then(() => process.exit(0), () => process.exit(1))'; echo "https example.com exit=$?"`,
];

/** How long the shell stays up after its probes, so a run can read each container from Docker before it goes. */
const LOOK_SECONDS = 3;

/** Why the verifier refused a run, in its own words: every other failure refunds the same way. */
const NOT_THE_POT = 'a split does not add up to exactly the pot';
const NOT_THE_ENCLAVE = "the signature is not the enclave's";
/** A reason, as the Box and the record give it after a run and its retry. */
const bothRuns = (why: string) => `${why}; ${why}`;

/** A byte inside the first file of a zip, past its header. */
const FLIPPED_BYTE = 60;

/** Rounds an outsider opens, far from the Box's own. */
const HELD_ROUND = 1001n;
const ATTACKED_ROUND = 1002n;

let world: World;
let chain: Ledger;
let who: ReturnType<typeof outsider>;
let box: RunningBox;
let tapRush: Hex;
let sealedGame: Hex;
let unlistedGame: Hex;

const say = (line: string) => console.log(`      ${line}`);
const usdcList = (amounts: readonly bigint[]) => amounts.map(showUsdc).join(' / ');
const sha256 = (bytes: Uint8Array): Hex => bytesToHex(createHash('sha256').update(bytes).digest());

const judged = async (round: bigint) => (await (await fetch(`${world.verifierUrl}/judge/${BOX_LABEL}/${round}`)).json()) as JudgeStatus;

interface AuditView {
  readonly record: Hex | null;
  readonly root: Hex | null;
}
const audit = async (round: bigint) => (await (await fetch(`${world.verifierUrl}/audit/${BOX_LABEL}/${round}`)).json()) as AuditView;

/** Waits for the record to land, then reads it back from 0G Storage: it must be the text whose hash is on chain. */
async function recordOnStorage(round: bigint, wait = SOON): Promise<AuditRecord> {
  const { record } = await chain.pot(round);
  const { root } = await vi.waitFor(async () => {
    const view = await audit(round);
    expect(view.root).not.toBeNull();
    return view;
  }, wait);
  const text = await world.zg.file(root as Hex);
  expect(jsonTextHash(text)).toBe(record);
  say(`audit record on 0G Storage at ${root}, its keccak256 is the pot's ${record}`);
  return JSON.parse(text) as AuditRecord;
}

/** Rechecks a turn's proof as anyone can: the enclave's signature must recover to the key 0G's serving contract lists. */
async function recheckTurn({ chatId, response }: AgentTurn): Promise<void> {
  const { proof } = response as { proof: { chatId: string; provider: Address; text: string; signature: Hex } };
  expect(proof.chatId).toBe(chatId);
  const zgChain = createPublicClient({ transport: http(`${world.zg.url}/rpc`) });
  const service = await zgChain.readContract({ address: SERVING_CONTRACT, abi: servingAbi, functionName: 'getService', args: [proof.provider] });
  expect(await recoverMessageAddress({ message: proof.text, signature: proof.signature })).toBe(service.teeSignerAddress);
}

/** What 0G saw of every model call so far: only the Worker's proxy can have sent them like this. */
async function everyChatWentOutPrivate(): Promise<void> {
  const chats = await world.zg.chats();
  for (const { trustMode, authorization, body } of chats) {
    expect(trustMode).toBe('private');
    expect(authorization).toBe(`Bearer ${ZG_API_KEY}`);
    expect(body.verify_tee).toBe(true);
  }
  say(`all ${chats.length} model calls so far went out Private, with verify_tee and the Worker's key`);
}

/** The chain says each stake went back to the address it came from, and only that. */
async function stakesWentBack(event: Log | undefined, before: readonly bigint[]): Promise<void> {
  expect(event).toBeDefined();
  const paid = await chain.paidOut((event as Log).transactionHash as Hex);
  expect(paid).toEqual(BADGES.map((to) => ({ to, value: usdc(STAKE) })));
  expect(await chain.balances(BADGES)).toEqual(before);
  say(`each stake back to its address in ${event?.transactionHash}: ${usdcList(paid.map(({ value }) => value))}; balances ${usdcList(before)}`);
}

/** The Box's own view of how it ended. */
async function boxResult(): Promise<NonNullable<ReturnType<typeof judgedOf>>> {
  const state = await box.link.until(({ phase }) => phase === 'result', 'Result', JUDGE_MS);
  return judgedOf(state) as NonNullable<ReturnType<typeof judgedOf>>;
}

beforeAll(async () => {
  world = await startWorld();
  chain = ledger(world.chain, world.contracts, BOX_LABEL);
  who = outsider(world);
});

afterAll(async () => {
  await world?.stop();
});

// A scenario that failed mustn't take the rest with it.
afterEach(() => {
  world.tamper.swap = null;
});

describe('the game store, end to end', () => {
  it('publishes Tap Rush, lists it, and it reaches the rack', async () => {
    const publisher = { storeUrl: world.storeUrl, token: world.keys.publish, chainUrl: world.chain.url, deployments: world.contracts.deployments };
    const lister = { ...publisher, listerKey: world.keys.lister };

    const published = await publish(TAP_RUSH, lister);
    published.lines.forEach(say);
    tapRush = published.hash;
    expect(await chain.listed(tapRush)).toBe(true);
    expect((await chain.events.listed(tapRush)).length).toBe(1);

    sealedGame = (await publish(variantOfTapRush(path.join(world.work, 'sealed'), 'tap-rush-sealed', 'Tap Rush Sealed'), lister)).hash;
    const unlisted = await publish(variantOfTapRush(path.join(world.work, 'unlisted'), 'tap-rush-unlisted', 'Tap Rush Unlisted'), publisher);
    unlisted.lines.slice(0, 3).forEach(say);
    unlistedGame = unlisted.hash;
    expect(await chain.listed(unlistedGame)).toBe(false);

    const index = (await (await fetch(`${world.storeUrl}/index.json`)).json()) as StoreIndex;
    expect(index.listings.map(({ hash }) => hash).sort()).toEqual([tapRush, sealedGame, unlistedGame].sort());
    const zip = new Uint8Array(await (await fetch(`${world.storeUrl}/bundles/${tapRush}.zip`)).arrayBuffer());
    expect(sha256(zip)).toBe(tapRush);

    for (const player of BADGES) {
      const topped = await fetch(`${world.relayerUrl}/store/topup`, { method: 'POST', body: JSON.stringify({ player }) });
      expect(topped.status).toBe(202);
    }
    await world.name(BADGES);
    await vi.waitFor(async () => expect(await chain.balances(BADGES)).toEqual([usdc(100), usdc(100)]), SOON);

    box = await world.startBox();
    await toHome(box, 'tap-rush');
    expect(box.link.state().games.find(({ id }) => id === 'tap-rush')).toMatchObject({ kind: 'store', tier: 'judged', bundle: tapRush, ready: true });
    say(`rack: ${box.link.state().games.filter(({ kind }) => kind === 'store').map(({ title }) => title).join(', ')}`);
  });

  it("stakes two badges, plays, and pays the agent's split", async () => {
    const split = [usdc(15), usdc(5)] as const;
    await world.zg.script({ payouts: split.map(String) });
    const before = await chain.balances(BADGES);
    const pots = await chain.potBalance();

    await join(box, 'tap-rush');
    await sign(box, STAKE);
    const round = await opened(box);
    const [opening] = await chain.events.opened(round);
    expect(opening?.args).toMatchObject({ box: BOX_LABEL, bundle: tapRush, players: BADGES, amount: usdc(STAKE) });
    expect(await chain.potBalance()).toBe(pots + POT);
    expect(await chain.balances(BADGES)).toEqual(before.map((balance) => balance - usdc(STAKE)));
    say(`round ${round}: PotOpened ${opening?.transactionHash}, pot holds ${showUsdc(POT)}`);

    await play(box, [3, 1]);
    const shown = await boxResult();
    expect(shown).toMatchObject({ step: 'paid', payouts: [15, 5] });
    expect((await fetch(`${box.url}/store/${tapRush}/index.html`)).status).toBe(404);

    const [settled] = await chain.events.settled(round);
    expect(settled?.args.payouts).toEqual(split);
    expect(await chain.paidOut(settled?.transactionHash as Hex)).toEqual(BADGES.map((to, seat) => ({ to, value: split[seat] })));
    expect(await chain.balances(BADGES)).toEqual(before.map((balance, seat) => balance - usdc(STAKE) + (split[seat] as bigint)));
    expect(await chain.potBalance()).toBe(pots);
    const pot = await chain.pot(round);
    expect(pot.state).toBe(STATE.settled);
    expect(pot.record).toBe(settled?.args.record);
    expect(await judged(round)).toMatchObject({ state: 'paid', payouts: split.map(String), record: pot.record, tx: settled?.transactionHash });
    const paidTo = await chain.balances(BADGES);
    say(`PotSettled ${settled?.transactionHash}: ${usdcList(split)}; balances ${usdcList(paidTo)}`);
    await box.link.until(({ seats }) => seats.every(({ balance }, seat) => balance === Number(showUsdc(paidTo[seat] as bigint))), 'the balances on the screen');

    // The agent really ran in the container, on the Box's real log: its shell read the header back to the model.
    const seen = await world.zg.seen();
    expect(String(seen.shellOutput)).toContain(tapRush);
    const record = await recordOnStorage(round);
    const log = JSON.parse(record.log) as MatchLog;
    expect(log.header).toMatchObject({ box: BOX_LABEL, round: String(round), bundle: tapRush, game: 'tap-rush', players: BADGES });
    const taps = log.entries.filter((entry) => entry.t === 'tap');
    expect(taps.filter((tap) => tap.seat === 0).length).toBeGreaterThanOrEqual(3);
    expect(taps.filter((tap) => tap.seat === 1)).toHaveLength(1);
    expect(log.entries.at(-1)).toMatchObject({ src: 'box', t: 'end', why: 'game' });
    expect(log.entries.some((entry) => entry.src === 'game' && entry.t === 'event' && entry.name === 'score')).toBe(true);
    expect(record.instructions).toContain('Count each seat');
    expect(record.attempts).toBe(1);
    expect(record.verdict).toMatchObject({ kind: 'split', payouts: split.map(String) });
    expect(record.turns.length).toBeGreaterThanOrEqual(2);
    expect(record.turns.every(({ teeVerified }) => teeVerified)).toBe(true);
    await Promise.all(record.turns.map(recheckTurn));
    say(`log: ${log.entries.length} entries; ${record.turns.length} model turns, each teeVerified, each proof rechecked here`);

    await everyChatWentOutPrivate();
  });

  it('refuses a changed zip, at the store, at the Box and at the verifier', async () => {
    const upload = (zip: Uint8Array) =>
      fetch(`${world.storeUrl}/bundles`, {
        method: 'POST',
        headers: { authorization: `Bearer ${world.keys.publish}`, 'content-type': 'application/zip' },
        body: Buffer.from(zip),
      });

    // A byte changed in transit, and a good zip of the same id with another page in it.
    const flipped = packBundle(tapRushFiles());
    flipped[FLIPPED_BYTE] = (flipped[FLIPPED_BYTE] as number) ^ 1;
    const corrupt = await upload(flipped);
    expect(corrupt.status).toBe(400);
    say(`store, a changed byte: ${corrupt.status} ${JSON.stringify(await corrupt.json())}`);
    const repacked = changedTapRush('tap-rush');
    const taken = await upload(repacked);
    expect(taken.status).toBe(409);
    say(`store, another page under the same id: ${taken.status} ${JSON.stringify(await taken.json())}`);
    const index = (await (await fetch(`${world.storeUrl}/index.json`)).json()) as StoreIndex;
    expect(index.listings.map(({ hash }) => hash)).toHaveLength(3);

    // A good zip, so only the hash can give it away, reaches the Box by the man in the middle.
    const before = await chain.balances(BADGES);
    const potsBefore = await chain.events.allOpened();
    world.tamper.swap = changedTapRush('tap-rush-sealed');
    await join(box, 'tap-rush-sealed');
    const state = await box.link.until(({ phase, games }) => phase === 'home' && games.find(({ id }) => id === 'tap-rush-sealed')?.sealed != null, 'the game sealed');
    expect(state.games.find(({ id }) => id === 'tap-rush-sealed')).toMatchObject({ ready: false, sealed: "its bundle failed: the zip isn't the one listed" });
    expect(await chain.events.allOpened()).toHaveLength(potsBefore.length);
    expect(await chain.balances(BADGES)).toEqual(before);
    say(`Box: ${state.games.find(({ id }) => id === 'tap-rush-sealed')?.sealed}; nothing staked`);

    // A pot is open on Tap Rush, and the verifier is handed the same kind of zip for it. The log is good, so only the zip
    // can be why it's refused.
    world.tamper.swap = repacked;
    await who.openPot(HELD_ROUND, tapRush, BADGES, usdc(STAKE));
    const refused = await who.judge(closedLog(HELD_ROUND));
    world.tamper.swap = null;
    expect(refused.status).toBe(422);
    say(`verifier: ${refused.status} ${JSON.stringify(refused.body)}`);
    expect((await fetch(`${world.verifierUrl}/judge/${BOX_LABEL}/${HELD_ROUND}`)).status).toBe(404);
    expect((await chain.pot(HELD_ROUND)).state).toBe(STATE.open);
  });

  it("can't stake a hash the team never listed", async () => {
    const before = await chain.balances(BADGES);
    const potsBefore = await chain.events.allOpened();

    await join(box, 'tap-rush-unlisted');
    await sign(box, STAKE);
    const state = await box.link.until(({ txs }) => txs.some(({ step }) => step === 'failed'), 'the stake refused');
    say(`Box: ${state.txs.at(-1)?.error}`);
    expect(state.phase).toBe('stake');
    expect(await chain.events.allOpened()).toHaveLength(potsBefore.length);
    expect(await chain.balances(BADGES)).toEqual(before);

    const { stake, r, s } = who.signedStake(HELD_ROUND + 100n, unlistedGame, BADGES, usdc(STAKE));
    expect(await who.refusedByPot('open', [stake, r, s])).toBe('NotListed');
    expect(await chain.balances(BADGES)).toEqual(before);
    say('StorePot: a Box-signed stake on it reverts NotListed on chain');
  });

  it('retries once on a fresh container when the verifier is killed mid-run, then refunds each stake', async () => {
    await world.zg.script({ payouts: [String(POT), '0'], shellCommand: 'sleep 300' });
    const { chats: chatsBefore } = await world.zg.seen();
    const before = await chain.balances(BADGES);
    const round = await stakeAndPlayFrom();

    const killed: string[] = [];
    for (const attempt of [1, 2]) {
      const agent = await vi.waitFor(async () => {
        const fresh = runningAgents().find((name) => !killed.includes(name));
        expect(fresh).toBeDefined();
        expect((await world.zg.seen()).chats).toBeGreaterThanOrEqual(chatsBefore + attempt);
        return fresh as string;
      }, { timeout: 90_000, interval: 200 });
      killAgent(agent);
      killed.push(agent);
      say(`killed the run ${attempt} container, ${agent.slice(0, 48)}…`);
    }

    const shown = await boxResult();
    expect(shown.step).toBe('refunded');
    say(`Box: ${shown.step}: ${shown.reason}`);
    const [voided] = await chain.events.voided(round);
    await stakesWentBack(voided, before);
    expect((await chain.pot(round)).state).toBe(STATE.voided);
    expect(await chain.events.settled(round)).toHaveLength(0);
    const record = await recordOnStorage(round);
    expect(record).toMatchObject({ attempts: 2, verdict: { kind: 'failed' } });
  });

  it("gives the agent's shell no secrets and no way out, and refunds when it can't judge", async () => {
    const probes = WAYS_OUT.map((probe) => `(${probe}) &`).join('\n');
    await world.zg.script({ shellCommand: `env\n${probes}\nwait\nsleep ${LOOK_SECONDS}` });
    const before = await chain.balances(BADGES);
    const round = await stakeAndPlayFrom();

    // The shell's `env` is built for it, so it can't show what the container itself was given. Docker can.
    const agents = new Map<string, AgentConfig>();
    await vi.waitFor(() => {
      for (const name of runningAgents()) if (!agents.has(name)) agents.set(name, agentConfig(name));
      expect(agents.size).toBe(2);
    }, { timeout: 90_000, interval: 200 });

    const shown = await boxResult();
    expect(shown.step).toBe('refunded');
    say(`Box: ${shown.step}: ${shown.reason}`);
    const [voided] = await chain.events.voided(round);
    await stakesWentBack(voided, before);
    expect(await recordOnStorage(round)).toMatchObject({ attempts: 2, verdict: { kind: 'cannot_judge' } });

    const output = String((await world.zg.seen()).shellOutput);
    say(`from the agent's shell: ${[...output.matchAll(/^.* exit=\d+$/gm)].map(([line]) => line).join('; ')}`);
    expect(allBlocked(output)).toBeNull();
    expect(noSecrets(output)).toBeNull();
    const { relayer, verifier, storage } = world.keys;
    const secrets = [relayer.slice(2), verifier.slice(2), storage.slice(2), ZG_API_KEY];
    for (const secret of secrets) expect(output).not.toContain(secret);
    for (const { env, text } of agents.values()) {
      expect(noSecrets(env)).toBeNull();
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
    say('Docker says the same of both containers: neither was started with a secret');
  });

  it("refuses a forged verdict, one that doesn't add up, and one from a wrong key", async () => {
    await who.openPot(ATTACKED_ROUND, tapRush, BADGES, usdc(STAKE));
    const before = await chain.balances(BADGES);
    const held = await chain.potBalance();
    const { verifier, stranger } = world.keys;
    const whole = [POT, 0n] as const;

    const wrongKey = who.verdict(ATTACKED_ROUND, whole);
    const wrongKeySigned = await who.signVerdict(stranger, wrongKey);
    const honest = who.verdict(ATTACKED_ROUND, [usdc(STAKE), usdc(STAKE)]);
    const forged = { ...honest, payouts: whole };
    const forgedSigned = await who.signVerdict(verifier, honest);
    const short = who.verdict(ATTACKED_ROUND, [POT - 1n, 0n]);
    const shortSigned = await who.signVerdict(verifier, short);
    const over = who.verdict(ATTACKED_ROUND, [POT, POT]);
    const overSigned = await who.signVerdict(verifier, over);
    const three = who.verdict(ATTACKED_ROUND, [POT, 0n, 0n]);
    const threeSigned = await who.signVerdict(verifier, three);

    const cases = [
      ['a verdict from a wrong key', wrongKey, wrongKeySigned, 403, 'NotVerifier'],
      ['a forged verdict: the split changed after signing', forged, forgedSigned, 403, 'NotVerifier'],
      ["one that doesn't add up: a unit short", short, shortSigned, 409, 'PayoutSum'],
      ["one that doesn't add up: twice the pot", over, overSigned, 409, 'PayoutSum'],
      ['one with a payout too many', three, threeSigned, 409, 'PayoutCount'],
    ] as const;
    for (const [what, verdict, signature, status, error] of cases) {
      const answer = await who.settleAtRelayer(verdict, signature);
      expect(answer).toMatchObject({ status, body: { revert: error } });
      expect(await who.refusedByPot('settle', [verdict, signature])).toBe(error);
      say(`${what}: relayer ${answer.status}, StorePot reverts ${error}`);
    }

    const voiding = who.voiding(ATTACKED_ROUND);
    const wrongVoid = await who.signVoid(stranger, voiding);
    expect(await who.voidAtRelayer(voiding, wrongVoid)).toMatchObject({ status: 403, body: { revert: 'NotVerifier' } });
    expect(await who.refusedByPot('voidPot', [voiding, wrongVoid])).toBe('NotVerifier');
    say('a void from a wrong key: relayer 403, StorePot reverts NotVerifier');

    // A stranger's P-256 key can't get a log judged either.
    const notTheBox = await who.judge(closedLog(ATTACKED_ROUND), `0x${'11'.repeat(32)}`);
    expect(notTheBox.status).toBe(401);
    say(`a log signed by another P-256 key: verifier ${notTheBox.status}`);

    expect(await chain.events.settled(ATTACKED_ROUND)).toHaveLength(0);
    expect(await chain.events.voided(ATTACKED_ROUND)).toHaveLength(0);
    expect((await chain.pot(ATTACKED_ROUND)).state).toBe(STATE.open);
    expect(await chain.balances(BADGES)).toEqual(before);
    expect(await chain.potBalance()).toBe(held);
  });

  it("refunds when the agent's own split doesn't add up", async () => {
    await world.zg.script({ payouts: [String(usdc(15)), String(usdc(1))] });
    const before = await chain.balances(BADGES);
    const round = await stakeAndPlayFrom();
    const shown = await boxResult();
    expect(shown.step).toBe('refunded');
    say(`Box: ${shown.step}: ${shown.reason}`);
    expect(shown.reason).toBe(bothRuns(NOT_THE_POT));
    const [voided] = await chain.events.voided(round);
    await stakesWentBack(voided, before);
    const record = await recordOnStorage(round);
    expect(record).toMatchObject({ attempts: 2, verdict: { kind: 'failed', why: bothRuns(NOT_THE_POT) } });
    expect(record.turns.length).toBeGreaterThanOrEqual(2);
    expect(record.turns.every(({ teeVerified }) => teeVerified)).toBe(true);
    say(`${record.turns.length} model turns, each teeVerified: the agent ran, and only its split was refused`);
  });

  it('refunds when a turn fails the TEE check', async () => {
    await world.zg.script({ payouts: [String(POT), '0'], chat: 'bad-signature' });
    const before = await chain.balances(BADGES);
    const round = await stakeAndPlayFrom();
    const shown = await boxResult();
    expect(shown.step).toBe('refunded');
    say(`Box: ${shown.step}: ${shown.reason}`);
    expect(shown.reason).toBe(bothRuns(NOT_THE_ENCLAVE));
    const [voided] = await chain.events.voided(round);
    await stakesWentBack(voided, before);
    expect(await chain.events.settled(round)).toHaveLength(0);
    await world.zg.script({});
    const record = await recordOnStorage(round);
    expect(record).toMatchObject({ attempts: 2, verdict: { kind: 'failed', why: bothRuns(NOT_THE_ENCLAVE) } });
    expect(record.turns.length).toBeGreaterThanOrEqual(2);
    expect(record.turns.some(({ teeVerified }) => teeVerified)).toBe(false);
    say(`${record.turns.length} model turns, none teeVerified`);
  });

  it('pays when 0G Storage is down, and keeps the record until it lands', async () => {
    const split = [usdc(9), usdc(11)] as const;
    await world.zg.script({ payouts: split.map(String), storageUp: false });
    const before = await chain.balances(BADGES);
    const round = await stakeAndPlayFrom();
    const shown = await boxResult();
    expect(shown).toMatchObject({ step: 'paid', payouts: [9, 11] });
    const [settled] = await chain.events.settled(round);
    expect(settled?.args.payouts).toEqual(split);
    expect(await chain.balances(BADGES)).toEqual(before.map((balance, seat) => balance - usdc(STAKE) + (split[seat] as bigint)));
    say(`PotSettled ${settled?.transactionHash} with storage down: ${usdcList(split)}`);

    const waiting = await audit(round);
    expect(waiting).toMatchObject({ record: (await chain.pot(round)).record, root: null });
    say(`audit: record ${waiting.record} kept, no root yet`);
    await world.zg.script({ storageUp: true });
    expect(await recordOnStorage(round, UPLOAD_RETRY)).toMatchObject({ attempts: 1, verdict: { kind: 'split' } });
  });

  // A run's Durable Object wakes 9 minutes after it dies, so this one is only on request.
  it.runIf(process.env.EGB_E2E_SLOW)("carries on on a fresh container when the verifier's Worker dies mid-run", { timeout: 15 * 60_000 }, async () => {
    const split = [usdc(12), usdc(8)] as const;
    await world.zg.script({ payouts: split.map(String), shellCommand: 'sleep 300' });
    const { chats: chatsBefore } = await world.zg.seen();
    const before = await chain.balances(BADGES);
    const round = await stakeAndPlayFrom();
    await vi.waitFor(async () => {
      expect(runningAgents()).toHaveLength(1);
      expect((await world.zg.seen()).chats).toBeGreaterThan(chatsBefore);
    }, { timeout: 90_000, interval: 200 });

    await world.crashVerifier();
    say('killed the Worker, workerd and its container mid-run');
    await world.zg.script({ payouts: split.map(String) });
    await world.startVerifier();
    expect(await judged(round)).toMatchObject({ state: 'judging' });

    const started = Date.now();
    const shown = await box.link.until(({ phase }) => phase === 'result', 'Result', 12 * 60_000).then(judgedOf);
    say(`the pot's object woke after ${Math.round((Date.now() - started) / 1000)} s`);
    expect(shown).toMatchObject({ step: 'paid', payouts: [12, 8] });
    const [settled] = await chain.events.settled(round);
    expect(settled?.args.payouts).toEqual(split);
    expect(await chain.balances(BADGES)).toEqual(before.map((balance, seat) => balance - usdc(STAKE) + (split[seat] as bigint)));
    say(`PotSettled ${settled?.transactionHash}: ${usdcList(split)}`);
    expect(await recordOnStorage(round)).toMatchObject({ attempts: 2, verdict: { kind: 'split' } });
  });

  it('refunds after the delay with the verifier down', async () => {
    await world.stopVerifier();
    await world.zg.script({});
    const before = await chain.balances(BADGES);
    const round = await stakeAndPlayFrom();
    say(`round ${round}: judging, and the verifier isn't there`);
    expect((await chain.pot(round)).state).toBe(STATE.open);

    expect(await who.refundAtRelayer(round)).toMatchObject({ status: 422, body: { revert: 'TooEarly' } });
    expect(await who.refusedByPot('refund', [BOX_LABEL, round])).toBe('TooEarly');
    expect((await chain.pot(round)).state).toBe(STATE.open);
    say('before the delay: relayer 422, StorePot reverts TooEarly');

    await world.chain.jump(REFUND_DELAY_S + 1);
    say(`anvil moved on ${REFUND_DELAY_S + 1} s`);

    // A Box that was away that long comes back, and its sweep refunds what it left open.
    await box.stop();
    ageRounds(box.rounds, BOX_AGES_MS);
    box = await world.startBox();
    const refunded = await vi.waitFor(async () => {
      const [event] = await chain.events.refunded(round);
      expect(event).toBeDefined();
      return event;
    }, SOON);
    await stakesWentBack(refunded, before);
    expect((await chain.pot(round)).state).toBe(STATE.refunded);
    expect(box.log()).toContain(`chain: refunding pot ${round}`);

    // Anyone may do it, with no Box and no relayer: the pot the changed zip left open, from a key that holds nothing.
    const players = before.length;
    await who.refund(HELD_ROUND);
    const [held] = await chain.events.refunded(HELD_ROUND);
    expect(held).toBeDefined();
    expect(await chain.paidOut(held?.transactionHash as Hex)).toHaveLength(players);
    say(`a stranger refunded round ${HELD_ROUND} straight on StorePot in ${held?.transactionHash}`);
    expect((await chain.pot(HELD_ROUND)).state).toBe(STATE.refunded);

    await who.refund(ATTACKED_ROUND);
    expect(await chain.potBalance()).toBe(0n);
    say('StorePot holds nothing: every stake of every pot went somewhere it should');

    // The sweep read the chain for the rest, and the Box keeps no pot that is over.
    await vi.waitFor(() => expect(JSON.parse(readFileSync(box.rounds, 'utf8'))).not.toHaveProperty('storePots'), SOON);
    await everyChatWentOutPrivate();
  });
});

/** A whole match, up to Judging. */
const stakeAndPlayFrom = () => stakeAndPlay(box, 'tap-rush', STAKE, [2, 1]);

const tapRushFiles = () => new Map(['index.html', 'manifest.json'].map((name) => [name, new Uint8Array(readFileSync(path.join(TAP_RUSH, name)))]));

/** A good zip of a game called `id`, with a page the team never read. */
function changedTapRush(id: string): Uint8Array {
  const files = tapRushFiles();
  const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json'))) as object;
  files.set('manifest.json', new TextEncoder().encode(JSON.stringify({ ...manifest, id })));
  files.set('index.html', new TextEncoder().encode('<!doctype html><title>Not what the team read</title>'));
  return packBundle(files);
}

/** A match with no taps, closed by the game: a log the verifier's checks pass. */
function closedLog(round: bigint): MatchLog {
  return {
    header: { v: 1, box: BOX_LABEL, round: String(round), bundle: tapRush, game: 'tap-rush', players: BADGES, amount: String(usdc(STAKE)), startedAt: Date.now() },
    entries: [{ src: 'box', t: 'end', at: Date.now(), why: 'game' }],
  };
}
