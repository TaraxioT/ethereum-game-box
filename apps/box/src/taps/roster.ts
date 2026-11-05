// The badges this Box has read, by UID: each one's two key addresses and a local label (a short word, `nova`, shown
// upper-cased on the stations). Identity is the UID: the first tap of a chip reads its keys (get_pkeys) and the roster
// remembers them, so later taps need no chip command. Until ENS a badge's name is its label, never `.gamebox.eth`.
// Kept in $EGB_DATA/badges.json, written atomically after every change.
import { readFileSync, renameSync } from "node:fs";
import type { Badge } from "../core/types.ts";
import { writeFileAtomic } from "../server/files.ts";
import type { ChipKeys } from "./chip-ops.ts";
import type { Address } from "./eth.ts";

export interface RosterEntry {
  /** Upper-case hex. */
  readonly uid: string;
  readonly key1: Address;
  /** The identity: the badge's address everywhere. */
  readonly key2: Address;
  readonly label: string;
  /** ISO time of its first read. */
  readonly firstSeen: string;
}

interface RosterFile {
  readonly v: 1;
  readonly badges: readonly RosterEntry[];
}

/** Labels in the order new badges get them; after these, the words again with a number. */
const LABELS = [
  "nova", "orbit", "pixel", "comet", "ember", "flux", "echo", "quark", "vega", "lumen", "onyx", "rune",
  "zephyr", "jade", "atlas", "cinder", "drift", "sol", "ion", "kite", "lynx", "mesa", "opal", "raven",
] as const;

export class Roster {
  private readonly file: string;
  private readonly log: (line: string) => void;
  private readonly byUid_ = new Map<string, RosterEntry>();
  private writing: Promise<void> = Promise.resolve();

  private constructor(file: string, log: (line: string) => void, entries: readonly RosterEntry[]) {
    this.file = file;
    this.log = log;
    for (const e of entries) this.byUid_.set(e.uid, e);
  }

  /** Reads the roster (a missing file is an empty roster; a broken one is set aside as `.bad` and started over). */
  static load(file: string, log: (line: string) => void): Roster {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return new Roster(file, log, []);
      throw e;
    }
    try {
      const data = JSON.parse(text) as RosterFile;
      if (data.v !== 1 || !Array.isArray(data.badges)) throw new Error("not a version 1 roster");
      return new Roster(file, log, data.badges);
    } catch (e) {
      renameSync(file, `${file}.bad`);
      log(`taps: ${file} is unreadable (${e instanceof Error ? e.message : String(e)}); set aside as ${file}.bad`);
      return new Roster(file, log, []);
    }
  }

  byUid(uid: string): RosterEntry | undefined {
    return this.byUid_.get(uid.toUpperCase());
  }

  entries(): RosterEntry[] {
    return [...this.byUid_.values()];
  }

  /** Remembers a chip's keys. A badge keeps its label; a key-2 identity seen under another UID keeps that label too. */
  record(uid: string, keys: ChipKeys, now: Date): RosterEntry {
    const key = uid.toUpperCase();
    const known = this.byUid_.get(key);
    if (known && known.key1 === keys.key1 && known.key2 === keys.key2) return known;
    const label = this.entries().find((e) => e.key2 === keys.key2)?.label ?? this.freshLabel();
    const entry: RosterEntry = { uid: key, key1: keys.key1, key2: keys.key2, label, firstSeen: known?.firstSeen ?? now.toISOString() };
    this.byUid_.set(key, entry);
    this.save();
    return entry;
  }

  /** Waits for the last write (shutting down, tests). */
  flush(): Promise<void> {
    return this.writing;
  }

  private freshLabel(): string {
    const used = new Set(this.entries().map((e) => e.label));
    for (let round = 1; ; round++) {
      for (const word of LABELS) {
        const label = round === 1 ? word : `${word}${round}`;
        if (!used.has(label)) return label;
      }
    }
  }

  private save(): void {
    const data: RosterFile = { v: 1, badges: this.entries() };
    const text = `${JSON.stringify(data, null, 2)}\n`;
    this.writing = this.writing
      .then(() => writeFileAtomic(this.file, text))
      .catch((e: unknown) => this.log(`taps: couldn't save ${this.file}: ${e instanceof Error ? e.message : String(e)}`));
  }
}

/** A roster entry as the core sees a badge. */
export const badgeOf = (entry: RosterEntry): Badge => ({ address: entry.key2, name: entry.label });
