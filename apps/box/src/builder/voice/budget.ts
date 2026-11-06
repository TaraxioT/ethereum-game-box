// This Box's own monthly caps on ElevenLabs spending: text-to-speech characters and speech-to-text seconds. The free
// tier's 10,000 credits a month are shared by both, so the Box keeps running totals on disk and refuses any call that
// would go past a cap, whatever the account says. A call reserves its amount before it starts, so calls in flight
// together can't overshoot; it spends only once ElevenLabs has answered. Each counter restarts with the UTC month.
//
// The totals are written atomically (server/files.ts), so a power cut never tears one. A file that is there but can't
// be read or understood counts as the whole cap spent until the month turns: the Box never forgets what it spent and
// starts paying again from zero.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../../server/files.ts";

export type BudgetUnit = "chars" | "seconds";
const FILES: Record<BudgetUnit, string> = { chars: "tts-usage.json", seconds: "stt-usage.json" };

export const periodOf = (ms: number): string => new Date(ms).toISOString().slice(0, 7);

export interface Budget {
  /** Used this month. */
  used(): number;
  readonly limit: number;
  /** Holds `n` for a call about to start; false (and nothing held) if it wouldn't fit. */
  reserve(n: number): boolean;
  /** Gives a hold back: once per successful reserve, after spend() on success or alone on failure. */
  release(n: number): void;
  /** Counts `n` as spent at once; resolves when the total is on disk (a failed save is logged, never thrown). */
  spend(n: number): Promise<void>;
}

export function createBudget(dir: string, unit: BudgetUnit, limit: number, now: () => number): Budget {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, FILES[unit]);
  let data = load();
  let reserved = 0;
  let saving = Promise.resolve();

  function load(): { period: string; used: number } {
    const period = periodOf(now());
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch (err) {
      // No file yet: nothing spent. Anything else is a total the Box can't read, so it can't spend against it.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { period, used: 0 };
      console.warn(`[voice] ${FILES[unit]} can't be read (${(err as Error).name}): counting this month's ${unit} as spent`);
      return { period, used: limit };
    }
    if (j.period !== period && typeof j.period === "string") return { period, used: 0 };
    if (j.period === period && typeof j.used === "number" && j.used >= 0) return { period, used: j.used };
    console.warn(`[voice] ${FILES[unit]} isn't a total: counting this month's ${unit} as spent`);
    return { period, used: limit };
  }

  const roll = () => {
    const period = periodOf(now());
    if (period !== data.period) data = { period, used: 0 };
  };

  return {
    limit,
    used() {
      roll();
      return data.used;
    },
    reserve(n) {
      roll();
      if (!(n > 0) || data.used + reserved + n > limit) return false;
      reserved += n;
      return true;
    },
    release(n) {
      reserved = Math.max(0, reserved - n);
    },
    spend(n) {
      if (!(n > 0)) return saving;
      roll();
      data = { period: data.period, used: data.used + n };
      const text = JSON.stringify(data);
      // In order, one at a time: the last total written is the newest.
      saving = saving.then(() => writeFileAtomic(file, text)).catch((err: unknown) => {
        console.warn(`[voice] couldn't save ${FILES[unit]}: ${(err as Error).message}`);
      });
      return saving;
    },
  };
}
