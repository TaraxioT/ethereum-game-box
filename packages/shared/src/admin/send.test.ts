import { type Hex, type PublicClient, encodeErrorResult } from 'viem';
import { describe, expect, it } from 'vitest';

import { championshipsAbi } from '../names/abis.ts';
import type { AdminCall } from './calls.ts';
import { AdminRefused, type AdminWallet, adminSender } from './send.ts';

const ACCOUNT = { address: '0xB2b6B516Df4B159c0E4Eb1d6D7D65a5f2F04C30E', type: 'local' };
const CALL = (what: string, gas?: bigint): AdminCall => ({ to: '0x8222774A2eD41E3c38A188A8143D29EF77957eA0', data: '0x01', what, ...(gas ? { gas } : {}) });

/** A chain that records every send and answers from a script. */
function rig(options: { revert?: Hex; nonceClashes?: number; minedStatus?: 'success' | 'reverted' } = {}) {
  const sent: { what: string; gas: bigint }[] = [];
  let clashes = options.nonceClashes ?? 0;
  let n = 0;
  const client = {
    async call() {
      if (options.revert) throw Object.assign(new Error('execution reverted'), { data: options.revert });
      return {};
    },
    estimateGas: async () => 100_000n,
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => ({ status: options.minedStatus ?? 'success', blockNumber: 7n, gasUsed: 50_000n, hash }),
  } as unknown as PublicClient;
  const wallet = {
    account: ACCOUNT,
    chain: { id: 11155111 },
    async sendTransaction({ gas }: { gas: bigint }) {
      if (clashes > 0) {
        clashes--;
        throw new Error('nonce too low');
      }
      sent.push({ what: `tx${n}`, gas });
      return `0x${(++n).toString(16).padStart(64, '0')}` as Hex;
    },
  } as unknown as AdminWallet;
  return { sender: adminSender(wallet, client), sent };
}

describe('the admin sender', () => {
  it('sends in order, the fixed gas as it is and an estimate plus half', async () => {
    const { sender, sent } = rig();
    const heard: string[] = [];
    const out = await sender.send([CALL('mint'), CALL('open', 20_000_000n)], (what) => heard.push(what));
    expect(out.map((s) => s.what)).toEqual(['mint', 'open']);
    expect(sent.map((s) => s.gas)).toEqual([150_000n, 20_000_000n]);
    expect(heard).toEqual(['mint', 'open']);
  });

  it('refuses a call its eth_call reverts, by the contract error’s name, and sends nothing', async () => {
    const revert = encodeErrorResult({ abi: championshipsAbi, errorName: 'NoOpenCup', args: ['quickdraw'] });
    const { sender, sent } = rig({ revert });
    await expect(sender.send([CALL('close')])).rejects.toThrow(new AdminRefused('close', 'NoOpenCup'));
    expect(sent).toEqual([]);
  });

  it('retries a nonce clash once (the relayer shares the key)', async () => {
    const { sender, sent } = rig({ nonceClashes: 1 });
    await sender.send([CALL('add')]);
    expect(sent).toHaveLength(1);
    await expect(rig({ nonceClashes: 2 }).sender.send([CALL('add')])).rejects.toThrow(AdminRefused);
  });

  it('fails a call that reverted in its block, with its hash', async () => {
    const { sender } = rig({ minedStatus: 'reverted' });
    const error = await sender.send([CALL('open')]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdminRefused);
    expect((error as AdminRefused).hash).toMatch(/^0x0+1$/);
  });

  it('runs one send after another', async () => {
    const { sender, sent } = rig();
    const order: string[] = [];
    await Promise.all([sender.send([CALL('a')]).then(() => order.push('a')), sender.send([CALL('b')]).then(() => order.push('b'))]);
    expect(order).toEqual(['a', 'b']);
    expect(sent).toHaveLength(2);
  });
});
