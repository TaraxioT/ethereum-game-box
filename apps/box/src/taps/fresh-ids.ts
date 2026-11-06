// Each station's latest `tap`, `gone` and `signed` id, so a resend of an older line is ignored. A station resends
// each of these until the receiver acks it, and the receiver acks every copy: a copy of tap N whose ack was lost can
// reach the Pi after tap N+1, and taken as a tap it would start a phantom one and fail the real one as lifted.
//
// Ids are u32 counters (a station's taps count from 1 at its boot), compared modulo 2³². A line is a resend when its
// id is the latest or a few behind it, and it comes within RESEND_MS of the latest: a station resends for at most its
// link timeout plus the Pi's grace. An id further behind, or one that comes later, is a station that rebooted and
// started counting again: it is taken, and becomes the latest.

/** The lines that carry a station's own counter. */
export type CountedLine = "tap" | "gone" | "signed";

/** How long after the latest line a resend of an older one can still arrive. */
export const RESEND_MS = 6000;
/** How far behind the latest id a resend can be: a handful of taps fit in RESEND_MS. */
export const RESEND_IDS = 16;

export class FreshIds {
  private readonly latest = new Map<string, { readonly id: number; readonly at: number }>();

  /** Whether a line with this id is new (it then becomes the latest); `now` is when it arrived (ms). */
  fresh(kind: CountedLine, st: string, id: number, now: number): boolean {
    const key = `${kind} ${st}`;
    const last = this.latest.get(key);
    if (last && (last.id - id) >>> 0 < RESEND_IDS && now - last.at < RESEND_MS) return false;
    this.latest.set(key, { id, at: now });
    return true;
  }
}
