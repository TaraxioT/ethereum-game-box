// One pot on fake rails: a fake Sepolia, fake 0G, a fake relayer that closes the pot the way the chain would, and a fake
// agent that talks to the real proxy the way the container does. Building a second `Judge` on the same `store` is what
// a restart looks like.

import { FakeChain } from '@egb/relayer/test/fake-chain';
import { MemoryStore } from '@egb/relayer/test/memory-store';
import { type Key, boxKey } from '@egb/relayer/test/world';
import { packBundle } from '@egb/sdk/bundle';
import type { MatchLog } from '@egb/sdk';
import { gameBoxNamesAbi } from '@egb/shared/names';
import { type AgentRunRequest, jsonTextHash, judgeDigest, storePotAbi } from '@egb/shared/store';
import { type Abi, type Address, type Hex, custom } from 'viem';
import { generatePrivateKey } from 'viem/accounts';

import type { AdmitContext, Doors } from '../src/admit.ts';
import type { AuditStore, Landed } from '../src/audit-store.ts';
import { failed } from '../src/failure.ts';
import { type AgentRunner, Judge, type RunResult, type Ticket, judgementName } from '../src/judge.ts';
import { POT_STATE } from '../src/pot.ts';
import { type Deps, handle } from '../src/routes.ts';
import { scrubber } from '../src/safe.ts';
import { type PaySigner, verifierSigner } from '../src/signer.ts';
import { SignedChatCheck, cachedServices } from '../src/tee.ts';
import type { PayRelayer, Sent } from '../src/upstream.ts';
import { zgServices } from '../src/zg-chain.ts';
import { FakeZg, SERVING_CONTRACT } from './fake-zg/index.ts';

export const NOW = 1_800_000_000;
export const BOX = 'mumbai-01';
export const ROUND = '42';
export const AMOUNT = '5000000';
export const POT: Address = '0x00000000000000000000000000000000000000f1';
export const NAMES: Address = '0x00000000000000000000000000000000000000f2';
export const PLAYERS: readonly Address[] = [
  '0x1000000000000000000000000000000000000001',
  '0x2000000000000000000000000000000000000002',
];
export const ZG_API_KEY = 'zg-test-api-key';
export const INSTRUCTIONS = 'Most taps takes the pot. On a tie, split it evenly.';
export const RPC_SECRET = 'https://sepolia.example/v3/secret-node-key';

const MANIFEST = {
  format: 1,
  id: 'tap-rush',
  title: 'Tap Rush',
  blurb: 'Most taps in ten seconds takes the pot.',
  players: { min: 2, max: 4 },
  minutes: 1,
  stakes: [5, 10, 25],
  taps: 'identify',
  verifier: { instructions: INSTRUCTIONS },
};

const encode = (text: string) => new TextEncoder().encode(text);

/** A good zip of Tap Rush, and its hash. */
export async function tapRushZip(): Promise<{ zip: Uint8Array; hash: Hex }> {
  const { readBundle } = await import('@egb/sdk/bundle');
  const files = new Map([
    ['index.html', encode('<!doctype html><title>Tap Rush</title>')],
    ['manifest.json', encode(JSON.stringify(MANIFEST))],
  ]);
  const zip = packBundle(files);
  return { zip, hash: (await readBundle(zip)).hash };
}

/** The log of a match where seat 0 tapped twice and seat 1 once. */
export function matchLog(bundle: Hex, overrides: Partial<MatchLog['header']> = {}): MatchLog {
  return {
    header: {
      v: 1,
      box: BOX,
      round: ROUND,
      bundle,
      game: 'tap-rush',
      players: PLAYERS,
      amount: AMOUNT,
      startedAt: 1,
      ...overrides,
    },
    entries: [
      { src: 'box', t: 'tap', seat: 0, at: 2, roll: null },
      { src: 'box', t: 'tap', seat: 1, at: 3, roll: null },
      { src: 'box', t: 'tap', seat: 0, at: 4, roll: null },
      { src: 'game', t: 'event', at: 5, name: 'score', data: { a: 2, b: 1 } },
      { src: 'box', t: 'end', at: 6, why: 'game' },
    ],
  };
}

/** The relayer, closing the pot the way the chain would: only an open pot can be closed. */
export class FakeRelayer implements PayRelayer {
  readonly sends: { path: string; body: { verdict?: unknown; void?: unknown; signature: Hex } }[] = [];
  /** How many sends closed the pot: never more than one. */
  closes = 0;
  /** Statuses to refuse the next sends with: 0 is an unreachable relayer. */
  refusals: number[] = [];
  /** Throws on the next send, before it leaves. */
  crashBeforeSend = false;
  /** Throws on the next send, after it has gone: the worst moment for the verifier to die. */
  crashAfterSend = false;
  /** Leaves the next sent transaction pending until `mine`. */
  holdBlock = false;
  private held: (() => void) | null = null;
  private readonly world: World;
  private txs = new Map<string, { status: 'sent' | 'done' | 'failed' }>();

  constructor(world: World) {
    this.world = world;
  }

  async send(path: '/store/settle' | '/store/void', body: unknown): Promise<Sent> {
    if (this.crashBeforeSend) {
      this.crashBeforeSend = false;
      throw new Crash('died before sending');
    }
    this.sends.push({ path, body: body as FakeRelayer['sends'][number]['body'] });
    const refusal = this.refusals.shift();
    if (refusal !== undefined) return { refused: refusal };
    const state = this.world.pot.state;
    if (state !== POT_STATE.open) return { refused: 409 };
    const id = crypto.randomUUID();
    const close = () => {
      if (this.world.pot.state !== POT_STATE.open) return;
      this.closes += 1;
      this.world.pot.state = path === '/store/settle' ? POT_STATE.settled : POT_STATE.voided;
      this.txs.set(id, { status: 'done' });
    };
    this.txs.set(id, { status: 'sent' });
    if (this.holdBlock) this.held = close;
    else close();
    if (this.crashAfterSend) {
      this.crashAfterSend = false;
      throw new Crash('died after sending');
    }
    return { tx: { id, kind: 'pot-open', status: 'sent', hash: `0x${'ab'.repeat(32)}` } };
  }

  async tx(id: string) {
    const tx = this.txs.get(id);
    return tx ? { id, kind: 'pot-open' as const, status: tx.status, hash: `0x${'ab'.repeat(32)}` as Hex } : null;
  }

  mine(): void {
    this.held?.();
    this.held = null;
  }

  /** Marks every sent transaction as reverted. */
  revertAll(): void {
    for (const tx of this.txs.values()) tx.status = 'failed';
    this.held = null;
  }
}

/** A death in the middle of an alarm. */
export class Crash extends Error {}

/** An audit store that fails until told otherwise, and keeps what lands. */
export class FakeAudits implements AuditStore {
  up = true;
  tries = 0;
  readonly landed: string[] = [];

  async put(text: string): Promise<Landed> {
    this.tries += 1;
    if (!this.up) throw new Error(`upload failed at ${RPC_SECRET}`);
    this.landed.push(text);
    return { root: `0x${'cd'.repeat(32)}`, tx: `0x${'ef'.repeat(32)}` };
  }
}

export type AgentScript = (ticket: Ticket, job: AgentRunRequest) => Promise<RunResult>;

/** The container: runs each attempt's script, or a good agent when none is set. */
export class FakeRunner implements AgentRunner {
  readonly runs: { ticket: Ticket; job: AgentRunRequest }[] = [];
  readonly scripts: AgentScript[] = [];
  private readonly world: World;

  constructor(world: World) {
    this.world = world;
  }

  run(ticket: Ticket, job: AgentRunRequest): Promise<RunResult> {
    this.runs.push({ ticket, job });
    return (this.scripts.shift() ?? this.world.agent())(ticket, job);
  }
}

export class World {
  store = new MemoryStore();
  now = NOW * 1000;
  /** The one alarm, in milliseconds. */
  alarm: number | null = null;
  readonly zg = new FakeZg();
  readonly chain = new FakeChain();
  readonly relayer = new FakeRelayer(this);
  readonly runner = new FakeRunner(this);
  readonly audits = new FakeAudits();
  readonly key = generatePrivateKey();
  readonly signer: PaySigner = verifierSigner(this.key, () => POT);
  readonly box: Key = boxKey();
  /** What `getBox` answers. */
  entry = { status: 1, expiry: BigInt(NOW + 1000) };
  /** What `getPot` answers. */
  pot = {
    players: [...PLAYERS],
    amount: BigInt(AMOUNT),
    opened: BigInt(NOW - 100),
    state: POT_STATE.open as number,
    bundle: `0x${'00'.repeat(32)}` as Hex,
    record: `0x${'00'.repeat(32)}` as Hex,
  };
  /** Thrown by the pot's read, when set. */
  potDown = false;
  zip: { zip: Uint8Array; hash: Hex } | null = null;
  /** What the store answers for a zip, when set. */
  storeReply: (() => Response) | null = null;
  gateHits = 0;
  private latest: Judge | null = null;

  private readonly services = cachedServices(
    zgServices(
      SERVING_CONTRACT,
      custom({
        request: async ({ method, params }) => {
          const reply = await this.zg.handle(
            new Request(`${this.zg.url}/rpc`, { method: 'POST', body: JSON.stringify({ id: 1, method, params }) }),
          );
          return ((await reply.json()) as { result: unknown }).result;
        },
      }),
    ),
    () => 0,
  );

  constructor() {
    const box = this.box;
    this.chain.contract(NAMES, gameBoxNamesAbi as Abi, {
      getBox: () => ({
        operator: PLAYERS[0],
        account: PLAYERS[1],
        qx: box.qx,
        qy: box.qy,
        status: this.entry.status,
        resolver: PLAYERS[0],
        expiry: this.entry.expiry,
      }),
    });
    this.chain.contract(POT, storePotAbi as Abi, { getPot: () => this.pot });
  }

  /** Reads the pot as `Judge` does: it can be down. */
  private readonly potState = async () => {
    if (this.potDown) throw new Error(`read failed at ${RPC_SECRET}`);
    return this.pot.state;
  };

  /** A `Judge` on this world's store. A new one is a restarted object. */
  judge(): Judge {
    this.latest = new Judge({
      store: this.store,
      wake: async (at) => {
        this.alarm = at;
      },
      now: () => this.now,
      runner: this.runner,
      proxy: {
        baseUrl: `${this.zg.url}/v1`,
        apiKey: ZG_API_KEY,
        model: '0gm-1.0-35b-a3b',
        tee: new SignedChatCheck({ services: this.services, fetch: this.zg.fetch, sleep: async () => undefined }),
        fetch: this.zg.fetch,
        scrub: scrubber([ZG_API_KEY, this.key, RPC_SECRET]),
      },
      signer: this.signer,
      relayer: this.relayer,
      potState: this.potState,
      audits: this.audits,
      scrub: scrubber([ZG_API_KEY, this.key, RPC_SECRET]),
    });
    return this.latest;
  }

  /** The `Judge` built last: the object as it is now. */
  current(): Judge {
    return this.latest as Judge;
  }

  /** The agent, as the container runs it: chat through the proxy until the model submits a verdict. */
  agent(): AgentScript {
    return async ({ attempt }) => {
      const messages: unknown[] = [{ role: 'system', content: 'Judge.' }];
      for (;;) {
        const reply = await this.current().modelTurn(attempt, JSON.stringify({ messages, tool_choice: 'required', max_tokens: 2048 }));
        if (reply.status !== 200) return { failure: failed('container', `the container answered 500`) };
        const call = (JSON.parse(reply.body) as ChatReply).choices[0].message.tool_calls[0];
        if (call.function.name === 'submit_verdict') return { verdict: JSON.parse(call.function.arguments) as unknown };
        messages.push({ role: 'assistant', tool_calls: [call] }, { role: 'tool', tool_call_id: call.id, content: '{}' });
      }
    };
  }

  /** Runs alarms until nothing is left, moving the clock to each. Returns how many ran. */
  async settle(judge: Judge, steps = 40): Promise<number> {
    for (let step = 0; step < steps; step++) {
      const next = await judge.advance();
      if (next === null) return step + 1;
      this.now = Math.max(this.now, next);
    }
    throw new Error('the judgement never settled');
  }

  /** A JSON body for `POST /judge`, signed by this Box. */
  signedRequest(log: MatchLog, options: { deadline?: bigint; key?: Key; highS?: boolean; text?: string } = {}) {
    const deadline = options.deadline ?? BigInt(NOW + 600);
    const text = options.text ?? JSON.stringify(log);
    const digest = judgeDigest({ box: log.header.box, round: BigInt(log.header.round), log: jsonTextHash(text), deadline }, POT);
    const { r, s } = (options.key ?? this.box).sign(digest, { highS: options.highS ?? false });
    return { log: text, deadline: deadline.toString(), r, s };
  }

  /** The routes, over this world. */
  deps(): Deps {
    const ctx: AdmitContext = {
      client: this.chain.client,
      addresses: { names: NAMES },
      pot: () => POT,
      store: async (path) => {
        if (this.storeReply) return this.storeReply();
        const zip = this.zip;
        if (!zip || path !== `/bundles/${zip.hash}.zip`) return new Response('no', { status: 404 });
        return new Response(zip.zip as BodyInit);
      },
      now: () => Math.floor(this.now / 1000),
    };
    const stubs = new Map<string, Judge>();
    const judgement = (box: string, round: string) => {
      const name = judgementName(box, round);
      if (!stubs.has(name)) stubs.set(name, this.judge());
      return stubs.get(name) as Judge;
    };
    const doors: Doors & Deps['doors'] = {
      judgement,
      reads: judgement,
      takeJudgement: async () => {
        this.gateHits += 1;
        return this.gateLimit !== null && this.gateHits > this.gateLimit ? '60 judgements per hour from one Box' : null;
      },
    };
    return { ctx, doors, verifier: () => this.signer.address, scrub: scrubber([ZG_API_KEY, this.key, RPC_SECRET]) };
  }

  /** New judgements the gate lets through, when set. */
  gateLimit: number | null = null;

  /** `POST /judge`, through the real routes. */
  async post(deps: Deps, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await handle(
      new Request('http://verifier/judge', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }),
      deps,
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }
}

interface ChatReply {
  choices: [{ message: { tool_calls: [{ id: string; function: { name: string; arguments: string } }] } }];
}

/** A world with a real zip in its store and a pot staked on it. */
export async function stakedWorld(): Promise<World & { log: MatchLog }> {
  const world = new World();
  const zip = await tapRushZip();
  world.zip = zip;
  world.pot.bundle = zip.hash;
  world.zg.settings.payouts = ['10000000', '0'];
  return Object.assign(world, { log: matchLog(zip.hash) });
}
