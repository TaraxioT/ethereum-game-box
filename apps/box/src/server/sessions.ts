// The session log: one transcript line per match in $EGB_DATA/sessions/YYYY-MM-DD.jsonl (the Box's local date of
// the match's end), appended in order through one queue so lines never interleave. `load()` reads the log back, off
// the start's path (the server calls it after it listens), to rebuild each badge's record (wins, losses, draws) and
// the counted results of the last hour, which the free-result rule's per-pair cap needs. Only counted results go into
// records.
//
// Appends wait for that read, so a line written this run is never counted twice. A file whose last line was torn (a
// power cut mid-write) gets a newline before the next line, so the torn line can't swallow it.
import { open, readdir, readFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Transcript } from "@egb/sdk";
import type { MatchLog } from "../core/ports.ts";

export interface BadgeRecord {
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
}

export interface SessionLog extends MatchLog {
  /** Reads the log back into the records and counts; appends wait for it. Call once, after the server listens. */
  load(): Promise<void>;
  /** Each badge's record, by address (this run's matches alone until `load()` is done). */
  records(): Readonly<Record<string, BadgeRecord>>;
  /** Resolves once every line so far is on disk (loading the log first if nothing has). */
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

/** Whether a file ends in a newline: true for a missing or empty one. */
async function endsClean(file: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(file, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return true;
    const last = Buffer.alloc(1);
    await handle.read(last, 0, 1, size - 1);
    return last[0] === 0x0a;
  } finally {
    await handle.close();
  }
}

export function createSessionLog(dataDir: string, log: (text: string) => void): SessionLog {
  const dir = join(dataDir, "sessions");
  const records = new Map<string, BadgeRecord>();
  /** Counted results' end times, by pair. */
  const counted = new Map<string, number[]>();
  /** Files this run knows end in a newline (checked before its first append to each). */
  const clean = new Set<string>();
  let startLoad!: () => void;
  const loadAsked = new Promise<void>((resolve) => {
    startLoad = resolve;
  });
  const loaded = mkdir(dir, { recursive: true })
    .then(() => loadAsked)
    .then(rebuild)
    .catch((error: unknown) => log(`sessions: couldn't read the log back: ${error instanceof Error ? error.message : String(error)}`));
  let queue: Promise<void> = loaded;

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

  /** Counts every line already in the log, oldest day first, one file at a time. */
  async function rebuild(): Promise<void> {
    const files = (await readdir(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
    for (const file of files) {
      for (const line of (await readFile(join(dir, file), "utf8")).split("\n")) {
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
  }

  async function append(file: string, line: string): Promise<void> {
    if (!clean.has(file)) {
      if (!(await endsClean(file))) line = `\n${line}`;
      clean.add(file);
    }
    await appendFile(file, line);
  }

  return {
    load() {
      startLoad();
      return loaded;
    },
    record(t) {
      count(t);
      const line = `${JSON.stringify(t)}\n`;
      const file = join(dir, `${dayOf(t.endedAt)}.jsonl`);
      queue = queue
        .then(() => append(file, line))
        .catch((error: unknown) => {
          // Unknown how much reached the file: check its end again before the next line.
          clean.delete(file);
          log(`sessions: couldn't write a transcript: ${error instanceof Error ? error.message : String(error)}`);
        });
    },
    countedSince(badges, since) {
      return (counted.get(pairKey(badges)) ?? []).filter((at) => at >= since).length;
    },
    records: () => Object.fromEntries(records),
    // A log that was never loaded loads now: its appends wait for that, and a flush must not wait for ever.
    flush() {
      startLoad();
      return queue;
    },
  };
}
