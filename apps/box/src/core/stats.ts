// A player's stats over every game: a result counted as `PlayerStats` counts it on chain (the demo chain keeps its
// own), and the stats as the result screen and the lobby write them.
import type { PlayerRecord } from "./types.ts";

export const NO_RECORD: PlayerRecord = { played: 0, wins: 0, losses: 0, draws: 0, streak: 0, best: 0 };

/** `r` with one more result: a win adds to the streak, a loss or a draw ends it. */
export function counted(r: PlayerRecord, result: "win" | "loss" | "draw"): PlayerRecord {
  const streak = result === "win" ? r.streak + 1 : 0;
  return {
    played: r.played + 1,
    wins: r.wins + (result === "win" ? 1 : 0),
    losses: r.losses + (result === "loss" ? 1 : 0),
    draws: r.draws + (result === "draw" ? 1 : 0),
    streak,
    best: Math.max(r.best, streak),
  };
}

/** `4W 1L 1D, streak 3`: the draws only when there are some, the streak only while it runs. */
export function recordText(r: PlayerRecord): string {
  return `${r.wins}W ${r.losses}L${r.draws > 0 ? ` ${r.draws}D` : ""}${r.streak > 0 ? `, streak ${r.streak}` : ""}`;
}
