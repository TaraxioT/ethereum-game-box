import { describe, expect, it } from 'vitest';

import { parseStandings } from './keys.ts';

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
