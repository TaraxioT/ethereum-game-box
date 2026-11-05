// A clock the caller moves by hand: the core's tests drive whole matches with it, and the server's tests run the
// core on it while HTTP and the WebSocket run in real time. Timers fire in due order, each seeing `now()` at its
// own due time, as real ones would.
import type { Clock, TimerHandle } from "./ports.ts";

export interface FakeClock extends Clock {
  /** Moves the clock on by `ms`, firing every timer that falls due on the way. */
  advance(ms: number): void;
  /** How many timers are set. */
  pending(): number;
}

interface Timer {
  readonly id: number;
  due: number;
  /** Set for `every`. */
  readonly period: number | null;
  readonly run: () => void;
}

export function createFakeClock(start: number): FakeClock {
  let now = start;
  let nextId = 1;
  const timers = new Map<number, Timer>();

  function add(ms: number, run: () => void, period: number | null): TimerHandle {
    const timer: Timer = { id: nextId++, due: now + Math.max(0, ms), period, run };
    timers.set(timer.id, timer);
    return timer.id as unknown as TimerHandle;
  }

  /** The next timer due by `until`: earliest first, then in the order they were set. */
  function nextDue(until: number): Timer | null {
    let next: Timer | null = null;
    for (const timer of timers.values()) {
      if (timer.due > until) continue;
      if (!next || timer.due < next.due || (timer.due === next.due && timer.id < next.id)) next = timer;
    }
    return next;
  }

  return {
    now: () => now,
    after: (ms, run) => add(ms, run, null),
    every: (ms, run) => add(ms, run, Math.max(1, ms)),
    cancel(handle) {
      if (handle !== null) timers.delete(handle as unknown as number);
    },
    advance(ms) {
      const until = now + ms;
      for (let timer = nextDue(until); timer; timer = nextDue(until)) {
        now = timer.due;
        if (timer.period === null) timers.delete(timer.id);
        else timer.due += timer.period;
        timer.run();
      }
      now = until;
    },
    pending: () => timers.size,
  };
}
