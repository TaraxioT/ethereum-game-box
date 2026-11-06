// A match at the Box, as two players play one: badges on stations, the kiosk's buttons through the link, and the game's
// real page in the kiosk's frame. Each step waits for what the Box says.

import { SimBadge } from '../../box/src/taps/fake/sim-badge.ts';
import type { BoxState, StorePlay } from '../../box/src/core/types.ts';
import type { RunningBox } from './box.ts';

/** The two simulated badges a run plays with. */
export const PLAYERS = [new SimBadge('ada'), new SimBadge('bo')] as const;
export const BADGES = PLAYERS.map(({ identity }) => identity);

const seats = [0, 1] as const;

/** How long a page's ten seconds, its grace and the Box's hold can take. */
const MATCH_MS = 45_000;

const store = (state: BoxState): StorePlay | null => (state.match?.play.game === 'store' ? state.match.play : null);

/** The players' lines on the stations. */
export const linesOf = (state: BoxState) => store(state)?.lines ?? [];

/** What the verifier has said, as the Box shows it. */
export const judgedOf = (state: BoxState) => store(state)?.judged ?? null;

/** Home, with the game in focus. */
export async function toHome(box: RunningBox, game: string): Promise<void> {
  const { link } = box;
  await box.reset();
  link.send({ type: 'booted' });
  link.send({ type: 'start' });
  await link.until(({ phase }) => phase === 'home', 'Home');
  await link.until(({ games }) => games.some(({ id, ready }) => id === game && ready), `${game} in the rack`, 90_000);
  link.send({ type: 'focus', game });
  await link.until(({ focus }) => focus === game, `${game} in focus`);
}

/** Both badges sit down at Join, which fetches the bundle. Resolves at Join, whatever comes of the fetch. */
export async function join(box: RunningBox, game: string): Promise<void> {
  await toHome(box, game);
  box.link.send({ type: 'play' });
  await box.link.until(({ phase }) => phase === 'join', 'Join');
  for (const seat of seats) if (box.link.state().seats[seat].badge === null) await box.tap(PLAYERS[seat].name, seat);
}

/** Both badges sign `amount`, and the Box sends the stake. */
export async function sign(box: RunningBox, amount: number): Promise<void> {
  const { link } = box;
  await link.until(({ phase }) => phase === 'stake', 'Stake');
  link.send({ type: 'stake', amount });
  await link.until(({ stake, seats: sat }) => stake === amount && sat.every(({ balance, ens }) => (balance ?? 0) >= amount && ens !== null), 'names and balances read');
  for (const seat of seats) await box.tap(PLAYERS[seat].name, seat);
}

/** The match is open: the round the Box staked. */
export async function opened(box: RunningBox): Promise<bigint> {
  const state = await box.link.until(({ phase }) => phase === 'playing', 'the match begun', 60_000);
  return BigInt(state.match?.round ?? 0);
}

/** Plays the page: `taps[seat]` taps each, once the page has said it hears. Ten seconds later the game ends itself. */
export async function play(box: RunningBox, taps: readonly [number, number]): Promise<void> {
  const { link } = box;
  await link.until((state) => linesOf(state).every((line) => line === 'TAP!'), "the page's first words", 60_000);
  // A tap before the page has answered the kiosk isn't handed on, so the first goes until the page has heard one.
  while (!/^[1-9]/.test(linesOf(link.state())[0] ?? '')) await box.tap(PLAYERS[0].name, 0);
  const heard = Number(linesOf(link.state())[0]);
  for (let tap = heard; tap < taps[0]; tap++) await box.tap(PLAYERS[0].name, 0);
  for (let tap = 0; tap < taps[1]; tap++) await box.tap(PLAYERS[1].name, 1);
  await link.until(({ phase }) => phase === 'judging', 'Judging', MATCH_MS);
}

/** A whole match up to Judging: the round it staked. */
export async function stakeAndPlay(box: RunningBox, game: string, amount: number, taps: readonly [number, number]): Promise<bigint> {
  await join(box, game);
  await sign(box, amount);
  const round = await opened(box);
  await play(box, taps);
  return round;
}
