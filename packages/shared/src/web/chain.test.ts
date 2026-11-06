import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watchHead } from './chain.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('watchHead', () => {
  it('tells each listener every new head, once, and keeps the last on a failed poll', async () => {
    const answers: (bigint | Error)[] = [5n, 5n, new Error('down'), 6n];
    const client = {
      getBlockNumber: vi.fn(async () => {
        const next = answers.shift() ?? 6n;
        if (next instanceof Error) throw next;
        return next;
      }),
    };
    const watch = watchHead(client as never, 1_000);
    const seen: bigint[] = [];
    watch.onHead((block) => seen.push(block));
    await vi.advanceTimersByTimeAsync(3_500);
    watch.stop();
    expect(seen).toEqual([5n, 6n]);
    expect(watch.head()).toBe(6n);
    const late: bigint[] = [];
    watch.onHead((block) => late.push(block));
    expect(late).toEqual([6n]);
  });
});
