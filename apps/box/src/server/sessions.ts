// The session log: one transcript line per match in $EGB_DATA/sessions/YYYY-MM-DD.jsonl (the Box's local date of
// the match's end), appended in order through one queue so lines never interleave. At start the log is read back to
// rebuild each badge's record (wins, losses, draws) and the counted results of the last hour, which the free-result
// rule's per-pair cap needs. Only counted results go into records.
import { readdirSync, readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Transcript } from "@egb/sdk";
import type { MatchLog } from "../core/ports.ts";

export interface BadgeRecord {
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
}

export interface SessionLog extends MatchLog {
  /** Each badge's record, by address. */
  records(): Readonly<Record<string, BadgeRecord>>;
  /** Resolves once every line so far is on disk. */
  flush(): Promise<void>;
}

/** The local date of `ms`, as the log's file names it. */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const pairKey = (badges: readonly [string, string]): string => [...badges].map((b) => b.toLowerCase()).sort().join(":");

/** A transcript from a parsed line, or null when the line isn't one (a torn line from a power cut). */
function transcriptOf(value: unknown): Transcript | null {
  if (typeof value !== "object" || value === null) return null;
  const t = value as Partial<Transcript>;
  const badges = t.badges;
  if (t.v !== 1 || !Array.isArray(badges) || badges.length !== 2 || typeof t.endedAt !== "number" || typeof t.counts !== "boolean") return null;
  if (t.result !== "void" && (typeof t.result !== "object" || t.result === null)) return null;
  return t as Transcript;
}

export function createSessionLog(dataDir: string, log: (text: string) => void): SessionLog {
  const dir = join(dataDir, "sessions");
  const records = new Map<string, BadgeRecord>();
  /** Counted results' end times, by pair. */
  const counted = new Map<string, number[]>();
  let queue: Promise<void> = mkdir(dir, { recursive: true }).then(() => undefined);

  function count(t: Transcript): void {
    if (!t.counts || t.result === "void") return;
    const key = pairKey(t.badges);
    counted.set(key, [...(counted.get(key) ?? []), t.endedAt]);
    const { winner } = t.result;
    t.badges.forEach((badge, seat) => {
      const address = badge.toLowerCase();
      const r = records.get(address) ?? { wins: 0, losses: 0, draws: 0 };
      records.set(
        address,
        winner === null ? { ...r, draws: r.draws + 1 } : winner === seat ? { ...r, wins: r.wins + 1 } : { ...r, losses: r.losses + 1 },
      );
    });
  }

  // Rebuild from the log, oldest day first.
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
  } catch {
    // No log yet.
  }
  for (const file of files) {
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(line);
      } catch {
        // A torn line: skipped.
      }
      const t = transcriptOf(parsed);
      if (t) count(t);
    }
  }

  return {
    record(t) {
      count(t);
      const line = `${JSON.stringify(t)}\n`;
      queue = queue
        .then(() => appendFile(join(dir, `${dayOf(t.endedAt)}.jsonl`), line))
        .catch((error: unknown) => log(`sessions: couldn't write a transcript: ${error instanceof Error ? error.message : String(error)}`));
    },
    countedSince(badges, since) {
      return (counted.get(pairKey(badges)) ?? []).filter((at) => at >= since).length;
    },
    records: () => Object.fromEntries(records),
    flush: () => queue,
  };
}
