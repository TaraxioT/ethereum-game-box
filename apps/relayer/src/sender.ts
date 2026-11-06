// The Durable Object that sends: one per chain, so one nonce queue, and every request's progress.
//
// `Relay` is its logic over a plain store and client (the tests run it in memory); `Sender` is the Durable Object
// around it, which polls receipts with an alarm while anything is pending.

import type { RelayerHealth, TxView } from '@egb/shared/names';
import { DurableObject } from 'cloudflare:workers';
import { type Address, type Hex, type LocalAccount, formatEther, parseGwei } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { type Client, describe, etherscanTx, rpc, sepoliaClient } from './chain.ts';
import type { Env } from './env.ts';
import { Limits, limitsFor } from './limits.ts';
import { Replay } from './replay.ts';
import type { RefusalStatus } from './refusal.ts';
import type { Prepared } from './request.ts';
import { revertName } from './revert.ts';
import type { Store } from './store.ts';

interface TxRecord extends TxView {
  createdAt: number;
  locks: string[];
  call: { to: Address; data: Hex; value: bigint };
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

const view = ({ createdAt: _c, locks: _l, call: _call, ...tx }: TxRecord): TxView => tx;

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
      if (record.status !== 'done' && record.status !== 'failed') left++;
    }
    return left > 0;
  }

  private async advance(record: TxRecord, head: number): Promise<void> {
    const { client, account } = this.options;
    if (record.status === 'sent' && record.hash) {
      const receipt = await client.getTransactionReceipt({ hash: record.hash }).catch(() => null);
      if (!receipt) return;
      record.block = Number(receipt.blockNumber);
      record.gasUsed = receipt.gasUsed.toString();
      record.fee = (receipt.gasUsed * receipt.effectiveGasPrice).toString();
      if (receipt.status === 'success') {
        record.status = 'in-block';
      } else {
        // Replay the call at the receipt's block to name the revert.
        const revert = await client
          .call({ account: account.address, ...record.call, blockNumber: receipt.blockNumber })
          .then(() => `out of gas or reverted without data (gas used ${receipt.gasUsed})`, revertName);
        Object.assign(record, { status: 'failed', revert, error: `reverted with ${revert}` });
      }
    }
    if (record.status === 'in-block' && record.block !== undefined && head >= record.block + CONFIRMATIONS) {
      record.status = 'done';
    }
  }

  private async admitAndSend(request: Prepared, ip: string): Promise<Submitted> {
    const { store, now } = this.options;
    const at = now();
    if (request.replay && (await this.replay.seen(request.replay.key, at))) {
      return { ok: false, status: 409, error: 'already sent: this signed request is a replay' };
    }
    const held = new Set<string>();
    for (const record of await this.pendingRecords()) record.locks.forEach((lock) => held.add(lock));
    const clash = request.locks.find((lock) => held.has(lock));
    if (clash) return { ok: false, status: 409, error: `a request for ${clash} is already pending` };
    const limits = limitsFor(request.kind, ip);
    const hit = await this.limits.exceeded(limits, at);
    if (hit) return { ok: false, status: 429, error: `rate limit: ${hit.what}` };

    await this.limits.take(limits, at);
    if (request.replay) await this.replay.record(request.replay.key, request.replay.until);
    const record: TxRecord = {
      id: crypto.randomUUID(),
      kind: request.kind,
      status: 'signed',
      createdAt: at,
      locks: request.locks,
      call: { to: request.to, data: request.data, value: request.value },
    };
    await this.save(record);
    try {
      record.hash = await this.broadcast(request);
      record.etherscan = etherscanTx(record.hash);
      record.status = 'sent';
      await this.save(record);
      await this.options.wake();
    } catch (error) {
      Object.assign(record, { status: 'failed', error: `not sent: ${describe(error)}` });
      await this.save(record);
      if (request.replay) await this.replay.forget(request.replay.key);
    }
    return { ok: true, tx: view(record) };
  }

  /** Signs and sends with the next nonce. On a nonce error it reads the nonce from the chain and tries once more. */
  private async broadcast(request: Prepared): Promise<Hex> {
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
