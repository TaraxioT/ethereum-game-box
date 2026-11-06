// Sends the admin's calls one at a time from its own key: each is run with `eth_call` first (a refusal costs nothing
// and comes back as the contract's error, by name), then sent, then waited for. The same key also pays the relayer's
// gas, from another process with its own nonce queue, so a nonce clash is retried once with a fresh nonce.

import { type Account, type Chain, type Hex, type PublicClient, type Transport, type WalletClient, BaseError } from 'viem';

import { errorName } from '../web/errors.ts';
import type { AdminCall } from './calls.ts';

/** A call the chain refused: in its `eth_call` (nothing was sent) or once mined (`hash` set). */
export class AdminRefused extends Error {
  override name = 'AdminRefused';
  readonly what: string;
  /** The contract's error name, or a short reason. */
  readonly reason: string;
  readonly hash: Hex | null;
  constructor(what: string, reason: string, hash: Hex | null = null) {
    super(`${what}: ${reason}`);
    this.what = what;
    this.reason = reason;
    this.hash = hash;
  }
}

export interface AdminSent {
  what: string;
  hash: Hex;
  block: bigint;
  gasUsed: bigint;
}

export type AdminWallet = WalletClient<Transport, Chain, Account>;

export interface AdminSender {
  /** Sends `calls` in order, each after the one before is in a block; stops at the first refusal. Calls from
   *  different `send`s never overlap. `onSent` hears each hash as soon as it is sent. */
  send(calls: readonly AdminCall[], onSent?: (what: string, hash: Hex) => void): Promise<AdminSent[]>;
}

const NONCE_CLASH = /nonce too low|nonce has already been used|replacement transaction underpriced|already known/i;

function isNonceClash(error: unknown): boolean {
  const text = error instanceof BaseError ? `${error.shortMessage} ${error.details}` : String(error);
  return NONCE_CLASH.test(text);
}

export function adminSender(wallet: AdminWallet, client: PublicClient): AdminSender {
  const account = wallet.account;
  let queue: Promise<unknown> = Promise.resolve();

  async function gasFor(call: AdminCall): Promise<bigint> {
    if (call.gas !== undefined) return call.gas;
    const gas = await client.estimateGas({ account, to: call.to, data: call.data });
    return gas + gas / 2n;
  }

  async function one(call: AdminCall, onSent?: (what: string, hash: Hex) => void): Promise<AdminSent> {
    try {
      await client.call({ account, to: call.to, data: call.data });
    } catch (error) {
      throw new AdminRefused(call.what, errorName(error));
    }
    const gas = await gasFor(call);
    const sendOnce = () => wallet.sendTransaction({ account, chain: wallet.chain, to: call.to, data: call.data, gas });
    let hash: Hex;
    try {
      hash = await sendOnce().catch((error: unknown) => {
        if (isNonceClash(error)) return sendOnce();
        throw error;
      });
    } catch (error) {
      throw new AdminRefused(call.what, errorName(error));
    }
    onSent?.(call.what, hash);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new AdminRefused(call.what, 'reverted in its block', hash);
    return { what: call.what, hash, block: receipt.blockNumber, gasUsed: receipt.gasUsed };
  }

  return {
    send(calls, onSent) {
      const run = queue.then(async () => {
        const sent: AdminSent[] = [];
        for (const call of calls) sent.push(await one(call, onSent));
        return sent;
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
