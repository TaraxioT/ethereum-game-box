import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tx } from '@egb/shared/web';

import { mountChainTag, mountTxStrip, txRow } from './chrome.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tx = (patch: Partial<Tx>): Tx => ({ key: 1, kind: 'SAVE', subject: 'mumbai-01.gamebox.eth', status: 'signed', ...patch });

describe('txRow', () => {
  it('lights each step reached, with the block and an Etherscan link', () => {
    const row = txRow(tx({ status: 'in-block', hash: `0x${'ab'.repeat(32)}`, block: 1234 }));
    expect(row.dataset.status).toBe('in-block');
    expect([...row.querySelectorAll('.st span.on')].map((s) => s.textContent)).toEqual(['signed', 'sent', 'in block 1,234']);
    expect(row.querySelector('a')!.getAttribute('href')).toMatch(/^https:\/\/sepolia\.etherscan\.io\/tx\/0xab/);
  });

  it('shows where a failure stopped, and why', () => {
    const row = txRow(tx({ status: 'failed', hash: '0xab', error: 'UnknownBox' }));
    expect(row.className).toBe('tx failed');
    expect([...row.querySelectorAll('.st span.on')].map((s) => s.textContent)).toEqual(['signed', 'sent']);
    expect(row.querySelector('.err')!.textContent).toBe('UnknownBox');
  });
});

describe('mountTxStrip', () => {
  it('redraws on every change', () => {
    let push: (txs: readonly Tx[]) => void = () => {};
    const root = document.createElement('section');
    mountTxStrip(root, { onTxs: (fn) => ((push = fn), () => {}) });
    push([tx({ key: 2 }), tx({ key: 1, kind: 'DEPLOY' })]);
    expect([...root.querySelectorAll('.k')].map((k) => k.textContent)).toEqual(['SAVE', 'DEPLOY']);
  });
});

describe('mountChainTag', () => {
  it('shows the head block and the relayer, ok or down', async () => {
    const root = document.createElement('div');
    let head: (b: bigint) => void = () => {};
    const health = vi.fn()
      .mockResolvedValueOnce({ address: '0x0000000000000000000000000000000000000009', balance: '250000000000000000', pending: 0, block: 1, tipGwei: '1' })
      .mockRejectedValueOnce(new Error('cors'));
    const seen = vi.fn();
    mountChainTag(root, { watch: { onHead: (fn) => ((head = fn), () => {}) }, health, onHealth: seen, everyMs: 1_000 });
    head(12_075_728n);
    await vi.advanceTimersByTimeAsync(0);
    expect(root.textContent).toContain('block 12,075,728');
    expect(root.textContent).toContain('relayer ok · 0.250 ETH');
    expect(seen).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(root.textContent).toContain('relayer down');
  });
});
