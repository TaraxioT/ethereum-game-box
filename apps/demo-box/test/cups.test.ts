import { describe, expect, it } from 'vitest';

import { closeEndedCups } from '../src/cups.ts';
import type { Reply } from '../src/relayer.ts';

const NOW = 1_800_000_000;

function setup(cups: Record<string, { label: string; ends: number }>, reply: Reply = { status: 202, body: { id: 'id-1' } }) {
  const posts: { path: string; body: unknown }[] = [];
  const run = () =>
    closeEndedCups({
      chain: { openCup: async (game) => cups[game] ?? null },
      relayer: {
        post: async (path, body) => (posts.push({ path, body }), reply),
        get: async () => ({ status: 404, body: {} }),
      },
      games: ['stockduel', 'quickdraw'],
      now: () => NOW,
    });
  return { run, posts };
}

describe('closing ended championships', () => {
  it('asks the relayer to close a championship once its ends has passed', async () => {
    const { run, posts } = setup({ stockduel: { label: 'mumbai-cup', ends: NOW } });
    expect(await run()).toEqual(['id-1']);
    expect(posts).toEqual([{ path: '/cup/close', body: { game: 'stockduel' } }]);
  });

  it('leaves a running championship, and a game with none, alone', async () => {
    const { run, posts } = setup({ stockduel: { label: 'mumbai-cup', ends: NOW + 1 } });
    expect(await run()).toEqual([]);
    expect(posts).toHaveLength(0);
  });

  it('tries again on the next alarm when the relayer refuses', async () => {
    const { run, posts } = setup(
      { quickdraw: { label: 'quick-cup', ends: NOW - 60 } },
      { status: 409, body: { error: 'a request for cup:quickdraw is already pending' } },
    );
    expect(await run()).toEqual([]);
    expect(await run()).toEqual([]);
    expect(posts).toHaveLength(2);
  });
});
