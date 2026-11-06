// A store match's log as the Box writes it, within `LOG_LIMITS`: the taps it saw and the events the game claimed, each
// labelled by source, closed by its one `end`. A log past its limits would be refused whole, so nothing here can get it
// there. Game events stop at half the log (the kiosk's gate holds the same budget), so a game can't crowd out the taps,
// and they stop sooner if the taps have used up the rest: an event always leaves room for one tap and the close. A tap
// costs under 100 bytes, so with the game held to half the bytes the entries always run out first. When the taps fill
// the log the match must close, or the judge would miss them. Pure.
import { FRAME_LIMITS, LOG_LIMITS, utf8Bytes, type LogEntry, type Seat } from "@egb/sdk";
import type { StoreEnd } from "./types.ts";

export interface StoreLog {
  tap(seat: Seat, at: number, roll: number | null): void;
  /** Writes a game's event if its budget has room. */
  event(name: string, data: unknown, at: number): void;
  /** There's no room for another tap and the close: the match must close now. */
  full(): boolean;
  /** Writes the closing entry and answers every entry. */
  close(why: StoreEnd, at: number): readonly LogEntry[];
}

export function createStoreLog(): StoreLog {
  const entries: LogEntry[] = [];
  let gameEntries = 0;
  let gameBytes = 0;
  const room = (needed: number): boolean => entries.length + needed <= LOG_LIMITS.entries;

  return {
    tap(seat, at, roll) {
      entries.push({ src: "box", t: "tap", seat, at, roll });
    },
    event(name, data, at) {
      const entry: LogEntry = { src: "game", t: "event", at, name, data };
      const cost = utf8Bytes(JSON.stringify(entry));
      if (!room(3) || gameEntries >= FRAME_LIMITS.eventEntries || gameBytes + cost > FRAME_LIMITS.eventBytes) return;
      gameEntries++;
      gameBytes += cost;
      entries.push(entry);
    },
    full: () => !room(2),
    close(why, at) {
      entries.push({ src: "box", t: "end", at, why });
      return entries;
    },
  };
}
