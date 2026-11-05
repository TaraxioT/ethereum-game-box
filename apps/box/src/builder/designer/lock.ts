// The edit lock: the Forge holds it while a build runs, and the Designer refuses edits while it is held, so the brief
// a build was started from never changes under it. The Forge takes it the moment it accepts a brief (inside the
// Designer's onConfirm), so a second tap on Build finds it held.

export interface EditLock {
  /** Takes the lock; the returned function gives it back (once; later calls do nothing). */
  hold(): () => void;
  held(): boolean;
  /** Called on every change of `held()`. Returns an unsubscribe function. */
  onChange(listener: (held: boolean) => void): () => void;
}

export function createEditLock(): EditLock {
  let holders = 0;
  const listeners = new Set<(held: boolean) => void>();
  const tell = () => {
    for (const l of [...listeners]) l(holders > 0);
  };
  return {
    hold() {
      holders++;
      if (holders === 1) tell();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders--;
        if (holders === 0) tell();
      };
    },
    held: () => holders > 0,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
