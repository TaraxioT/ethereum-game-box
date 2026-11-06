// The Box's rounds on disk ($EGB_DATA/rounds.json): the next round, and every pot the Box opened that hasn't been
// settled or refunded yet, with when it opened. Written synchronously before a round is used, so no round ever repeats
// across a restart or a power cut, and a pot the Box lost track of is still refunded once its delay has run. Team games'
// pots are in `DuelPot` and store games' in `StorePot`, and one count of rounds serves both.
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";

/** Which contract holds a pot. */
export type PotKind = "duel" | "store";

export interface Rounds {
  /** The next round, taken: it is on disk before this returns. */
  take(): number;
  /** Moves the next round past `round` (one the chain has already seen). */
  skipPast(round: number): void;
  /** The round the next `take` gives. */
  peek(): number;
  opened(round: number, at: number, kind?: PotKind): void;
  /** The pot settled or was refunded. */
  closed(round: number): void;
  /** Pots still open, with when each opened (ms since the epoch). */
  open(kind?: PotKind): ReadonlyMap<number, number>;
}

interface RoundsFile {
  readonly next: number;
  readonly pots: Readonly<Record<string, number>>;
  /** Left out while there are none. */
  readonly storePots?: Readonly<Record<string, number>>;
}

function load(file: string): RoundsFile {
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as Partial<RoundsFile>;
    const next = typeof data.next === "number" && Number.isSafeInteger(data.next) && data.next >= 1 ? data.next : 1;
    const pots = typeof data.pots === "object" && data.pots !== null ? data.pots : {};
    const storePots = typeof data.storePots === "object" && data.storePots !== null ? data.storePots : {};
    return { next, pots, storePots };
  } catch {
    return { next: 1, pots: {} };
  }
}

export function roundsFile(file: string): Rounds {
  const data = load(file);
  let next = data.next;
  const potsOf = (saved: Readonly<Record<string, number>> = {}) => new Map<number, number>(Object.entries(saved).map(([round, at]) => [Number(round), at]));
  const pots: Record<PotKind, Map<number, number>> = { duel: potsOf(data.pots), store: potsOf(data.storePots) };

  function save(): void {
    const saved: RoundsFile = { next, pots: Object.fromEntries(pots.duel), ...(pots.store.size > 0 ? { storePots: Object.fromEntries(pots.store) } : {}) };
    const text = `${JSON.stringify(saved)}\n`;
    const temp = `${file}.tmp`;
    const fd = openSync(temp, "w");
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, file);
  }

  return {
    take() {
      const round = next;
      next++;
      save();
      return round;
    },
    skipPast(round) {
      if (round < next) return;
      next = round + 1;
      save();
    },
    peek: () => next,
    opened(round, at, kind = "duel") {
      pots[kind].set(round, at);
      save();
    },
    closed(round) {
      if (pots.duel.delete(round) || pots.store.delete(round)) save();
    },
    open: (kind = "duel") => pots[kind],
  };
}
