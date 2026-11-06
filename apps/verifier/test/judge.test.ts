import { type AuditRecord, jsonTextHash, storeVerdictTypedData, storeVoidTypedData } from '@egb/shared/store';
import { recoverTypedDataAddress } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { failed } from '../src/failure.ts';
import { ANOTHER_LOG, type Judge, type JudgeJob, type RunResult, type Ticket } from '../src/judge.ts';
import { LIMITS } from '../src/limits.ts';
import { POT_STATE } from '../src/pot.ts';
import { AMOUNT, BOX, Crash, INSTRUCTIONS, POT, RPC_SECRET, ROUND, type World, ZG_API_KEY, stakedWorld } from './world.ts';

type Staked = Awaited<ReturnType<typeof stakedWorld>>;

function jobOf(world: Staked, text = JSON.stringify(world.log)): JudgeJob {
  return {
    box: BOX,
    round: ROUND,
    bundle: world.log.header.bundle,
    logHash: jsonTextHash(text),
    log: text,
    instructions: INSTRUCTIONS,
    seats: 2,
    amount: AMOUNT,
  };
}

async function begun(): Promise<{ world: Staked; judge: Judge }> {
  const world = await stakedWorld();
  const judge = world.judge();
  await judge.begin(jobOf(world));
  return { world, judge };
}

const recordOf = (world: World) => JSON.parse(world.audits.landed[0] as string) as AuditRecord;

describe('a good match', () => {
  it('opens as judging, with its alarm due now', async () => {
    const { world, judge } = await begun();
    expect(await judge.status()).toEqual({ state: 'judging', payouts: null, tx: null, record: null, reason: null });
    expect(world.alarm).toBe(world.now);
  });

  it('gives one container the log and the instructions, and pays the split', async () => {
    const { world, judge } = await begun();
    await world.settle(judge);
    expect(world.runner.runs).toHaveLength(1);
    expect(world.runner.runs[0]?.job).toEqual({ log: JSON.stringify(world.log), instructions: INSTRUCTIONS });
    const status = await judge.status();
    expect(status).toMatchObject({ state: 'paid', payouts: ['10000000', '0'], tx: `0x${'ab'.repeat(32)}`, reason: null });
    expect(world.relayer.closes).toBe(1);
  });

  it('signs a Verdict with the verifier key, over the record that landed', async () => {
    const { world, judge } = await begun();
    await world.settle(judge);
    const [send] = world.relayer.sends;
    expect(send?.path).toBe('/store/settle');
    const verdict = send?.body.verdict as { box: string; round: string; payouts: string[]; record: `0x${string}`; deadline: string };
    expect(verdict).toMatchObject({ box: BOX, round: ROUND, payouts: ['10000000', '0'] });
    expect(verdict.record).toBe(jsonTextHash(world.audits.landed[0] as string));
    expect((await judge.status())?.record).toBe(verdict.record);
    const signer = await recoverTypedDataAddress({
      ...storeVerdictTypedData(
        { box: BOX, round: BigInt(ROUND), payouts: verdict.payouts.map(BigInt), record: verdict.record, deadline: BigInt(verdict.deadline) },
        POT,
      ),
      signature: send?.body.signature as `0x${string}`,
    });
    expect(signer).toBe(world.signer.address);
  });

  it('records every turn, proven, with the log and instructions in the audit record', async () => {
    const { world, judge } = await begun();
    await world.settle(judge);
    const record = recordOf(world);
    expect(record).toMatchObject({
      v: 1,
      bundle: world.log.header.bundle,
      instructions: INSTRUCTIONS,
      log: JSON.stringify(world.log),
      attempts: 1,
      verdict: { kind: 'split', payouts: ['10000000', '0'] },
    });
    expect(record.turns).toHaveLength(2);
    for (const turn of record.turns) {
      expect(turn.teeVerified).toBe(true);
      expect(turn.chatId).toMatch(/^chatcmpl-/);
      expect(turn.response).toMatchObject({ proof: { chatId: turn.chatId, provider: world.zg.provider } });
    }
  });
});

const split = (...payouts: string[]) => payouts;

/** Each way a run can fail, set up so that both attempts fail it. */
const FAILURES: readonly [string, (world: Staked) => void, string][] = [
  ['a timeout', (world) => world.runner.scripts.push(...twice(async () => ({ failure: failed('timeout', 'the run timed out') }))), 'the run timed out'],
  ['0G unreachable', (world) => void (world.zg.settings.chat = 'down'), "0G can't be reached"],
  ['0G failing', (world) => void (world.zg.settings.chat = 'error'), '0G answered 500'],
  ['an unsealed reply', (world) => void (world.zg.settings.chat = 'unsealed'), 'the reply is not sealed'],
  ['a reply with no chat id', (world) => void (world.zg.settings.chat = 'no-chat-id'), 'the reply has no chat id'],
  ['a reply with no provider', (world) => void (world.zg.settings.chat = 'no-provider'), 'the reply names no provider'],
  ['a signature from another key', (world) => void (world.zg.settings.chat = 'bad-signature'), "the signature is not the enclave's"],
  ['no signature', (world) => void (world.zg.settings.chat = 'no-signature'), 'the chat has no signature'],
  ['a provider that is not TeeML', (world) => void (world.zg.settings.verifiability = 'Other'), 'the provider is not TeeML'],
  ['an unacknowledged provider', (world) => void (world.zg.settings.acknowledged = false), "the provider's enclave key is not acknowledged"],
  ['cannot_judge', (world) => void (world.zg.settings.payouts = null), 'the agent could not judge this match'],
  ['too few payouts', (world) => void (world.zg.settings.payouts = split('10000000')), 'a split has 1 payouts for 2 players'],
  ['too many payouts', (world) => void (world.zg.settings.payouts = split('10000000', '0', '0')), 'a split has 3 payouts for 2 players'],
  ['a split under the pot', (world) => void (world.zg.settings.payouts = split('9999999', '0')), 'a split does not add up to exactly the pot'],
  ['a split over the pot', (world) => void (world.zg.settings.payouts = split('10000000', '1')), 'a split does not add up to exactly the pot'],
  ['a negative payout', (world) => void (world.zg.settings.payouts = split('-1', '10000001')), 'a split has a payout that is not a whole, non-negative number'],
  ['a fraction', (world) => void (world.zg.settings.payouts = split('0.5', '9999999.5')), 'a split has a payout that is not a whole, non-negative number'],
  ['a dead container', (world) => world.runner.scripts.push(...twice(async () => ({ failure: failed('container', 'the container failed') }))), 'the container failed'],
  ['an answer that is no verdict', (world) => world.runner.scripts.push(...twice(async () => ({ verdict: 'pay me' }))), 'the answer is not a verdict'],
];

function twice<T>(script: T): [T, T] {
  return [script, script];
}

describe.each(FAILURES)('a run failed by %s', (_name, breakIt, why) => {
  it('retries once on a fresh container, then voids', async () => {
    const { world, judge } = await begun();
    breakIt(world);
    await world.settle(judge);

    expect(world.runner.runs.map(({ ticket }) => ticket.attempt)).toEqual([1, 2]);
    expect(world.relayer.sends.map(({ path }) => path)).toEqual(['/store/void']);
    expect(world.relayer.closes).toBe(1);
    const status = await judge.status();
    expect(status).toMatchObject({ state: 'refunded', payouts: null });
    expect(status?.reason).toContain(why);
    expect(status?.record).toBe(jsonTextHash(world.audits.landed[0] as string));
    expect(recordOf(world).attempts).toBe(2);
  });
});

describe('a void', () => {
  it('is signed by the verifier key', async () => {
    const { world, judge } = await begun();
    world.zg.settings.payouts = null;
    await world.settle(judge);
    const [send] = world.relayer.sends;
    const voiding = send?.body.void as { record: `0x${string}`; deadline: string };
    const signer = await recoverTypedDataAddress({
      ...storeVoidTypedData({ box: BOX, round: BigInt(ROUND), record: voiding.record, deadline: BigInt(voiding.deadline) }, POT),
      signature: send?.body.signature as `0x${string}`,
    });
    expect(signer).toBe(world.signer.address);
  });

  it("records the agent's own words when it could not judge", async () => {
    const { world, judge } = await begun();
    world.zg.settings.payouts = null;
    await world.settle(judge);
    expect(recordOf(world).verdict).toEqual({ kind: 'cannot_judge', why: 'The log has no taps.' });
    expect((await judge.status())?.reason).not.toContain('no taps');
  });

  it('records each failure when the runs failed some other way', async () => {
    const { world, judge } = await begun();
    world.zg.settings.chat = 'error';
    await world.settle(judge);
    expect(recordOf(world).verdict).toEqual({ kind: 'failed', why: '0G answered 500; 0G answered 500' });
  });
});

describe('the retry', () => {
  it('pays when the second run is good, keeping both runs in the record', async () => {
    const { world, judge } = await begun();
    world.zg.settings.chat = 'unsealed';
    await judge.advance();
    world.zg.settings.chat = 'none';
    await world.settle(judge);
    expect(world.runner.runs.map(({ ticket }) => ticket.attempt)).toEqual([1, 2]);
    expect(await judge.status()).toMatchObject({ state: 'paid', payouts: ['10000000', '0'] });
    const record = recordOf(world);
    expect(record.attempts).toBe(2);
    expect(record.turns.map(({ teeVerified }) => teeVerified)).toEqual([false, true, true]);
  });
});

describe('the TEE check', () => {
  it('fails a run whatever the container claims', async () => {
    const { world, judge } = await begun();
    const lying = world.agent();
    world.runner.scripts.push(...twice(async (ticket: Parameters<typeof lying>[0], job: Parameters<typeof lying>[1]) => {
      await lying(ticket, job);
      return { verdict: { kind: 'split', payouts: ['10000000', '0'], why: 'Trust me.' } };
    }));
    world.zg.settings.chat = 'bad-signature';
    await world.settle(judge);
    expect(world.relayer.sends.map(({ path }) => path)).toEqual(['/store/void']);
    expect(recordOf(world).turns[0]).toMatchObject({ teeVerified: false, response: { problem: "the signature is not the enclave's" } });
  });

  it('never pays a verdict that came from no model turn', async () => {
    const { world, judge } = await begun();
    world.runner.scripts.push(...twice(async () => ({ verdict: { kind: 'split', payouts: ['10000000', '0'], why: 'Trust me.' } })));
    await world.settle(judge);
    expect(world.relayer.sends.map(({ path }) => path)).toEqual(['/store/void']);
  });
});

describe('a run that wanders', () => {
  it('is stopped at the turn limit, even if the shell calls the proxy itself', async () => {
    const { world, judge } = await begun();
    world.zg.settings.shellTurns = LIMITS.turns + 5;
    await judge.advance();
    expect(world.zg.chats).toHaveLength(LIMITS.turns);
    expect((await judge.status())?.state).toBe('judging');
  });

  it('refuses a call from a run that is over', async () => {
    const { world, judge } = await begun();
    world.zg.settings.chat = 'error';
    await judge.advance();
    const before = world.zg.chats.length;
    const reply = await judge.modelTurn(1, JSON.stringify({ messages: [] }));
    expect(reply.status).toBe(409);
    expect(world.zg.chats).toHaveLength(before);
  });
});

/** A shell calling `zg.internal` itself, past the agent's own limits, with prompts of `bytes` each. */
const flood = (world: World, bytes: number, calls: number = LIMITS.turns) =>
  async ({ attempt }: Ticket): Promise<RunResult> => {
    const text = JSON.stringify({ messages: [{ role: 'user', content: ' '.repeat(bytes) }] });
    for (let call = 0; call < calls; call++) await world.current().modelTurn(attempt, text);
    return { failure: failed('container', 'the container answered 500') };
  };

describe('a shell that calls the proxy itself', () => {
  it("never sends a prompt too big for the run's tokens", async () => {
    const { world, judge } = await begun();
    world.runner.scripts.push(...twice(flood(world, 800 * 1024)));
    await world.settle(judge);
    expect(world.zg.chats).toHaveLength(0);
    expect(await judge.status()).toMatchObject({ state: 'refunded', reason: 'the run passed its token limit; the run passed its token limit' });
  });

  it('is stopped at the run limit by what 0G says it cost', async () => {
    const { world, judge } = await begun();
    world.zg.settings.usageTokens = 120_000;
    world.runner.scripts.push(...twice(flood(world, 1000)));
    await world.settle(judge);
    expect(world.zg.chats).toHaveLength(2 * 2);
    expect((await judge.status())?.reason).toContain('the run passed its token limit');
  });

  it('is counted at the estimate when a reply gives no usage', async () => {
    const { world, judge } = await begun();
    world.zg.settings.usageTokens = null;
    world.runner.scripts.push(...twice(flood(world, 300_000)));
    await world.settle(judge);
    expect(world.zg.chats).toHaveLength(2 * 1);
  });

  it("can't pass the pot's size limit across its two runs", async () => {
    const { world, judge } = await begun();
    const each = Math.floor((LIMITS.turnsBytes * 0.75) / LIMITS.turns);
    world.zg.settings.usageTokens = 1;
    world.runner.scripts.push(...twice(flood(world, each)));
    await world.settle(judge);
    const size = new TextEncoder().encode(JSON.stringify(recordOf(world).turns)).length;
    expect(size).toBeLessThanOrEqual(LIMITS.turnsBytes);
    expect((await judge.status())?.reason).toContain('the pot passed its size limit');
  });

  it('pays for nothing once the pot is past its size limit', async () => {
    const { world, judge } = await begun();
    const each = Math.floor(LIMITS.turnsBytes / LIMITS.turns);
    world.zg.settings.usageTokens = 1;
    world.runner.scripts.push(flood(world, each), flood(world, each));
    await world.settle(judge);
    const sent = world.zg.chats.length;
    expect(sent).toBeLessThan(LIMITS.turns);
    expect(await judge.status()).toMatchObject({ state: 'refunded' });
    expect(world.runner.runs).toHaveLength(2);
    expect(sent).toBe(recordOf(world).turns.length);
  });
});

describe('one judgement per pot', () => {
  it('hands a repeat of the same log the running one', async () => {
    const { world, judge } = await begun();
    expect(await judge.begin(jobOf(world))).toMatchObject({ state: 'judging' });
    await world.settle(judge);
    expect(await judge.begin(jobOf(world))).toMatchObject({ state: 'paid' });
    expect(world.runner.runs).toHaveLength(1);
    expect(world.relayer.sends).toHaveLength(1);
  });

  it('refuses another log', async () => {
    const { world, judge } = await begun();
    expect(await judge.begin(jobOf(world, `${JSON.stringify(world.log)} `))).toBe(ANOTHER_LOG);
  });

  it('opens once for concurrent requests', async () => {
    const world = await stakedWorld();
    const judge = world.judge();
    const results = await Promise.all([judge.begin(jobOf(world)), judge.begin(jobOf(world)), judge.begin(jobOf(world))]);
    expect(results.every((result) => result !== ANOTHER_LOG)).toBe(true);
    await world.settle(judge);
    expect(world.runner.runs).toHaveLength(1);
    expect(world.relayer.closes).toBe(1);
  });
});

describe('a crash', () => {
  it('mid-run counts as a failed run: the retry is on a fresh container', async () => {
    const { world, judge } = await begun();
    world.runner.scripts.push(async () => {
      throw new Crash('died mid-run');
    });
    await expect(judge.advance()).rejects.toThrow(Crash);
    expect(world.alarm).toBeGreaterThan(world.now);

    const restarted = world.judge();
    await world.settle(restarted);
    expect(world.runner.runs.map(({ ticket }) => ticket.attempt)).toEqual([1, 2]);
    expect(await restarted.status()).toMatchObject({ state: 'paid' });
    expect(world.relayer.closes).toBe(1);
  });

  it('mid-run twice voids the pot', async () => {
    const { world, judge } = await begun();
    const die = async () => {
      throw new Crash('died mid-run');
    };
    world.runner.scripts.push(die, die);
    await expect(judge.advance()).rejects.toThrow(Crash);
    await expect(world.judge().advance()).rejects.toThrow(Crash);
    const restarted = world.judge();
    await world.settle(restarted);
    expect(await restarted.status()).toMatchObject({ state: 'refunded', reason: 'the run was lost; the run was lost' });
    expect(world.relayer.sends.map(({ path }) => path)).toEqual(['/store/void']);
  });

  it('between signing and sending sends the same bytes, once', async () => {
    const { world, judge } = await begun();
    world.relayer.crashBeforeSend = true;
    await expect(judge.advance()).rejects.toThrow(Crash);
    expect(world.relayer.sends).toHaveLength(0);
    const signing = vi.spyOn(world.signer, 'signVerdict');

    const restarted = world.judge();
    await world.settle(restarted);
    expect(signing).not.toHaveBeenCalled();
    expect(world.relayer.sends).toHaveLength(1);
    expect(world.relayer.closes).toBe(1);
    expect(await restarted.status()).toMatchObject({ state: 'paid', payouts: ['10000000', '0'] });
  });

  it('after sending never pays twice, and never runs the agent again', async () => {
    const { world, judge } = await begun();
    world.relayer.crashAfterSend = true;
    await expect(judge.advance()).rejects.toThrow(Crash);
    expect(world.relayer.closes).toBe(1);

    const restarted = world.judge();
    await world.settle(restarted);
    expect(world.relayer.closes).toBe(1);
    expect(world.runner.runs).toHaveLength(1);
    expect(await restarted.status()).toMatchObject({ state: 'paid' });
  });

  it('after sending, with the transaction pending, waits it out', async () => {
    const { world, judge } = await begun();
    world.relayer.holdBlock = true;
    world.relayer.crashAfterSend = true;
    await expect(judge.advance()).rejects.toThrow(Crash);

    const restarted = world.judge();
    world.relayer.refusals.push(409);
    await restarted.advance();
    expect(await restarted.status()).toMatchObject({ state: 'paying' });
    world.relayer.mine();
    world.now += LIMITS.retryMaxMs;
    await world.settle(restarted);
    expect(world.relayer.closes).toBe(1);
    expect(await restarted.status()).toMatchObject({ state: 'paid' });
  });

  it('after sealing, before signing, still pays that verdict', async () => {
    const { world, judge } = await begun();
    const signing = vi.spyOn(world.signer, 'signVerdict').mockRejectedValueOnce(new Crash('died signing'));
    await expect(judge.advance()).rejects.toThrow(Crash);
    expect(signing).toHaveBeenCalledOnce();

    const restarted = world.judge();
    await world.settle(restarted);
    expect(world.runner.runs).toHaveLength(1);
    expect(await restarted.status()).toMatchObject({ state: 'paid', payouts: ['10000000', '0'] });
  });
});

describe('paying', () => {
  it('polls a pending transaction without sending again', async () => {
    const { world, judge } = await begun();
    world.relayer.holdBlock = true;
    await judge.advance();
    world.now += LIMITS.pollMs;
    await judge.advance();
    expect(await judge.status()).toMatchObject({ state: 'paying', payouts: ['10000000', '0'], tx: `0x${'ab'.repeat(32)}` });
    expect(world.relayer.sends).toHaveLength(1);
    world.relayer.mine();
    await world.settle(judge);
    expect(await judge.status()).toMatchObject({ state: 'paid' });
  });

  it('retries a relayer that refuses, then pays', async () => {
    const { world, judge } = await begun();
    world.relayer.refusals.push(0, 503, 409);
    await world.settle(judge);
    expect(world.relayer.sends).toHaveLength(4);
    expect(world.relayer.closes).toBe(1);
    expect(await judge.status()).toMatchObject({ state: 'paid' });
  });

  it('signs again, with the same split and record, when a signature grows old', async () => {
    const { world, judge } = await begun();
    world.relayer.refusals.push(0);
    await judge.advance();
    world.now += LIMITS.signedForSeconds * 1000;
    await world.settle(judge);
    const [first, second] = world.relayer.sends.map(({ body }) => body.verdict as { payouts: string[]; record: string; deadline: string });
    expect(second?.payouts).toEqual(first?.payouts);
    expect(second?.record).toBe(first?.record);
    expect(Number(second?.deadline)).toBeGreaterThan(Number(first?.deadline));
    expect(world.relayer.closes).toBe(1);
  });

  it('signs again after a reverted transaction: the relayer remembers the old digest', async () => {
    const { world, judge } = await begun();
    world.relayer.holdBlock = true;
    await judge.advance();
    world.relayer.revertAll();
    world.relayer.holdBlock = false;
    world.now += LIMITS.pollMs + 1000;
    await world.settle(judge);
    const [first, second] = world.relayer.sends.map(({ body }) => body);
    expect(second?.signature).not.toBe(first?.signature);
    expect(world.relayer.closes).toBe(1);
  });

  it('takes the chain at its word when the pot closed some other way', async () => {
    const { world, judge } = await begun();
    world.pot.state = POT_STATE.refunded;
    await world.settle(judge);
    expect(world.relayer.sends).toHaveLength(0);
    expect(await judge.status()).toMatchObject({ state: 'refunded', payouts: null, reason: 'the pot was refunded before the verdict landed' });
  });

  it('keeps waiting while the chain can not be read', async () => {
    const { world, judge } = await begun();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    world.potDown = true;
    await judge.advance();
    expect(world.relayer.sends).toHaveLength(0);
    world.potDown = false;
    await world.settle(judge);
    expect(await judge.status()).toMatchObject({ state: 'paid' });
    expect(JSON.stringify(error.mock.calls)).not.toContain(RPC_SECRET);
    error.mockRestore();
  });

  it('gives up after two hours and leaves the pot to its refund, keeping the record', async () => {
    const { world, judge } = await begun();
    world.relayer.refusals.push(...Array<number>(200).fill(503));
    await world.settle(judge, 100);
    expect(await judge.status()).toMatchObject({ state: 'failed', payouts: null });
    expect(world.pot.state).toBe(POT_STATE.open);
    expect(world.audits.landed).toHaveLength(1);
  });
});

describe('the upload', () => {
  it('waits for the pot to close, so it can never hold up a payment', async () => {
    const { world, judge } = await begun();
    world.relayer.holdBlock = true;
    await judge.advance();
    expect(world.audits.tries).toBe(0);
    world.relayer.mine();
    await world.settle(judge);
    expect(world.audits.landed).toHaveLength(1);
  });

  it('failing does not stop the payment, and it is retried until it lands', async () => {
    const { world, judge } = await begun();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    world.audits.up = false;
    world.now = (await judge.advance()) as number;
    world.now = (await judge.advance()) as number;
    expect(await judge.status()).toMatchObject({ state: 'paid', payouts: ['10000000', '0'] });
    expect(world.relayer.closes).toBe(1);
    expect(await judge.audit()).toMatchObject({ root: null });

    for (let i = 0; i < 3; i++) {
      world.now = (await judge.advance()) as number;
    }
    expect(world.audits.tries).toBe(4);

    world.audits.up = true;
    await world.settle(judge);
    const status = await judge.status();
    expect(jsonTextHash(world.audits.landed[0] as string)).toBe(status?.record);
    expect(await judge.audit()).toEqual({ record: status?.record, root: `0x${'cd'.repeat(32)}`, tx: `0x${'ef'.repeat(32)}` });
    expect(JSON.stringify(error.mock.calls)).not.toContain(RPC_SECRET);
    error.mockRestore();
  });

  it('remembers a payment between tries, across a restart, so a retry can say it paid', async () => {
    const { world, judge } = await begun();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    world.audits.up = false;
    world.audits.paysBeforeFailing = true;
    world.now = (await judge.advance()) as number;
    world.now = (await judge.advance()) as number;
    expect(await judge.audit()).toMatchObject({ root: null, tx: `0x${'ef'.repeat(32)}` });

    world.audits.up = true;
    const restarted = world.judge();
    await world.settle(restarted);
    expect(world.audits.paid).toEqual([null, `0x${'ef'.repeat(32)}`]);
    expect(await restarted.audit()).toMatchObject({ root: `0x${'cd'.repeat(32)}`, tx: `0x${'ef'.repeat(32)}` });
    error.mockRestore();
  });

  it('survives a restart, because the record is in the store', async () => {
    const { world, judge } = await begun();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    world.audits.up = false;
    world.now = (await judge.advance()) as number;
    world.now = (await judge.advance()) as number;
    expect(world.audits.tries).toBe(1);
    world.audits.up = true;
    await world.settle(world.judge());
    expect(world.audits.landed).toHaveLength(1);
    error.mockRestore();
  });

  it('is forgotten once it lands: only the small hearing is left', async () => {
    const { world, judge } = await begun();
    await world.settle(judge);
    expect([...world.store.map.keys()]).toEqual(['hearing']);
    expect(await judge.advance()).toBeNull();
    expect(world.audits.tries).toBe(1);
  });
});

describe('secrets', () => {
  it('are never in the status or the record', async () => {
    const { world, judge } = await begun();
    await world.settle(judge);
    const everything = `${JSON.stringify(await judge.status())}${world.audits.landed[0]}`;
    expect(everything).not.toContain(ZG_API_KEY);
    expect(everything).not.toContain(world.key);
  });
});
