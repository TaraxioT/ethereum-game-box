// The demo Box: what the Pi does, with a software key. It signs heartbeats (`P256Account.execute` writing `lastSeen`,
// and `game` when it changes) and match results, and sends them through the relayer.
//
// `Box` is the logic over a plain store, chain and relayer; the tests run it in memory, and the `DemoBox` Durable
// Object (`object.ts`) runs it with an alarm that beats every 5 minutes.

import {
  BOX_KEYS,
  type DemoBoxView,
  type ReportResponse,
  type Result,
  type ResultRequest,
  fullName,
  labelProblem,
  resultDigest,
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
  relayer: Relayer;
  /** Unix seconds. */
  now: () => number;
  /** A fresh `P256Account` nonce: any unused one works, in any order. */
  nonce: () => bigint;
}

/** How long a signed heartbeat or result stays valid, in seconds. */
export const DEADLINE = 600;
const RESULT_LIMITS = [{ key: 'result:ip', max: 10, windowSeconds: 3600, what: '10 results per hour from one address' }];

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

  /** Signs `{ box, game, winner, loser, draw }` with the next round and sends it. Reports run one at a time. */
  report(input: unknown, ip: string): Promise<Reply> {
    const run = this.tail.then(() => this.reportNow(input, ip));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async reportNow(input: unknown, ip: string): Promise<Reply> {
    const { store, chain, signer, label, results, relayer, now } = this.options;
    const parsed = parseReport(input);
    if (typeof parsed === 'string') return refuse(400, parsed);
    const limits = RESULT_LIMITS.map((limit) => ({ ...limit, key: `${limit.key}:${ip}` }));
    const at = now();
    const hit = await this.limits.exceeded(limits, at);
    if (hit) return refuse(429, `rate limit: ${hit.what}`);
    if (parsed.box !== label || !this.runs(await chain.box(parsed.box))) {
      return refuse(403, `the demo Box does not run ${fullName(parsed.box)}`);
    }

    await this.limits.take(limits, at);
    const round = await this.nextRound(parsed.box);
    const result: Result = { ...parsed, round, deadline: BigInt(at + DEADLINE) };
    const body: ResultRequest = {
      result: { ...result, round: String(round), deadline: String(result.deadline) },
      ...signer.sign(resultDigest(result, results)),
    };
    const reply = await relayer.post('/box/result', body);
    if (reply.status !== 202) return reply;
    await store.put('game', parsed.game);
    return { status: 202, body: { id: String(reply.body.id), round: Number(round) } satisfies ReportResponse };
  }

  /** The round after the last one this Box reported, skipping any the chain has already settled. */
  private async nextRound(box: string): Promise<bigint> {
    const { store, chain } = this.options;
    let round = BigInt((await store.get<number>(`round:${box}`)) ?? 0) + 1n;
    while (await chain.roundUsed(box, round)) round++;
    await store.put(`round:${box}`, Number(round));
    return round;
  }

  private runs(box: BoxInfo): boolean {
    return box.status !== 0 && isAddressEqual(box.account, this.options.account);
  }
}

type Report = Pick<Result, 'box' | 'game' | 'winner' | 'loser' | 'draw'>;

/** The report, or why it is malformed. */
function parseReport(input: unknown): Report | string {
  if (typeof input !== 'object' || input === null) return 'body: expected { box, game, winner, loser, draw }';
  const { box, game, winner, loser, draw } = input as Record<string, unknown>;
  for (const [field, value] of [['box', box], ['game', game]] as const) {
    if (typeof value !== 'string') return `${field}: expected a label`;
    const problem = labelProblem(value);
    if (problem) return `${field}: ${problem}`;
  }
  for (const [field, value] of [['winner', winner], ['loser', loser]] as const) {
    if (typeof value !== 'string' || !isAddress(value, { strict: false })) return `${field}: expected an address`;
  }
  if (typeof draw !== 'boolean') return 'draw: expected true or false';
  return {
    box: box as string,
    game: game as string,
    winner: getAddress(winner as string),
    loser: getAddress(loser as string),
    draw,
  };
}
