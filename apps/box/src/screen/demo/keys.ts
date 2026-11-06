// The keyboard stands in for the stations: A taps Player 1, L Player 2, Z Player 3 and M Player 4. Held keys don't repeat a tap, and
// typing into a field (or a shortcut with a modifier) never taps.
import type { SimControl } from "../link/control.ts";
import type { Seat } from "../../core/types.ts";

/** Each seat's key, as its port hints it. */
export const SEAT_KEYS: readonly string[] = ["A", "L", "Z", "M"];

const KEYS: Readonly<Record<string, Seat>> = { a: 0, l: 1, z: 2, m: 3 };

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"));
}

/** Binds A, L, Z and M to the stations; returns the unbind. */
export function bindTapKeys(sim: Pick<SimControl, "tap">): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    const seat = KEYS[e.key.toLowerCase()];
    if (seat === undefined) return;
    e.preventDefault();
    sim.tap(seat);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
