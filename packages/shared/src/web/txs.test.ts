import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TxView } from '../names/api.ts';
import { ApiRefusal } from './relayer.ts';
import { type Tx, TxFailed, txLog } from './txs.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const view = (status: TxView['status'], patch: Partial<TxView> = {}): TxView => ({ id: 't1', kind: 'execute', status, ...patch });

function rows(log: ReturnType<typeof txLog>): readonly Tx[] {
  let seen: readonly Tx[] = [];
  log.onTxs((txs) => {
    seen = txs.map((tx) => ({ ...tx }));
  });
  return seen;
}

describe('relayed', () => {
  it('follows a request to done', async () => {
    const follow = vi.fn<(id: string) => Promise<TxView>>()
      .mockResolvedValueOnce(view('in-block', { hash: '0xab', block: 7 }))
      .mockResolvedValueOnce(view('done', { hash: '0xab', block: 7 }));
    const log = txLog({ follow });
    const done = log.relayed('SAVE', 'mumbai-01', async () => view('sent', { hash: '0xab' }));
    await vi.runAllTimersAsync();
    await expect(done).resolves.toMatchObject({ status: 'done' });
    expect(follow).toHaveBeenCalledWith('t1');
    expect(rows(log)).toEqual([{ key: 1, kind: 'SAVE', subject: 'mumbai-01', status: 'done', hash: '0xab', block: 7, error: undefined }]);
  });

  it("fails with the relayer's reason when it refuses", async () => {
    const log = txLog({ follow: vi.fn() });
    const sent = log.relayed('SAVE', 'x', async () => {
      throw new ApiRefusal(400, { error: 'bad signature' });
    });
    await expect(sent).rejects.toBeInstanceOf(TxFailed);
    expect(rows(log)[0]).toMatchObject({ status: 'failed', error: 'bad signature' });
  });

  it('fails with the revert of a mined failure', async () => {
    const log = txLog({ follow: async () => view('failed', { hash: '0xab', block: 9, revert: 'UnknownBox' }) });
    const sent = log.relayed('RENEW', 'x', async () => view('sent'));
    const caught = sent.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(((await caught) as TxFailed).message).toBe('UnknownBox');
  });

  it("shows a claim's primary name as its own row, and keeps only the newest rows", async () => {
    const log = txLog({ follow: vi.fn(), keep: 2 });
    await log.relayed('CLAIM', 'nova.gamebox.eth', async () => view('done', { primaryName: { status: 'done', hash: '0xcd' } }));
    expect(rows(log).map((r) => r.kind)).toEqual(['PRIMARY NAME', 'CLAIM']);
    await log.relayed('SAVE', 'x', async () => view('done'));
    expect(rows(log).map((r) => r.kind)).toEqual(['SAVE', 'PRIMARY NAME']);
  });
});

describe('direct', () => {
  it('is done once the head passes the receipt', async () => {
    const heads = [10n, 11n];
    const client = {
      waitForTransactionReceipt: vi.fn(async () => ({ blockNumber: 10n, status: 'success' })),
      getBlockNumber: vi.fn(async () => heads.shift() ?? 11n),
    };
    const log = txLog({ follow: vi.fn() });
    const sent = log.direct(client as never, 'REVOKE', 'stats', async () => '0xee');
    await vi.runAllTimersAsync();
    await expect(sent).resolves.toEqual({ hash: '0xee', block: 10n });
    expect(rows(log)[0]).toMatchObject({ status: 'done', block: 10, hash: '0xee' });
  });

  it('fails a reverted receipt', async () => {
    const client = { waitForTransactionReceipt: async () => ({ blockNumber: 3n, status: 'reverted' }), getBlockNumber: async () => 4n };
    const log = txLog({ follow: vi.fn() });
    await expect(log.direct(client as never, 'REVOKE', 'stats', async () => '0xee')).rejects.toBeInstanceOf(TxFailed);
    expect(rows(log)[0]).toMatchObject({ status: 'failed', error: 'reverted' });
  });
});
