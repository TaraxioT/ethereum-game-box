// The keyboard stands in for the stations: A taps Player 1, L taps Player 2. Held keys don't repeat a tap, and
// typing into a field (or a shortcut with a modifier) never taps.
import type { SimControl } from "../link/sim/control.ts";
import type { Seat } from "../link/types.ts";

const KEYS: Readonly<Record<string, Seat>> = { a: 0, l: 1 };

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"));
}

/** Binds A / L to the two stations; returns the unbind. */
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
