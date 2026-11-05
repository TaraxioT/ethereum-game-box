// Timers on the core's clock that one call cancels together: each part of the core (the phase machine, the
// transaction book, the bot) keeps its own, so stopping it leaves nothing running.
import type { Clock, TimerHandle } from "./ports.ts";

export interface Timers {
  after(ms: number, run: () => void): TimerHandle;
  every(ms: number, run: () => void): TimerHandle;
  cancel(handle: TimerHandle | null): void;
  /** Cancels every timer still pending. */
  clear(): void;
}

export function createTimers(clock: Clock): Timers {
  const live = new Set<TimerHandle>();
  return {
    after(ms, run) {
      const handle = clock.after(ms, () => {
        live.delete(handle);
        run();
      });
      live.add(handle);
      return handle;
    },
    every(ms, run) {
      const handle = clock.every(ms, run);
      live.add(handle);
      return handle;
    },
    cancel(handle) {
      if (handle === null) return;
      clock.cancel(handle);
      live.delete(handle);
    },
    clear() {
      for (const handle of live) clock.cancel(handle);
      live.clear();
    },
  };
}
