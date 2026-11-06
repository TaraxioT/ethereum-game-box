// The receiver's clock on the Pi's: maps `at_us` (the C3's micros(), a u32 that wraps every ~71.6 minutes) onto Pi
// ms, and estimates when a chip touched a station from its `tap` line. Time comes from the touch, never from when a
// reply arrived.
//
// The offset is a running minimum of (Pi receive time − at_us): the line that reached the Pi fastest is the best
// sample, since USB and the event loop only ever add delay. The minimum ages upward by MAX_DRIFT of the time since the
// last sample, so the two crystals drifting apart can't freeze an old offset in place.
import type { ReceiverEvent } from "./lines.ts";

const WRAP = 2 ** 32;
const HALF = 2 ** 31;
/** The C3's and the Pi's clocks may drift apart this much (100 ppm, generous for both crystals). */
const MAX_DRIFT = 1e-4;
/** A line can't take this long over USB: a sample this late means the receiver's clock jumped back (a reboot). */
const RESYNC_MS = 1000;
/** A tap that took `tries` sends left the station (tries − 1) resends earlier than the copy that got through. */
export const TAP_RESEND_US = 20_000;
/** One-way radio when the station hasn't reported a ping yet: half the measured 2.4–3.1 ms round trip. */
export const DEFAULT_RADIO_US = 1500;

type TapLine = Extract<ReceiverEvent, { ev: "tap" }>;

export class ReceiverClock {
  /** Pi ms minus receiver ms (unwrapped); NaN before the first sample. */
  private offset = Number.NaN;
  private sampledAt = 0;
  private lastRaw = -1;
  /** at_us of lastRaw with every wrap added back: µs since the receiver booted. */
  private lastUs = 0;

  /** Forgets everything (the receiver rebooted, or the port reopened). */
  reset(): void {
    this.offset = Number.NaN;
    this.lastRaw = -1;
  }

  /** Takes a line's at_us and the Pi time (ms) its chunk arrived. */
  observe(atUs: number, piMs: number): void {
    const us = this.unwrap(atUs, true);
    const sample = piMs - us / 1000;
    if (Number.isNaN(this.offset) || sample > this.offset + RESYNC_MS + (piMs - this.sampledAt) * MAX_DRIFT) {
      this.offset = sample;
    } else {
      this.offset = Math.min(this.offset + (piMs - this.sampledAt) * MAX_DRIFT, sample);
    }
    this.sampledAt = piMs;
  }

  /** at_us on the Pi's clock (ms), or NaN before any sample. */
  toPi(atUs: number): number {
    return this.unwrap(atUs, false) / 1000 + this.offset;
  }

  /**
   * When the chip touched, in Pi ms: the tap's at_us, less the radio, the station's read and half the detection gap
   * before it (the chip landed somewhere in that gap). Observe the line first. `radioUs` is the station's one-way
   * radio time; `piMs` caps the estimate (and stands in before the first sample).
   */
  touchedAt(tap: TapLine, radioUs: number, piMs: number): number {
    const at = this.toPi(tap.at_us);
    if (Number.isNaN(at)) return piMs;
    const resent = Math.max(0, tap.tries - 1) * TAP_RESEND_US;
    return Math.min(piMs, at - (radioUs + resent + tap.read_us + tap.gap_us / 2) / 1000);
  }

  /** µs since the receiver booted. A step back of less than half the range is an older line, not a wrap. */
  private unwrap(raw: number, advance: boolean): number {
    if (this.lastRaw < 0) {
      if (advance) {
        this.lastRaw = raw;
        this.lastUs = raw;
      }
      return raw;
    }
    const delta = (raw - this.lastRaw + WRAP) % WRAP;
    const us = delta < HALF ? this.lastUs + delta : this.lastUs - (WRAP - delta);
    if (advance && delta < HALF) {
      this.lastRaw = raw;
      this.lastUs = us;
    }
    return us;
  }
}
