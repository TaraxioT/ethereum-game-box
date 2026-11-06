// The real clock, for the hosts that run the core (SimLink in the browser, the Box server and the taps on the Pi).
// The core never imports this file: tsconfig.core.json leaves it out and has no timers, so an import from the core
// fails its check.
import type { Clock, TimerHandle } from "./ports.ts";

type Native = ReturnType<typeof setTimeout>;

export function systemClock(): Clock {
  return {
    now: () => Date.now(),
    after: (ms, run) => setTimeout(run, ms) as unknown as TimerHandle,
    every: (ms, run) => setInterval(run, ms) as unknown as TimerHandle,
    cancel(handle) {
      if (handle === null) return;
      // One handle space for both in browsers and Node: clearing with the other function is harmless.
      clearTimeout(handle as unknown as Native);
      clearInterval(handle as unknown as Native);
    },
  };
}
