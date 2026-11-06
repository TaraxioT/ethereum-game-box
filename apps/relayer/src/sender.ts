// The Durable Object that sends: one per chain, so one nonce queue, and every request's progress.
//
// `Relay` is its logic over a plain store and client (the tests run it in memory); `Sender` is the Durable Object
// around it, which polls receipts with an alarm while anything is pending.

import type { RelayerHealth, TxStep, TxView } from '@egb/shared/names';
import { DurableObject } from 'cloudflare:workers';
import { type Hex, type LocalAccount, formatEther, parseGwei } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { type Client, describe, etherscanTx, rpc, sepoliaClient } from './chain.ts';
import type { Env } from './env.ts';
import { Limits, limitsFor } from './limits.ts';
import { Replay } from './replay.ts';
import type { RefusalStatus } from './refusal.ts';
import type { Call, Prepared } from './request.ts';
import { revertName } from './revert.ts';
import type { Store } from './store.ts';

interface TxRecord extends TxView {
  createdAt: number;
  locks: string[];
  call: Call;
  /** A claim's primary-name call, sent once the claim is in a block. */
  primaryCall?: Call;
}

export type Submitted = { ok: true; tx: TxView } | { ok: false; status: RefusalStatus; error: string };

export interface RelayOptions {
  store: Store;
  client: Client;
  account: LocalAccount;
  tipWei: bigint;
  /** Unix seconds. */
  now: () => number;
  /** Asks for `poll` to run soon. */
  wake: () => Promise<void>;
}

const NONCE_ERROR = /nonce too (low|high)|invalid nonce|replacement transaction underpriced|NonceTooLow|NonceTooHigh/i;

/** A transaction is `done` once the head is this many blocks past its block, so lagging nodes have it too. */
const CONFIRMATIONS = 1;

const view = ({ createdAt: _c, locks: _l, call: _call, primaryCall: _p, ...tx }: TxRecord): TxView => tx;

const settled = (step: TxStep) => step.status === 'done' || step.status === 'failed';

export class Relay {
  private readonly replay: Replay;
  private readonly limits: Limits;
  private tail: Promise<unknown> = Promise.resolve();
  /** The next nonce to use, or `undefined` to read it from the chain. */
  private nonce: number | undefined;

  private readonly options: RelayOptions;

  constructor(options: RelayOptions) {
    this.options = options;
    this.replay = new Replay(options.store);
    this.limits = new Limits(options.store);
  }

  /** Admits a checked request and sends it. Requests run one at a time: one nonce queue. */
  submit(request: Prepared, ip: string): Promise<Submitted> {
    return this.serial(() => this.admitAndSend(request, ip));
  }

  async status(id: string): Promise<TxView | null> {
    const record = await this.options.store.get<TxRecord>(`tx:${id}`);
    return record ? view(record) : null;
  }

  async health(): Promise<RelayerHealth> {
    const { client, account, tipWei, store } = this.options;
    const [balance, head, pending] = await Promise.all([
      client.getBalance({ address: account.address }),
      client.getBlockNumber(),
      store.list({ prefix: 'pending:' }),
    ]);
    return {
      address: account.address,
      balance: balance.toString(),
      pending: pending.size,
      block: Number(head),
      tipGwei: formatEther(tipWei, 'gwei'),
    };
  }

  /** Moves pending transactions along from their receipts. Returns whether any are still pending. */
  async poll(): Promise<boolean> {
    const { store, client } = this.options;
    const pending = await store.list({ prefix: 'pending:' });
    if (pending.size === 0) {
      await this.replay.prune(this.options.now());
      return false;
    }
    const head = Number(await client.getBlockNumber());
    let left = 0;
    for (const key of pending.keys()) {
      const record = await store.get<TxRecord>(`tx:${key.slice('pending:'.length)}`);
      if (!record) {
        await store.delete(key);
        continue;
      }
      await this.advance(record, head);
      await this.save(record);
      if (!settled(record)) left++;
    }
    return left > 0;
  }

  private async advance(record: TxRecord, head: number): Promise<void> {
    await this.advanceStep(record, record.call, head);
    const call = record.primaryCall;
    if (!call) return;
    const step = (record.primaryName ??= { status: 'signed' });
    if (step.status === 'signed' && record.status === 'failed') {
      Object.assign(step, { status: 'failed', error: 'not sent: the claim failed' });
      if (call.replay) await this.replay.forget(call.replay.key);
    } else if (step.status === 'signed' && (record.status === 'in-block' || record.status === 'done')) {
      await this.send(step, call);
    }
    await this.advanceStep(step, call, head);
    // The request is done once its last step has settled.
    if (record.status === 'done' && !settled(step)) record.status = 'in-block';
  }

  /** Moves one sent transaction along from its receipt. */
  private async advanceStep(step: TxStep, call: Call, head: number): Promise<void> {
    const { client, account } = this.options;
    if (step.status === 'sent' && step.hash) {
      const receipt = await client.getTransactionReceipt({ hash: step.hash }).catch(() => null);
      if (!receipt) return;
      step.block = Number(receipt.blockNumber);
      step.gasUsed = receipt.gasUsed.toString();
      step.fee = (receipt.gasUsed * receipt.effectiveGasPrice).toString();
      if (receipt.status === 'success') {
        step.status = 'in-block';
      } else {
        // Replay the call at the receipt's block to name the revert.
        const { to, data, value } = call;
        const revert = await client
          .call({ account: account.address, to, data, value, blockNumber: receipt.blockNumber })
          .then(() => `out of gas or reverted without data (gas used ${receipt.gasUsed})`, revertName);
        Object.assign(step, { status: 'failed', revert, error: `reverted with ${revert}` });
      }
    }
    if (step.status === 'in-block' && step.block !== undefined && head >= step.block + CONFIRMATIONS) {
      step.status = 'done';
    }
  }

  /** Sends `call` through the nonce queue as `step`. A send that fails frees its replay key. */
  private async send(step: TxStep, call: Call): Promise<void> {
    try {
      step.hash = await this.serial(() => this.broadcast(call));
      step.etherscan = etherscanTx(step.hash);
      step.status = 'sent';
    } catch (error) {
      Object.assign(step, { status: 'failed', error: `not sent: ${describe(error)}` });
      if (call.replay) await this.replay.forget(call.replay.key);
    }
  }

  private async admitAndSend(request: Prepared, ip: string): Promise<Submitted> {
    const { store, now } = this.options;
    const at = now();
    for (const call of [request, request.primaryName]) {
      if (call?.replay && (await this.replay.seen(call.replay.key, at))) {
        return { ok: false, status: 409, error: 'already sent: this signed request is a replay' };
      }
    }
    const held = new Set<string>();
    for (const record of await this.pendingRecords()) record.locks.forEach((lock) => held.add(lock));
    const clash = request.locks.find((lock) => held.has(lock));
    if (clash) return { ok: false, status: 409, error: `a request for ${clash} is already pending` };
    const limits = limitsFor(request.kind, ip);
    const hit = await this.limits.exceeded(limits, at);
    if (hit) return { ok: false, status: 429, error: `rate limit: ${hit.what}` };

    await this.limits.take(limits, at);
    const { kind, locks, primaryName, to, data, value, gas, replay } = request;
    for (const call of [request, primaryName]) {
      if (call?.replay) await this.replay.record(call.replay.key, call.replay.until);
    }
    const record: TxRecord = {
      id: crypto.randomUUID(),
      kind,
      status: 'signed',
      createdAt: at,
      locks,
      call: { to, data, value, gas, ...(replay && { replay }) },
      ...(primaryName && { primaryCall: primaryName, primaryName: { status: 'signed' } }),
    };
    await this.save(record);
    // Already inside the queue: broadcast directly.
    try {
      record.hash = await this.broadcast(record.call);
      record.etherscan = etherscanTx(record.hash);
      record.status = 'sent';
      await this.options.wake();
    } catch (error) {
      Object.assign(record, { status: 'failed', error: `not sent: ${describe(error)}` });
      for (const call of [request, primaryName]) if (call?.replay) await this.replay.forget(call.replay.key);
      if (record.primaryName) Object.assign(record.primaryName, { status: 'failed', error: 'not sent: the claim failed' });
    }
    await this.save(record);
    return { ok: true, tx: view(record) };
  }

  /** Signs and sends with the next nonce. On a nonce error it reads the nonce from the chain and tries once more. */
  private async broadcast(request: Call): Promise<Hex> {
    const { client, account, tipWei } = this.options;
    const block = await client.getBlock();
    const fees = { maxPriorityFeePerGas: tipWei, maxFeePerGas: (block.baseFeePerGas ?? 0n) * 2n + tipWei };
    for (let attempt = 0; ; attempt++) {
      const nonce =
        this.nonce ?? (await client.getTransactionCount({ address: account.address, blockTag: 'pending' }));
      try {
        const serializedTransaction = await account.signTransaction({
          type: 'eip1559',
          chainId: client.chain.id,
          nonce,
          to: request.to,
          data: request.data,
          value: request.value,
          gas: request.gas,
          ...fees,
        });
        const hash = await client.sendRawTransaction({ serializedTransaction });
        this.nonce = nonce + 1;
        return hash;
      } catch (error) {
        this.nonce = undefined;
        if (attempt === 0 && NONCE_ERROR.test(error instanceof Error ? error.message : String(error))) continue;
        throw error;
      }
    }
  }

  private async pendingRecords(): Promise<TxRecord[]> {
    const { store } = this.options;
    const records: TxRecord[] = [];
    for (const key of (await store.list({ prefix: 'pending:' })).keys()) {
      const record = await store.get<TxRecord>(`tx:${key.slice('pending:'.length)}`);
      if (record) records.push(record);
    }
    return records;
  }

  private async save(record: TxRecord): Promise<void> {
    const { store } = this.options;
    await store.put(`tx:${record.id}`, record);
    if (record.status === 'done' || record.status === 'failed') await store.delete(`pending:${record.id}`);
    else await store.put(`pending:${record.id}`, true);
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

/** How often the alarm polls for receipts while anything is pending. */
const POLL_MS = 4000;

export class Sender extends DurableObject<Env> {
  private readonly relay: Relay;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.relay = new Relay({
      store: ctx.storage,
      client: sepoliaClient(rpc(env.SEPOLIA_RPC_URL)),
      account: privateKeyToAccount(env.RELAYER_PRIVATE_KEY as Hex),
      tipWei: parseGwei(env.TIP_GWEI ?? '2'),
      now: () => Math.floor(Date.now() / 1000),
      wake: () => this.wake(),
    });
  }

  submit(request: Prepared, ip: string): Promise<Submitted> {
    return this.relay.submit(request, ip);
  }

  status(id: string): Promise<TxView | null> {
    return this.relay.status(id);
  }

  health(): Promise<RelayerHealth> {
    return this.relay.health();
  }

  override async alarm(): Promise<void> {
    // Set the next alarm directly: inside the handler, the running alarm may still read as set.
    try {
      if (await this.relay.poll()) await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
    } catch (error) {
      console.error(`poll failed: ${describe(error)}`);
      await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
    }
  }

  private async wake(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
  }
}
