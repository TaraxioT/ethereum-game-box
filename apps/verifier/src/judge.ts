// One pot's judgement, from a checked log to a paid pot and a stored record. `Judge` is the logic over a plain store (the
// tests run it in memory); `Judgement` is the Durable Object around it.
//
// Everything that matters is in the store, written before the step it protects, so `advance` can die at any line and
// run again. A run that was under way when the object died counts as failed. A verdict is sealed and saved before it is
// signed, and signed and saved before it is sent, so a crash resends the same bytes. The chain has the last word on
// whether a pot is paid: `StorePot` takes one `settle` or `voidPot` per pot, so resending can't pay twice.

import type { Store } from '@egb/relayer/store';
import type { AgentRunRequest, AgentTurn, AgentVerdict, AuditRecord, JudgeStatus } from '@egb/shared/store';
import type { Hex } from 'viem';

import { sealRecord } from './audit.ts';
import type { AuditStore } from './audit-store.ts';
import { type Failure, failed } from './failure.ts';
import { utf8Bytes } from './json.ts';
import { LIMITS, backoff, estimateTokens } from './limits.ts';
import { POT_STATE } from './pot.ts';
import { type ProxyOptions, proxyTurn } from './proxy.ts';
import type { Scrub } from './safe.ts';
import type { PaySigner } from './signer.ts';
import { deleteText, getText, putText } from './texts.ts';
import type { PayRelayer } from './upstream.ts';
import { readVerdict } from './verdict.ts';

/** Everything the Worker checked, for one pot. */
export interface JudgeJob {
  readonly box: string;
  readonly round: string;
  readonly bundle: Hex;
  /** `jsonTextHash` of `log`. */
  readonly logHash: Hex;
  /** The log's exact JSON text. */
  readonly log: string;
  /** From the store's zip, by hash: never from the Box. */
  readonly instructions: string;
  readonly seats: number;
  /** Each player's stake, a decimal string. */
  readonly amount: string;
}

/** Which run a container belongs to. It lives with the container's Durable Object, never in the container. */
export interface Ticket {
  readonly judgement: string;
  readonly attempt: number;
}

export type RunResult = { readonly verdict: unknown } | { readonly failure: Failure };

export interface AgentRunner {
  /** Runs one attempt on a fresh container. Never throws: a run that goes wrong comes back as a `Failure`. */
  run(ticket: Ticket, job: AgentRunRequest): Promise<RunResult>;
}

export interface JudgeDeps {
  readonly store: Store;
  /** Sets the one alarm, replacing any other. */
  readonly wake: (atMs: number) => Promise<void>;
  /** Milliseconds. */
  readonly now: () => number;
  readonly runner: AgentRunner;
  readonly proxy: ProxyOptions;
  readonly signer: PaySigner;
  readonly relayer: PayRelayer;
  /** The pot's state: `POT_STATE`. */
  readonly potState: (box: string, round: bigint) => Promise<number>;
  readonly audits: AuditStore;
  readonly scrub: Scrub;
}

/** What a model call gets back, through the outbound handler. */
export interface TurnReply {
  readonly status: number;
  readonly body: string;
}

/** Where a pot's audit record is, once it has landed. */
export interface AuditView {
  readonly record: Hex | null;
  /** The record's root on 0G Storage, or null until it lands. */
  readonly root: Hex | null;
  /** The storage transaction, or null if the file was already there. */
  readonly tx: Hex | null;
}

export const ANOTHER_LOG = 'another-log';

/** A signed message on its way, kept until the chain says the pot is closed. */
interface Payment {
  readonly kind: 'verdict' | 'void';
  /** A verdict's split, as decimal strings; null for a void. */
  readonly payouts: readonly string[] | null;
  readonly record: Hex;
  /** When to stop trying, in milliseconds. */
  readonly until: number;
  deadline: string | null;
  signature: Hex | null;
  /** The relayer's request, while it has one. */
  txId: string | null;
  tx: Hex | null;
  sends: number;
  nextAt: number;
}

/** The upload of the audit record. */
interface Keeping {
  tries: number;
  nextAt: number;
  root: Hex | null;
  /** The payment, from the moment it leaves: a retry must know of it, or it could pay again. */
  tx: Hex | null;
}

/** A wait for a free container, over the pot's whole judgement. */
interface Queue {
  since: number;
  tries: number;
  nextAt: number;
}

interface Hearing extends Omit<JudgeJob, 'log' | 'instructions'> {
  phase: JudgeStatus['state'];
  /** Attempts started. */
  attempt: number;
  /** Whether attempt `attempt` is out. Still true on waking means the object died during it. */
  running: boolean;
  queue: Queue | null;
  failures: Failure[];
  payment: Payment | null;
  reason: string | null;
  keeping: Keeping | null;
}

/** One run's model calls: written only by `turn`, which runs while `advance` waits on the container. */
interface RunLog {
  turns: number;
  /** What this run has spent at 0G. */
  tokens: number;
  /** The size of the pot's turns so far: this run's and the one's before it. */
  bytes: number;
  failure: Failure | null;
}

const HEARING = 'hearing';
const LOG = 'text:log';
const INSTRUCTIONS = 'text:instructions';
const RECORD = 'text:record';
const runKey = (attempt: number) => `run:${attempt}`;
const turnKey = (attempt: number, index: number) => `text:turn:${attempt}:${index}`;

const LOST = failed('lost', 'the run was lost');
const OVER: TurnReply = { status: 409, body: JSON.stringify({ error: 'this run is over' }) };

const refused = (why: string): TurnReply => ({ status: 502, body: JSON.stringify({ error: why }) });

/** The limit `run` has passed, or would pass with this much more. */
function limitPassed({ tokens, bytes }: RunLog, moreTokens = 0, moreBytes = 0): string | null {
  if (tokens + moreTokens > LIMITS.tokens) return 'the run passed its token limit';
  if (bytes + moreBytes > LIMITS.turnsBytes) return 'the pot passed its size limit';
  return null;
}

/** The Durable Object's name for a pot. */
export const judgementName = (box: string, round: string) => `${box}:${round}`;

function statusOf(hearing: Hearing): JudgeStatus {
  const { phase, payment, reason } = hearing;
  return {
    state: phase,
    payouts: phase === 'paying' || phase === 'paid' ? (payment?.payouts ?? null) : null,
    tx: payment?.tx ?? null,
    record: payment?.record ?? null,
    reason,
  };
}

export class Judge {
  private readonly deps: JudgeDeps;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(deps: JudgeDeps) {
    this.deps = deps;
  }

  /** This pot's judgement: its status if `logHash` is the log it is judging, `ANOTHER_LOG` if not, or null if none. */
  async find(logHash: Hex): Promise<JudgeStatus | typeof ANOTHER_LOG | null> {
    const hearing = await this.load();
    if (!hearing) return null;
    return hearing.logHash === logHash ? statusOf(hearing) : ANOTHER_LOG;
  }

  async status(): Promise<JudgeStatus | null> {
    const hearing = await this.load();
    return hearing ? statusOf(hearing) : null;
  }

  async audit(): Promise<AuditView | null> {
    const hearing = await this.load();
    if (!hearing) return null;
    return { record: hearing.payment?.record ?? null, root: hearing.keeping?.root ?? null, tx: hearing.keeping?.tx ?? null };
  }

  /** The sealed record's exact text, or null before it is sealed and after it has landed. */
  async recordText(): Promise<string | null> {
    return (await getText(this.deps.store, RECORD)) ?? null;
  }

  /** Opens the one judgement this pot gets. A repeat of the same log gets the running one. */
  begin(job: JudgeJob): Promise<JudgeStatus | typeof ANOTHER_LOG> {
    return this.serial(async () => {
      const found = await this.find(job.logHash);
      if (found) return found;
      const { log, instructions, ...fields } = job;
      await putText(this.deps.store, LOG, log);
      await putText(this.deps.store, INSTRUCTIONS, instructions);
      const hearing: Hearing = {
        ...fields,
        phase: 'judging',
        attempt: 0,
        running: false,
        queue: null,
        failures: [],
        payment: null,
        reason: null,
        keeping: null,
      };
      await this.save(hearing, this.deps.now());
      return statusOf(hearing);
    });
  }

  /** One model call from attempt `attempt`'s container. One at a time, so the turns keep their order. */
  modelTurn(attempt: number, text: string): Promise<TurnReply> {
    return this.serial(() => this.turn(attempt, text));
  }

  /** Does what is due, and returns when to run again, or null if nothing is left. Safe to run again after any crash. */
  async advance(): Promise<number | null> {
    const hearing = await this.load();
    if (!hearing) return null;
    if (hearing.phase === 'judging') await this.hear(hearing);
    if (hearing.phase === 'paying') await this.pay(hearing);
    if (hearing.keeping && !hearing.keeping.root) await this.keep(hearing, hearing.keeping);
    return this.nextWake(hearing);
  }

  private nextWake({ phase, payment, keeping, queue }: Hearing): number | null {
    if (phase === 'judging') return Math.max(queue?.nextAt ?? 0, this.deps.now());
    if (phase === 'paying') return (payment as Payment).nextAt;
    return keeping && !keeping.root ? keeping.nextAt : null;
  }

  private async turn(attempt: number, text: string): Promise<TurnReply> {
    const { store, proxy } = this.deps;
    if (!(await this.isLive(attempt))) return OVER;
    const run = await this.runLog(attempt);
    if (run.failure) return refused(run.failure.why);
    // Before sending: what a call would cost is checked here, as a shell's call is checked by nothing else.
    const bytes = utf8Bytes(text);
    const passed = run.turns >= LIMITS.turns ? 'the run passed its turn limit' : limitPassed(run, estimateTokens(bytes), bytes);
    if (passed) {
      run.failure = failed('container', passed);
      await store.put(runKey(attempt), run);
      return refused(passed);
    }
    const result = await proxyTurn(proxy, text);
    // The run may have ended while 0G answered, and a run that ended keeps what it had.
    if (!(await this.isLive(attempt))) return OVER;
    if (result.turn) {
      const turn = JSON.stringify(result.turn);
      await putText(store, turnKey(attempt, run.turns), turn);
      run.turns += 1;
      run.bytes += utf8Bytes(turn);
    }
    if (result.ok) run.tokens += result.tokens;
    else run.failure = result.failure;
    const spent = limitPassed(run);
    if (spent) run.failure ??= failed('container', spent);
    await store.put(runKey(attempt), run);
    return !result.ok || run.failure ? refused((run.failure as Failure).why) : { status: 200, body: result.reply };
  }

  /** The run's log. A new run starts with the size its pot has reached, as the limit on that is the pot's. */
  private async runLog(attempt: number): Promise<RunLog> {
    const { store } = this.deps;
    const run = await store.get<RunLog>(runKey(attempt));
    if (run) return run;
    const before = await store.get<RunLog>(runKey(attempt - 1));
    return { turns: 0, tokens: 0, bytes: before?.bytes ?? 0, failure: null };
  }

  private async isLive(attempt: number): Promise<boolean> {
    const hearing = await this.load();
    return hearing?.phase === 'judging' && hearing.running && hearing.attempt === attempt;
  }

  /** Runs one attempt on a fresh container, or sends the pot to be voided if none are left. */
  private async hear(hearing: Hearing): Promise<void> {
    if (hearing.running) await this.fail(hearing, LOST);
    if (hearing.phase !== 'judging') return;
    const { store, runner, now } = this.deps;
    if (hearing.queue && now() < hearing.queue.nextAt) return;
    hearing.attempt += 1;
    hearing.running = true;
    await this.save(hearing, now() + LIMITS.leaseMs);
    const [log, instructions] = await Promise.all([getText(store, LOG), getText(store, INSTRUCTIONS)]);
    const result = await runner.run(
      { judgement: judgementName(hearing.box, hearing.round), attempt: hearing.attempt },
      { log: log as string, instructions: instructions as string },
    );
    if (await this.queued(hearing, result)) return;
    const outcome = await this.weigh(hearing, result);
    if ('failure' in outcome) await this.fail(hearing, outcome.failure);
    else await this.close(hearing, outcome.verdict);
  }

  /** Puts a run that found no free container back in line. It never started, so it costs no attempt: one Box filling the
   *  pool mustn't void another's match. Past `queueMs` it counts as failed, so a full pool can't outlast the refund. */
  private async queued(hearing: Hearing, result: RunResult): Promise<boolean> {
    if (!('failure' in result) || result.failure.kind !== 'full') return false;
    const { now } = this.deps;
    const { since, tries } = hearing.queue ?? { since: now(), tries: 0 };
    if (now() - since >= LIMITS.queueMs) return false;
    hearing.queue = { since, tries: tries + 1, nextAt: now() + backoff(tries, LIMITS.retryMs, LIMITS.queueRetryMaxMs) };
    hearing.attempt -= 1;
    hearing.running = false;
    await this.save(hearing);
    return true;
  }

  /** What a finished run comes to. A bad turn fails it whatever the container answered. */
  private async weigh(hearing: Hearing, result: RunResult): Promise<{ verdict: AgentVerdict } | { failure: Failure }> {
    const run = await this.deps.store.get<RunLog>(runKey(hearing.attempt));
    if (run?.failure) return { failure: run.failure };
    if ('failure' in result) return result;
    const read = readVerdict(result.verdict, hearing);
    if ('problem' in read) return { failure: failed('verdict', read.problem) };
    if (read.verdict.kind === 'cannot_judge') {
      return { failure: { ...failed('cannot_judge', 'the agent could not judge this match'), answer: read.verdict } };
    }
    if (!run?.turns) return { failure: failed('tee', 'a verdict from no model turn') };
    return read;
  }

  /** Counts a failed run. With no attempts left, the pot is voided. */
  private async fail(hearing: Hearing, failure: Failure): Promise<void> {
    hearing.failures.push(failure);
    hearing.running = false;
    if (hearing.attempt < LIMITS.attempts) return this.save(hearing);
    return this.close(hearing, failure.answer ?? { kind: 'failed', why: this.failures(hearing) });
  }

  private failures(hearing: Hearing): string {
    return hearing.failures.map(({ why }) => why).join('; ');
  }

  /** Builds the audit record and moves on to paying. Nothing is signed yet: this step can safely be lost. */
  private async close(hearing: Hearing, verdict: AuditRecord['verdict']): Promise<void> {
    const { store, now } = this.deps;
    const sealed = await this.seal(hearing, verdict);
    await putText(store, RECORD, sealed.text);
    hearing.phase = 'paying';
    hearing.running = false;
    hearing.reason = verdict.kind === 'split' ? null : this.failures(hearing);
    hearing.payment = {
      kind: verdict.kind === 'split' ? 'verdict' : 'void',
      payouts: verdict.kind === 'split' ? verdict.payouts : null,
      record: sealed.hash,
      until: now() + LIMITS.payForMs,
      deadline: null,
      signature: null,
      txId: null,
      tx: null,
      sends: 0,
      nextAt: now(),
    };
    await this.save(hearing);
  }

  private async seal(hearing: Hearing, verdict: AuditRecord['verdict']) {
    const { store } = this.deps;
    const turns: AgentTurn[] = [];
    for (let attempt = 1; attempt <= hearing.attempt; attempt++) {
      const run = await store.get<RunLog>(runKey(attempt));
      for (let index = 0; index < (run?.turns ?? 0); index++) {
        turns.push(JSON.parse((await getText(store, turnKey(attempt, index))) as string) as AgentTurn);
      }
    }
    return sealRecord({
      bundle: hearing.bundle,
      instructions: (await getText(store, INSTRUCTIONS)) as string,
      log: (await getText(store, LOG)) as string,
      attempts: hearing.attempt,
      turns,
      verdict,
    });
  }

  /** Moves the payment along. The pot's state decides: once it isn't open, no send can do anything. */
  private async pay(hearing: Hearing): Promise<void> {
    const { now, potState, relayer, scrub } = this.deps;
    const payment = hearing.payment as Payment;
    if (now() < payment.nextAt) return;
    const state = await potState(hearing.box, BigInt(hearing.round)).catch((error: unknown) => {
      console.error(`reading the pot failed: ${scrub(error)}`);
      return null;
    });
    if (state !== null && state >= POT_STATE.settled) return this.closed(hearing, state);
    if (now() > payment.until) return this.giveUp(hearing);
    if (state === null) return this.waitAndSave(hearing, payment, this.retryWait(payment));

    if (payment.txId) {
      const tx = await relayer.tx(payment.txId);
      if (tx?.hash) payment.tx = tx.hash;
      if (tx?.status !== 'failed') return this.waitAndSave(hearing, payment, LIMITS.pollMs);
      // The transaction is gone, and the relayer remembers its digest: only a new signature can go again.
      payment.txId = null;
      payment.signature = null;
    }
    await this.send(hearing, payment);
  }

  private async send(hearing: Hearing, payment: Payment): Promise<void> {
    const { relayer } = this.deps;
    await this.sign(hearing, payment);
    // Saved before it leaves: dying from here on resends these same bytes.
    await this.save(hearing);
    const { box, round } = hearing;
    const { record, deadline, signature, payouts } = payment;
    const sent =
      payment.kind === 'verdict'
        ? await relayer.send('/store/settle', { verdict: { box, round, payouts, record, deadline }, signature })
        : await relayer.send('/store/void', { void: { box, round, record, deadline }, signature });
    payment.sends += 1;
    if ('refused' in sent) return this.waitAndSave(hearing, payment, this.retryWait(payment));
    payment.txId = sent.tx.id;
    payment.tx = sent.tx.hash ?? null;
    return this.waitAndSave(hearing, payment, LIMITS.pollMs);
  }

  /** Signs if there is no signature, or the one there is won't reach a block in time. The message only ever changes in
   *  its deadline: the split and the record are fixed. */
  private async sign(hearing: Hearing, payment: Payment): Promise<void> {
    const { now, signer } = this.deps;
    const seconds = Math.floor(now() / 1000);
    if (payment.signature && Number(payment.deadline) > seconds + LIMITS.signMarginSeconds) return;
    const deadline = BigInt(seconds + LIMITS.signedForSeconds);
    const message = { box: hearing.box, round: BigInt(hearing.round), record: payment.record, deadline };
    payment.signature = payment.payouts
      ? await signer.signVerdict({ ...message, payouts: payment.payouts.map(BigInt) })
      : await signer.signVoid(message);
    payment.deadline = deadline.toString();
  }

  private retryWait(payment: Payment): number {
    return backoff(payment.sends, LIMITS.retryMs, LIMITS.retryMaxMs);
  }

  private waitAndSave(hearing: Hearing, payment: Payment, ms: number): Promise<void> {
    payment.nextAt = this.deps.now() + ms;
    return this.save(hearing);
  }

  /** The chain says the pot is closed, whoever closed it. */
  private closed(hearing: Hearing, state: number): Promise<void> {
    hearing.phase = state === POT_STATE.settled ? 'paid' : 'refunded';
    if (state === POT_STATE.settled) hearing.reason = null;
    else if ((hearing.payment as Payment).kind === 'verdict') hearing.reason = 'the pot was refunded before the verdict landed';
    return this.startKeeping(hearing);
  }

  /** Past `until` the pot is open to anyone's refund, and the Box's sweep does that. */
  private giveUp(hearing: Hearing): Promise<void> {
    hearing.phase = 'failed';
    hearing.reason = 'the payment could not be sent, so the pot waits for its refund';
    return this.startKeeping(hearing);
  }

  private startKeeping(hearing: Hearing): Promise<void> {
    hearing.keeping = { tries: 0, nextAt: this.deps.now(), root: null, tx: null };
    return this.save(hearing);
  }

  /** Tries to land the audit record. It only starts once the pot is closed, so it can't get in the way of paying. */
  private async keep(hearing: Hearing, keeping: Keeping): Promise<void> {
    const { store, audits, now, scrub } = this.deps;
    if (now() < keeping.nextAt) return;
    try {
      const landed = await audits.put((await getText(store, RECORD)) as string, {
        paid: keeping.tx,
        onPaid: (tx) => {
          keeping.tx = tx;
          return this.save(hearing);
        },
      });
      keeping.root = landed.root;
      keeping.tx = landed.tx ?? keeping.tx;
      await this.save(hearing);
      await this.forget(hearing);
    } catch (error) {
      console.error(`uploading the record failed: ${scrub(error)}`);
      keeping.nextAt = now() + backoff(keeping.tries, LIMITS.uploadRetryMs, LIMITS.uploadRetryMaxMs);
      keeping.tries += 1;
      await this.save(hearing);
    }
  }

  /** Drops the texts: the record has landed, and it holds them all. */
  private async forget(hearing: Hearing): Promise<void> {
    const { store } = this.deps;
    for (let attempt = 1; attempt <= hearing.attempt; attempt++) {
      const run = await store.get<RunLog>(runKey(attempt));
      for (let index = 0; index < (run?.turns ?? 0); index++) await deleteText(store, turnKey(attempt, index));
      await store.delete(runKey(attempt));
    }
    await Promise.all([LOG, INSTRUCTIONS, RECORD].map((key) => deleteText(store, key)));
  }

  private load(): Promise<Hearing | undefined> {
    return this.deps.store.get<Hearing>(HEARING);
  }

  /** Saves, and with `wakeAt` sets the alarm in the same tick, so the two are one write. */
  private async save(hearing: Hearing, wakeAt?: number): Promise<void> {
    await Promise.all([this.deps.store.put(HEARING, hearing), wakeAt === undefined ? undefined : this.deps.wake(wakeAt)]);
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.catch(() => undefined);
    return run;
  }
}
