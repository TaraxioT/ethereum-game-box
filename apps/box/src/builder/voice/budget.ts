// This Box's own monthly caps on ElevenLabs spending: text-to-speech characters and speech-to-text seconds. The free
// tier's 10,000 credits a month are shared by both, so the Box keeps running totals on disk and refuses any call that
// would go past a cap, whatever the account says. A call reserves its amount before it starts, so calls in flight
// together can't overshoot; it spends only once ElevenLabs has answered. Each counter restarts with the UTC month.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  /** Counts `n` as spent and saves the total. */
  spend(n: number): void;
}

export function createBudget(dir: string, unit: BudgetUnit, limit: number, now: () => number): Budget {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, FILES[unit]);
  let data = load();
  let reserved = 0;

  function load(): { period: string; used: number } {
    const fresh = { period: periodOf(now()), used: 0 };
    try {
      const j = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      if (j.period === fresh.period && typeof j.used === "number" && j.used >= 0) return { period: fresh.period, used: j.used };
    } catch {
      // Missing or unreadable: count from zero this month.
    }
    return fresh;
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
      if (!(n > 0)) return;
      roll();
      data = { period: data.period, used: data.used + n };
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, file);
    },
  };
}
