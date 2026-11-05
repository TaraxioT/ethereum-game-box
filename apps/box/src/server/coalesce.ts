// Folds a burst of calls into at most one run per window. The first call after a quiet spell runs on the next tick;
// calls during the wait fold into one trailing run, so the last change always goes out.

export interface Coalescer {
  trigger(): void;
  /** Drops a pending run. */
  cancel(): void;
}

export function coalesce(run: () => void, everyMs: number): Coalescer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = -Infinity;
  return {
    trigger() {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        run();
      }, Math.max(0, last + everyMs - Date.now()));
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
