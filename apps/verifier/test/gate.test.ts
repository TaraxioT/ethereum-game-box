import { MemoryStore } from '@egb/relayer/test/memory-store';
import { describe, expect, it } from 'vitest';

import { returnJudgement, takeCaller, takeJudgement } from '../src/gate.ts';

describe('the Box gate', () => {
  it('lets 60 judgements through in an hour, and refuses the next', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 60; i++) expect(await takeJudgement(store, 'mumbai-01', 1000 + i)).toBeNull();
    expect(await takeJudgement(store, 'mumbai-01', 1100)).toBe('60 judgements per hour from one Box');
  });

  it('opens again as the window moves on', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 60; i++) await takeJudgement(store, 'mumbai-01', 1000);
    expect(await takeJudgement(store, 'mumbai-01', 1000 + 3601)).toBeNull();
  });

  it('frees one judgement when it is given back, and no more', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 60; i++) await takeJudgement(store, 'mumbai-01', 1000);
    await returnJudgement(store, 'mumbai-01', 1000);
    expect(await takeJudgement(store, 'mumbai-01', 1001)).toBeNull();
    expect(await takeJudgement(store, 'mumbai-01', 1001)).toBe('60 judgements per hour from one Box');
  });

  it('gives nothing back for a time it never counted', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 60; i++) await takeJudgement(store, 'mumbai-01', 1000);
    await returnJudgement(store, 'mumbai-01', 999);
    expect(await takeJudgement(store, 'mumbai-01', 1001)).toBe('60 judgements per hour from one Box');
  });

  it('keeps each Box apart', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 60; i++) await takeJudgement(store, 'mumbai-01', 1000);
    expect(await takeJudgement(store, 'delhi-02', 1000)).toBeNull();
  });
});

describe('the address gate', () => {
  it('lets 600 requests through in an hour, and refuses the next', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 600; i++) expect(await takeCaller(store, '203.0.113.7', 1000)).toBeNull();
    expect(await takeCaller(store, '203.0.113.7', 1000)).toBe('600 requests per hour from one address');
    expect(await takeCaller(store, '203.0.113.8', 1000)).toBeNull();
    expect(await takeCaller(store, '203.0.113.7', 1000 + 3601)).toBeNull();
  });
});
