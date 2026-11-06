// The demo Box: what the Pi does, with a software key. It signs heartbeats (`P256Account.execute` writing `lastSeen`,
// and `game` when it changes), match stakes and match results, and sends them through the relayer. A stake and the
// result that settles it share one round.
//
// `Box` is the logic over a plain store, chain and relayer; the tests run it in memory, and the `DemoBox` Durable
// Object (`object.ts`) runs it with an alarm that beats every 5 minutes.

import {
  BOX_KEYS,
  type DemoBoxView,
  type ReportResponse,
  type Result,
  type ResultRequest,
  type Stake,
  type StakeRequest,
  formatUsdc,
  fullName,
  labelProblem,
  resultDigest,
  stakeDigest,
  usdc,
} from '@egb/shared/names';
import { Limits } from '@egb/relayer/limits';
import type { Store } from '@egb/relayer/store';
import { type Address, getAddress, isAddress, isAddressEqual } from 'viem';

import type { BoxChain, BoxInfo } from './chain.ts';
import { setTextCall, signedExecute } from './execute.ts';
import type { Relayer, Reply } from './relayer.ts';
import type { Signer } from './signer.ts';

export interface BoxOptions {
  store: Store;
  chain: BoxChain;
  signer: Signer;
  /** The Box's `P256Account`. */
  account: Address;
  /** The Box's own name's label, e.g. `mumbai-01`. */
  label: string;
  /** The `game` a Box shows before its first result. */
  defaultGame: string;
  /** `BoxResults`, the verifying contract of `Result`. */
  results: Address;
  /** `DuelPot`, the verifying contract of `Stake`. */
  pot: Address;
  relayer: Relayer;
  /** Unix seconds. */
  now: () => number;
  /** A fresh `P256Account` nonce: any unused one works, in any order. */
  nonce: () => bigint;
}

/** How long a signed heartbeat, stake or result stays valid, in seconds. */
export const DEADLINE = 600;
/** The largest stake the demo Box vouches for: the Box's own largest. */
export const MAX_STAKE = usdc(25);
const RESULT_LIMITS = [{ key: 'result:ip', max: 10, windowSeconds: 3600, what: '10 results per hour from one address' }];
const STAKE_LIMITS = [{ key: 'stake:ip', max: 10, windowSeconds: 3600, what: '10 stakes per hour from one address' }];

const refuse = (status: number, error: string): Reply => ({ status, body: { error } });

export class Box {
  private readonly options: BoxOptions;
  private readonly limits: Limits;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(options: BoxOptions) {
    this.options = options;
    this.limits = new Limits(options.store);
  }

  async view(): Promise<DemoBoxView> {
    const { store, signer, account, label } = this.options;
    return {
      label,
      account,
      qx: signer.qx,
      qy: signer.qy,
      lastSeen: (await store.get<number>('lastSeen')) ?? null,
      heartbeat: (await store.get<string[]>('heartbeat')) ?? [],
    };
  }

  /**
   * Writes `lastSeen` on the Box's own name, and `game` too if the record (read first, which costs nothing) is not
   * the game the Box is running: one signed request. Pop-ups are linked to this record, so they show the same beat.
   * Returns the relayer's request ids.
   */
  async heartbeat(): Promise<string[]> {
    const { chain, store, signer, account, label, defaultGame, relayer, now, nonce } = this.options;
    const at = now();
    const box = await chain.box(label);
    if (!this.runs(box) || box.expiry <= at) return [];
    const game = (await store.get<string>('game')) ?? defaultGame;
    const calls = [setTextCall(box.resolver, label, BOX_KEYS.lastSeen, String(at))];
    if ((await chain.text(box.resolver, label, BOX_KEYS.game)) !== game) {
      calls.push(setTextCall(box.resolver, label, BOX_KEYS.game, game));
    }
    const reply = await relayer.post('/account/execute', signedExecute(signer, account, calls, nonce(), BigInt(at + DEADLINE)));
    if (reply.status !== 202) {
      console.warn(`heartbeat ${label}: ${reply.status} ${String(reply.body.error)}`);
      return [];
    }
    const ids = [String(reply.body.id)];
    await store.put('lastSeen', at);
    await store.put('heartbeat', ids);
    return ids;
  }

  /** Signs `{ box, game, winner, loser, draw, round? }` and sends it: for the round of a pot this Box opened, or the
   *  next round. Reports and stakes run one at a time. */
  report(input: unknown, ip: string): Promise<Reply> {
    return this.serial(() => this.reportNow(input, ip));
  }

  /** Signs `{ box, game, a, b, amount }` as a `Stake` with the next round and sends it to `/duel/open`. A
   *  `POST /result` with that round settles the pot. */
  stake(input: unknown, ip: string): Promise<Reply> {
    return this.serial(() => this.stakeNow(input, ip));
  }

  private serial(task: () => Promise<Reply>): Promise<Reply> {
    const run = this.tail.then(task);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async reportNow(input: unknown, ip: string): Promise<Reply> {
    const { store, signer, results, relayer, now } = this.options;
    const parsed = parseReport(input);
    if (typeof parsed === 'string') return refuse(400, parsed);
    const at = now();
    const refusal = await this.admit(RESULT_LIMITS, ip, parsed.box, at);
    if (refusal) return refusal;
    const { round: staked, ...report } = parsed;
    if (staked !== undefined && !(await store.get<boolean>(potKey(report.box, staked)))) {
      return refuse(409, `round ${staked} is not an open pot of ${fullName(report.box)}`);
    }

    await this.limits.take(this.ipLimits(RESULT_LIMITS, ip), at);
    const round = staked ?? (await this.nextRound(report.box));
    const result: Result = { ...report, round, deadline: BigInt(at + DEADLINE) };
    const body: ResultRequest = {
      result: { ...result, round: String(round), deadline: String(result.deadline) },
      ...signer.sign(resultDigest(result, results)),
    };
    const reply = await relayer.post('/box/result', body);
    if (reply.status !== 202) return reply;
    await store.put('game', report.game);
    if (staked !== undefined) await store.delete(potKey(report.box, staked));
    return { status: 202, body: { id: String(reply.body.id), round: Number(round) } satisfies ReportResponse };
  }

  private async stakeNow(input: unknown, ip: string): Promise<Reply> {
    const { store, signer, pot, relayer, now } = this.options;
    const parsed = parseStake(input);
    if (typeof parsed === 'string') return refuse(400, parsed);
    const at = now();
    const refusal = await this.admit(STAKE_LIMITS, ip, parsed.box, at);
    if (refusal) return refusal;

    await this.limits.take(this.ipLimits(STAKE_LIMITS, ip), at);
    const round = await this.nextRound(parsed.box);
    const stake: Stake = { ...parsed, round, deadline: BigInt(at + DEADLINE) };
    const body: StakeRequest = {
      stake: { ...stake, round: String(round), amount: String(stake.amount), deadline: String(stake.deadline) },
      ...signer.sign(stakeDigest(stake, pot)),
    };
    const reply = await relayer.post('/duel/open', body);
    if (reply.status !== 202) return reply;
    await store.put(potKey(stake.box, round), true);
    return { status: 202, body: { id: String(reply.body.id), round: Number(round) } satisfies ReportResponse };
  }

  /** A refusal if `ip` is over `limits` or the Box is not this one, else `null`. */
  private async admit(limits: typeof RESULT_LIMITS, ip: string, box: string, at: number): Promise<Reply | null> {
    const hit = await this.limits.exceeded(this.ipLimits(limits, ip), at);
    if (hit) return refuse(429, `rate limit: ${hit.what}`);
    if (box !== this.options.label || !this.runs(await this.options.chain.box(box))) {
      return refuse(403, `the demo Box does not run ${fullName(box)}`);
    }
    return null;
  }

  private ipLimits(limits: typeof RESULT_LIMITS, ip: string) {
    return limits.map((limit) => ({ ...limit, key: `${limit.key}:${ip}` }));
  }

  /** The round after the last one this Box signed, skipping any the chain already has a result or a pot for. */
  private async nextRound(box: string): Promise<bigint> {
    const { store, chain } = this.options;
    let round = BigInt((await store.get<number>(`round:${box}`)) ?? 0) + 1n;
    while (await chain.roundTaken(box, round)) round++;
    await store.put(`round:${box}`, Number(round));
    return round;
  }

  private runs(box: BoxInfo): boolean {
    return box.status !== 0 && isAddressEqual(box.account, this.options.account);
  }
}

type Report = Pick<Result, 'box' | 'game' | 'winner' | 'loser' | 'draw'> & { round?: bigint };
type StakeReport = Pick<Stake, 'box' | 'game' | 'a' | 'b' | 'amount'>;

const potKey = (box: string, round: bigint) => `pot:${box}:${round}`;

/** `field` of `body` as a label, or why it isn't one. */
function label(body: Record<string, unknown>, field: string): string | { problem: string } {
  const value = body[field];
  if (typeof value !== 'string') return { problem: `${field}: expected a label` };
  const problem = labelProblem(value);
  return problem ? { problem: `${field}: ${problem}` } : value;
}

/** `field` of `body` as an address, or `null`. */
function address(body: Record<string, unknown>, field: string): Address | null {
  const value = body[field];
  return typeof value === 'string' && isAddress(value, { strict: false }) ? getAddress(value) : null;
}

/** `field` of `body` as a positive integer (a decimal string or a safe integer), or `null`. */
function positive(body: Record<string, unknown>, field: string): bigint | null {
  const value = body[field];
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return BigInt(value);
  if (typeof value === 'string' && /^[1-9][0-9]{0,30}$/.test(value)) return BigInt(value);
  return null;
}

/** The report, or why it is malformed. */
function parseReport(input: unknown): Report | string {
  if (typeof input !== 'object' || input === null) return 'body: expected { box, game, winner, loser, draw, round? }';
  const body = input as Record<string, unknown>;
  const box = label(body, 'box');
  if (typeof box !== 'string') return box.problem;
  const game = label(body, 'game');
  if (typeof game !== 'string') return game.problem;
  const winner = address(body, 'winner');
  if (!winner) return 'winner: expected an address';
  const loser = address(body, 'loser');
  if (!loser) return 'loser: expected an address';
  if (typeof body.draw !== 'boolean') return 'draw: expected true or false';
  const round = body.round === undefined ? undefined : positive(body, 'round');
  if (round === null) return 'round: expected a positive integer';
  return { box, game, winner, loser, draw: body.draw, ...(round !== undefined && { round }) };
}

/** The stake, or why it is malformed. */
function parseStake(input: unknown): StakeReport | string {
  if (typeof input !== 'object' || input === null) return 'body: expected { box, game, a, b, amount }';
  const body = input as Record<string, unknown>;
  const box = label(body, 'box');
  if (typeof box !== 'string') return box.problem;
  const game = label(body, 'game');
  if (typeof game !== 'string') return game.problem;
  const a = address(body, 'a');
  if (!a) return 'a: expected an address';
  const b = address(body, 'b');
  if (!b) return 'b: expected an address';
  if (a === b) return 'b: the same player as a';
  const amount = positive(body, 'amount');
  if (amount === null) return 'amount: expected a positive integer of USDC base units';
  if (amount > MAX_STAKE) return `amount: at most ${formatUsdc(MAX_STAKE)} USDC`;
  return { box, game, a, b, amount };
}
