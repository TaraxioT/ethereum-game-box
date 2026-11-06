// Structural sharing for states that arrive as JSON. Every message from the Box carries a whole new state, but views
// tell what changed by identity (`s === last`), as they can with SimLink: so every part that is equal to the last
// state's keeps the last state's object.

/** `next`, with each part deep-equal to `prev`'s replaced by `prev`'s own. */
export function reuse<T>(prev: T, next: T): T {
  if (prev === next) return prev;
  if (typeof prev !== "object" || typeof next !== "object" || prev === null || next === null) return next;
  if (Array.isArray(prev) !== Array.isArray(next)) return next;
  if (Array.isArray(prev) && Array.isArray(next)) {
    let same = prev.length === next.length;
    const out = next.map((item, i) => {
      const kept = i < prev.length ? reuse(prev[i], item) : item;
      if (kept !== prev[i]) same = false;
      return kept;
    });
    return (same ? prev : out) as T;
  }
  const before = prev as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  const keys = Object.keys(after);
  let same = keys.length === Object.keys(before).length;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const kept = key in before ? reuse(before[key], after[key]) : after[key];
    if (kept !== before[key] || !(key in before)) same = false;
    out[key] = kept;
  }
  return (same ? prev : out) as T;
}
