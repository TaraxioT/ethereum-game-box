// Closes championships nobody closed: on each alarm, every game in `CUP_GAMES` whose open championship's `ends` has
// passed gets a `POST /cup/close`. Anyone may close one; the demo Box does it so a championship closes (its prize paid,
// its name given to the winner, its records frozen) even if nobody clicks.

import type { BoxChain } from './chain.ts';
import type { Relayer } from './relayer.ts';

export interface CupCloserOptions {
  chain: Pick<BoxChain, 'openCup'>;
  relayer: Relayer;
  /** The games to watch. */
  games: readonly string[];
  /** Unix seconds. */
  now: () => number;
}

/** Asks the relayer to close each ended championship. Returns the relayer's request ids. */
export async function closeEndedCups({ chain, relayer, games, now }: CupCloserOptions): Promise<string[]> {
  const ids: string[] = [];
  for (const game of games) {
    const cup = await chain.openCup(game);
    if (!cup || now() < cup.ends) continue;
    const reply = await relayer.post('/cup/close', { game });
    // A 409 is a close already pending, or one the chain has not caught up to: the next alarm tries again.
    if (reply.status === 202) ids.push(String(reply.body.id));
    else console.warn(`close ${cup.label}.${game}: ${reply.status} ${String(reply.body.error)}`);
  }
  return ids;
}
