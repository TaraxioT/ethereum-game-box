import { MemoryStore } from '@egb/relayer/test/memory-store';
import { describe, expect, it } from 'vitest';

import { takeJudgement } from '../src/gate.ts';

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

  it('keeps each Box apart', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 60; i++) await takeJudgement(store, 'mumbai-01', 1000);
    expect(await takeJudgement(store, 'delhi-02', 1000)).toBeNull();
  });
});
