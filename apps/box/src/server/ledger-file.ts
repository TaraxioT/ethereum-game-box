// The simulated ledger on the Pi: $EGB_DATA/ledger.json, read once at start and written atomically after every
// change. Writes run off the tap path (asynchronously, one at a time, only the latest), because an fsync on the Pi's
// SD card can take tens of milliseconds.
import { readFileSync, renameSync } from "node:fs";
import type { LedgerData, LedgerStore } from "../core/ports.ts";
import { EMPTY_LEDGER } from "../core/ledger.ts";
import { writeFileAtomic } from "./files.ts";

export interface LedgerFile extends LedgerStore {
  /** Resolves once every change so far is on disk. */
  flush(): Promise<void>;
}

const whole = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** An address → whole EGB map, or null. */
function amounts(value: unknown): Record<string, number> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.every(([address, amount]) => /^0x[0-9a-fA-F]{40}$/.test(address) && whole(amount))) return null;
  return Object.fromEntries(entries) as Record<string, number>;
}

/** A ledger from parsed JSON, or null when it isn't one. */
export function checkLedger(value: unknown): LedgerData | null {
  if (typeof value !== "object" || value === null) return null;
  const balances = amounts((value as Record<string, unknown>).balances);
  const escrow = amounts((value as Record<string, unknown>).escrow);
  return balances && escrow ? { balances, escrow } : null;
}

export function createLedgerFile(file: string, log: (text: string) => void): LedgerFile {
  let latest: LedgerData | null = null;
  let writing: Promise<void> | null = null;

  async function drain(): Promise<void> {
    while (latest) {
      const next = latest;
      latest = null;
      try {
        await writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
      } catch (error) {
        log(`ledger: couldn't write ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    writing = null;
  }

  return {
    load() {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        return EMPTY_LEDGER;
      }
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Treated as not a ledger, below.
      }
      const ledger = checkLedger(parsed);
      if (ledger) return ledger;
      // Kept for a person to look at; the Box starts from an empty ledger rather than refusing to start.
      const aside = `${file}.bad-${Date.now()}`;
      renameSync(file, aside);
      log(`ledger: ${file} isn't a ledger; moved it to ${aside} and started empty`);
      return EMPTY_LEDGER;
    },
    save(ledger) {
      latest = ledger;
      writing ??= drain();
    },
    async flush() {
      while (writing) await writing;
    },
  };
}
