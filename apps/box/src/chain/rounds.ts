// The Box's rounds on disk ($EGB_DATA/rounds.json): the next round, and every pot the Box opened that hasn't been
// settled or refunded yet, with when it opened. Written synchronously before a round is used, so no round ever repeats
// across a restart or a power cut, and a pot the Box lost track of is still refunded once its delay has run.
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";

export interface Rounds {
  /** The next round, taken: it is on disk before this returns. */
  take(): number;
  /** Moves the next round past `round` (one the chain has already seen). */
  skipPast(round: number): void;
  /** The round the next `take` gives. */
  peek(): number;
  opened(round: number, at: number): void;
  /** The pot settled or was refunded. */
  closed(round: number): void;
  /** Pots still open, with when each opened (ms since the epoch). */
  open(): ReadonlyMap<number, number>;
}

interface RoundsFile {
  readonly next: number;
  readonly pots: Readonly<Record<string, number>>;
}

function load(file: string): RoundsFile {
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as Partial<RoundsFile>;
    const next = typeof data.next === "number" && Number.isSafeInteger(data.next) && data.next >= 1 ? data.next : 1;
    const pots = typeof data.pots === "object" && data.pots !== null ? data.pots : {};
    return { next, pots };
  } catch {
    return { next: 1, pots: {} };
  }
}

export function roundsFile(file: string): Rounds {
  const data = load(file);
  let next = data.next;
  const pots = new Map<number, number>(Object.entries(data.pots).map(([round, at]) => [Number(round), at]));

  function save(): void {
    const text = `${JSON.stringify({ next, pots: Object.fromEntries(pots) })}\n`;
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
    opened(round, at) {
      pots.set(round, at);
      save();
    },
    closed(round) {
      if (pots.delete(round)) save();
    },
    open: () => pots,
  };
}
