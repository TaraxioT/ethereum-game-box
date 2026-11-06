// The demo Box: what the Pi does, with a software key. It signs heartbeats (`BoxAccount.execute` writing `lastSeen`
// and `game`) and match results, and sends them through the relayer.
//
// `Box` is the logic over a plain store, chain and relayer (the tests run it in memory); `DemoBox` is the Durable
// Object around it, whose alarm beats every 5 minutes.

import {
  BOX_KEYS,
  type DemoBoxView,
  type ExecuteRequest,
  type ReportResponse,
  type Result,
  type ResultRequest,
  contractAddress,
  executeDigest,
  fullName,
  labelProblem,
  permissionedResolverAbi,
  resultDigest,
} from '@egb/shared/names';
import { describe } from '@egb/relayer/chain';
import { Limits } from '@egb/relayer/limits';
import type { Store } from '@egb/relayer/store';
import { DurableObject } from 'cloudflare:workers';
import { type Address, type Hex, encodeFunctionData, getAddress, isAddress, isAddressEqual, toHex } from 'viem';
import { packetToBytes } from 'viem/ens';

import { type BoxChain, type BoxInfo, sepoliaChain } from './chain.ts';
import type { Env } from './env.ts';
import { type Signer, p256Signer } from './signer.ts';

/** The relayer, as the Box sees it: a JSON POST. */
export type RelayerPost = (path: string, body: unknown) => Promise<Reply>;

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

export interface BoxOptions {
  store: Store;
  chain: BoxChain;
  signer: Signer;
  /** The Box's `BoxAccount`. */
  account: Address;
  /** The Box's own name's label, e.g. `mumbai-01`. */
  label: string;
  /** The `game` a Box shows before its first result. */
  defaultGame: string;
  /** `BoxResults`, the verifying contract of `Result`. */
  results: Address;
  post: RelayerPost;
  /** Unix seconds. */
  now: () => number;
  /** A fresh `BoxAccount` nonce: any unused one works, in any order. */
  nonce: () => bigint;
}

/** How long a signed heartbeat or result stays valid, in seconds. */
const DEADLINE = 600;
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
   * Writes `lastSeen` on its own name and on every live pop-up it runs, and `game` where it differs from the game
   * the Box is running. Returns the relayer's request ids.
   */
  async heartbeat(): Promise<string[]> {
    const { chain, store, label, defaultGame, post, now } = this.options;
    const at = now();
    const ids: string[] = [];
    for (const boxLabel of [label, ...(await chain.recentPopups())]) {
      const box = await chain.box(boxLabel);
      if (!this.runs(box) || box.expiry <= at) continue;
      const game = (await store.get<string>(`game:${boxLabel}`)) ?? defaultGame;
      const writes: [string, string][] = [[BOX_KEYS.lastSeen, String(at)]];
      if ((await chain.game(box, boxLabel)) !== game) writes.push([BOX_KEYS.game, game]);
      for (const [key, value] of writes) {
        const reply = await post('/box/execute', this.signedWrite(box, boxLabel, key, value, at));
        if (reply.status === 202) ids.push(String(reply.body.id));
        else console.warn(`heartbeat ${boxLabel} ${key}: ${reply.status} ${String(reply.body.error)}`);
      }
    }
    if (ids.length > 0) {
      await store.put('lastSeen', at);
      await store.put('heartbeat', ids);
    }
    return ids;
  }

  /** Signs `{ box, game, winner, loser, draw }` with the next round and sends it. Reports run one at a time. */
  report(input: unknown, ip: string): Promise<Reply> {
    const run = this.tail.then(() => this.reportNow(input, ip));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async reportNow(input: unknown, ip: string): Promise<Reply> {
    const { store, chain, signer, results, post, now } = this.options;
    const parsed = parseReport(input);
    if (typeof parsed === 'string') return refuse(400, parsed);
    const limits = RESULT_LIMITS.map((limit) => ({ ...limit, key: `${limit.key}:${ip}` }));
    const at = now();
    const hit = await this.limits.exceeded(limits, at);
    if (hit) return refuse(429, `rate limit: ${hit.what}`);
    if (!this.runs(await chain.box(parsed.box))) return refuse(403, `the demo Box does not run ${fullName(parsed.box)}`);

    await this.limits.take(limits, at);
    const round = await this.nextRound(parsed.box);
    const result: Result = { ...parsed, round, deadline: BigInt(at + DEADLINE) };
    const body: ResultRequest = {
      result: { ...result, round: String(round), deadline: String(result.deadline) },
      ...signer.sign(resultDigest(result, results)),
    };
    const reply = await post('/box/result', body);
    if (reply.status !== 202) return reply;
    await store.put(`game:${parsed.box}`, parsed.game);
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

  private signedWrite(box: BoxInfo, label: string, key: string, value: string, at: number): ExecuteRequest {
    const { signer, account, nonce } = this.options;
    const call = {
      target: box.resolver,
      value: 0n,
      data: encodeFunctionData({
        abi: permissionedResolverAbi,
        functionName: 'setText',
        args: [toHex(packetToBytes(fullName(label))), key, value],
      }),
      nonce: nonce(),
      deadline: BigInt(at + DEADLINE),
    };
    return {
      account,
      ...call,
      value: '0',
      nonce: String(call.nonce),
      deadline: String(call.deadline),
      ...signer.sign(executeDigest(call, account)),
    };
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

/** How often the Box beats. */
const HEARTBEAT_MS = 5 * 60_000;

export class DemoBox extends DurableObject<Env> {
  private made: Box | undefined;

  /** Built on first use, so a missing address or secret is an error on that call, not a broken object. */
  private get box(): Box {
    if (this.made) return this.made;
    const contracts = deployedContracts();
    this.made = new Box({
      store: this.ctx.storage,
      chain: sepoliaChain(this.env.SEPOLIA_RPC_URL, contracts),
      signer: p256Signer(this.env.DEMO_BOX_P256_KEY as Hex),
      account: contractAddress('DemoBoxAccount'),
      label: this.env.BOX_LABEL,
      defaultGame: this.env.DEFAULT_GAME,
      results: contracts.results,
      post: relayerPost(this.env),
      now: () => Math.floor(Date.now() / 1000),
      nonce: randomNonce,
    });
    return this.made;
  }

  view(): Promise<DemoBoxView> {
    return this.box.view();
  }

  report(input: unknown, ip: string): Promise<Reply> {
    return this.box.report(input, ip);
  }

  /** Starts the heartbeat if it isn't running: the first beat is now. */
  async start(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now());
  }

  override async alarm(): Promise<void> {
    try {
      await this.box.heartbeat();
    } catch (error) {
      console.error(`heartbeat failed: ${describe(error)}`);
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
    }
  }
}

function deployedContracts() {
  return {
    names: contractAddress('GameBoxNames'),
    results: contractAddress('BoxResults'),
    licences: contractAddress('DemoLicences'),
  };
}

/** POSTs to the relayer: through the service binding when there is one (a Worker can't fetch another Worker's
 * workers.dev URL on the same account), else to `RELAYER_URL`. */
function relayerPost(env: Env): RelayerPost {
  return async (path, body) => {
    const request = new Request(new URL(path, env.RELAYER_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const response = await (env.RELAYER ? env.RELAYER.fetch(request) : fetch(request));
    const json = (await response.json().catch(() => ({ error: `relayer answered ${response.status}` }))) as Reply['body'];
    return { status: response.status, body: json };
  };
}

/** A random 128-bit `BoxAccount` nonce: nonces are unordered, so a random one never collides in practice. */
function randomNonce(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return BigInt(toHex(bytes));
}
