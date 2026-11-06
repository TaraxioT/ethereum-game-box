import { describe, expect, it } from 'vitest';

import { parseLeaderboard, parseStandings, parseStats } from './keys.ts';

describe('parseStandings', () => {
  it('reads the rows Championships writes, in rank order', () => {
    const text =
      '[{"name":"nova.gamebox.eth","addr":"0x2222222222222222222222222222222222222222","points":6,"wins":2,"draws":0,"losses":1},' +
      '{"name":"kite.gamebox.eth","addr":"0x4444444444444444444444444444444444444444","points":1,"wins":0,"draws":1,"losses":2}]';
    expect(parseStandings(text)).toEqual([
      { name: 'nova.gamebox.eth', addr: '0x2222222222222222222222222222222222222222', points: 6, wins: 2, draws: 0, losses: 1 },
      { name: 'kite.gamebox.eth', addr: '0x4444444444444444444444444444444444444444', points: 1, wins: 0, draws: 1, losses: 2 },
    ]);
    expect(parseStandings('[]')).toEqual([]);
  });

  it('refuses anything else', () => {
    expect(() => parseStandings('{}')).toThrow('not an array');
    expect(() => parseStandings('[{"name":"x"}]')).toThrow('malformed');
  });
});

describe('parseStats', () => {
  it('reads the record PlayerStats writes: the totals, then each game', () => {
    const text =
      '{"played":4,"wins":3,"losses":1,"draws":0,"streak":0,"best":3,"games":{"stockduel":{"wins":2,"losses":0,"draws":0},"quickdraw":{"wins":1,"losses":1,"draws":0}}}';
    expect(parseStats(text)).toEqual({
      played: 4,
      wins: 3,
      losses: 1,
      draws: 0,
      streak: 0,
      best: 3,
      games: { stockduel: { wins: 2, losses: 0, draws: 0 }, quickdraw: { wins: 1, losses: 1, draws: 0 } },
    });
  });

  it('refuses anything else, the per-game record of the first PlayerStats included', () => {
    expect(() => parseStats('{"stockduel":{"wins":1,"losses":0,"draws":0}}')).toThrow('malformed');
    expect(() => parseStats('{"played":0,"wins":0,"losses":0,"draws":0,"streak":0,"best":0}')).toThrow('no games');
  });
});

describe('parseLeaderboard', () => {
  it('reads the rows PlayerStats writes to gamebox.eth, in rank order', () => {
    const text =
      '[{"name":"alice.gamebox.eth","played":2,"wins":2,"losses":0,"draws":0,"streak":2,"best":2},' +
      '{"name":"bob.gamebox.eth","played":2,"wins":0,"losses":2,"draws":0,"streak":0,"best":0}]';
    expect(parseLeaderboard(text)).toEqual([
      { name: 'alice.gamebox.eth', played: 2, wins: 2, losses: 0, draws: 0, streak: 2, best: 2 },
      { name: 'bob.gamebox.eth', played: 2, wins: 0, losses: 2, draws: 0, streak: 0, best: 0 },
    ]);
    expect(parseLeaderboard('[]')).toEqual([]);
  });

  it('refuses anything else', () => {
    expect(() => parseLeaderboard('{}')).toThrow('not an array');
    expect(() => parseLeaderboard('[{"name":"x"}]')).toThrow('malformed');
  });
});
