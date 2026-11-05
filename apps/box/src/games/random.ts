// Seeded randomness for the rules. Everything here is pure: the same seed always gives the same numbers.

/** A uint32 from the parts, mixed so that nearby inputs (seed 7 vs seed 8, seat 0 vs seat 1) land far apart. */
export function hash32(...parts: readonly (string | number)[]): number {
  // FNV-1a over each part's text, with a separator between parts so ("ab", "c") differs from ("a", "bc").
  let h = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i++) {
      h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    }
    h = Math.imul(h ^ 0xff, 0x01000193);
  }
  // Murmur3's finalizer spreads the last bytes into the low bits, which `% 4` picks from.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A generator of numbers in [0, 1) from a uint32 seed (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shuffled copy (Fisher-Yates) of `items`; the input is left alone. */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const next = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}
