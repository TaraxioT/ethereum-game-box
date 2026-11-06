// The real clocks, for the hosts that run the core (SimLink in the browser, the Box server and the taps on the Pi).
// The core never imports this file: tsconfig.core.json leaves it out and has no timers, so an import from the core
// fails its check.
import type { Clock, TimerHandle } from "./ports.ts";

type Native = ReturnType<typeof setTimeout>;

/** The wall clock: the demo in the browser, where a laptop that slept should wake to the real time. */
export function systemClock(): Clock {
  return clockOn(() => Date.now());
}

/**
 * Wall time at the start, then a monotonic count from there: the Box server's clock. A step or slew of the system
 * clock (NTP) never moves it, so touch times mapped from the receiver's clock, the game's timers and the draw stay on
 * one timeline for as long as the server runs. It reads as ms since the epoch, as the wall clock did when the process
 * started.
 */
export function monotonicClock(): Clock {
  return clockOn(() => performance.timeOrigin + performance.now());
}

function clockOn(now: () => number): Clock {
  return {
    now,
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
