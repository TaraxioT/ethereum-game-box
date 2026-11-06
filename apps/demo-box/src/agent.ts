// The agent: `bot.gamebox.eth`, the practice opponent. Its `P256Account` is bound to a software key (the Worker secret
// `AGENT_P256_KEY`), and the relayer pays its gas. It sets itself up in three steps, each one signed request:
// 1. `deploy`: its account, through `POST /account/deploy`;
// 2. `claim`: its player name, a `ClaimName` its key signs raw, which `GameBoxNames` checks through the account's
//    ERC-1271 `isValidSignature`;
// 3. `records`: its ENSIP-26 records, `agent-context` and `agent-endpoint[mcp]`, through `POST /account/execute`
//    (only those that differ from what it wants).
// `setup()` starts the next step, or says that one is still pending or that all are done. Calling it again is safe.

import {
  AGENT_KEYS,
  type ClaimRequest,
  type TxView,
  agentEndpointKey,
  claimNameDigest,
  fullName,
} from '@egb/shared/names';
import type { Store } from '@egb/relayer/store';
import type { Address, Hex } from 'viem';

import { DEADLINE } from './box.ts';
import type { AgentChain } from './chain.ts';
import { setTextCall, signedExecute } from './execute.ts';
import type { Relayer, Reply } from './relayer.ts';
import type { Signer } from './signer.ts';

export type AgentStep = 'deploy' | 'claim' | 'records' | 'done';

/** `GET /agent`. */
export interface AgentView {
  label: string;
  name: string;
  /** Its `P256Account`: `P256AccountFactory.accountOf(qx, qy)`. */
  account: Address;
  qx: Hex;
  qy: Hex;
  /** The ENSIP-26 records it publishes. */
  records: Record<string, string>;
  /** The setup step it needs next, or `done`. */
  next: AgentStep;
}

/** `POST /agent/setup`: the step it started (with the relayer's request id), the one still pending, or `done`. */
export interface AgentSetupReply {
  step: AgentStep | 'pending';
  id?: string;
  tx?: TxView;
}

export interface AgentOptions {
  store: Store;
  chain: AgentChain;
  signer: Signer;
  /** Its label: `bot`. */
  label: string;
  /** `GameBoxNames`, the verifying contract of `ClaimName`. */
  names: Address;
  /** Its MCP endpoint, for `agent-endpoint[mcp]`. */
  mcpUrl: string;
  relayer: Relayer;
  /** Unix seconds. */
  now: () => number;
  nonce: () => bigint;
}

const PENDING = 'agent:pending';

/** `agent-context`: who it is and what it plays, in Markdown. */
export function agentContext(label: string): string {
  return [
    `# ${fullName(label)}`,
    '',
    "The Game Box's practice opponent. It plays Stock Duel and Quick Draw, and its matches count like any player's:",
    'a Box signs the result, and `PlayerStats` writes its `stats` record.',
    '',
    '- It is a `P256Account`. Its P-256 key is a secret of the demo Box Worker, and the relayer pays its gas.',
    '- It claimed this name with its own signature (ERC-1271), and it writes its own `agent-context` and',
    '  `agent-endpoint[mcp]` records (ENSIP-26).',
    '- Its MCP endpoint lists two tools: `agent` (this) and `box` (the demo Box it plays at).',
  ].join('\n');
}

export class Agent {
  private readonly options: AgentOptions;
  private account: Address | undefined;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(options: AgentOptions) {
    this.options = options;
  }

  /** The records it publishes. */
  records(): Record<string, string> {
    const { label, mcpUrl } = this.options;
    return { [AGENT_KEYS.context]: agentContext(label), [agentEndpointKey('mcp')]: mcpUrl };
  }

  async view(): Promise<AgentView> {
    const { label, signer } = this.options;
    return {
      label,
      name: fullName(label),
      account: await this.accountAddress(),
      qx: signer.qx,
      qy: signer.qy,
      records: this.records(),
      next: (await this.next()).step,
    };
  }

  /** Starts the next setup step. One runs at a time, and none starts while the last one's request is pending. */
  setup(): Promise<Reply> {
    const run = this.tail.then(() => this.setupNow());
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async setupNow(): Promise<Reply> {
    const { store, relayer } = this.options;
    const pending = await store.get<string>(PENDING);
    if (pending) {
      const { status, body } = await relayer.get(`/tx/${pending}`);
      const tx = body as unknown as TxView;
      if (status === 200 && tx.status !== 'done' && tx.status !== 'failed') {
        return { status: 202, body: { step: 'pending', id: pending, tx } satisfies AgentSetupReply };
      }
      await store.delete(PENDING);
    }
    const next = await this.next();
    if (next.step === 'done') return { status: 200, body: { step: 'done' } satisfies AgentSetupReply };
    const reply = await relayer.post(next.path, next.body);
    if (reply.status !== 202) return reply;
    const id = String(reply.body.id);
    await store.put(PENDING, id);
    return { status: 202, body: { step: next.step, id } satisfies AgentSetupReply };
  }

  /** The next step, with the relayer request that takes it. */
  private async next(): Promise<{ step: 'done' } | { step: Exclude<AgentStep, 'done'>; path: string; body: unknown }> {
    const { chain, signer, label, names, now, nonce } = this.options;
    const account = await this.accountAddress();
    const deadline = BigInt(now() + DEADLINE);
    if (!(await chain.deployed(account))) {
      return { step: 'deploy', path: '/account/deploy', body: { qx: signer.qx, qy: signer.qy } };
    }
    const held = await chain.nameOf(account);
    if (!held) {
      const signature = signer.raw(claimNameDigest({ label, badge: account, deadline }, names));
      const body: ClaimRequest = { label, badge: account, deadline: String(deadline), signature };
      return { step: 'claim', path: '/names/claim', body };
    }
    if (held !== fullName(label)) throw new Error(`the agent's account holds ${held}, not ${fullName(label)}`);
    const resolver = await chain.resolverOf(label);
    const calls = [];
    for (const [key, value] of Object.entries(this.records())) {
      if ((await chain.text(resolver, label, key)) !== value) calls.push(setTextCall(resolver, label, key, value));
    }
    if (calls.length === 0) return { step: 'done' };
    return { step: 'records', path: '/account/execute', body: signedExecute(signer, account, calls, nonce(), deadline) };
  }

  private async accountAddress(): Promise<Address> {
    const { chain, signer } = this.options;
    this.account ??= await chain.accountOf(signer.qx, signer.qy);
    return this.account;
  }
}
