// The simulated chain: a block every 12 s numbered from Sepolia's real height, and a gas price that wanders.

/** Sepolia's pace. */
export const BLOCK_MS = 12_000;
/** A real Sepolia block and when it was sealed: the head counts on from here. */
export const ANCHOR_BLOCK = 12_065_134;
export const ANCHOR_AT = Date.parse("2026-11-04T21:35:59Z");

export const GAS_MIN = 0.8;
export const GAS_MAX = 4;
/** The largest move of the gas price per block, and per drift between blocks (gwei). */
export const GAS_STEP = 0.35;
export const GAS_DRIFT = 0.06;
/** How often gas drifts between blocks. */
export const DRIFT_MS = 3_000;

/** The head at `now` and when it was sealed. */
export function blockAt(now: number): { readonly block: number; readonly at: number } {
  const sealed = Math.floor((now - ANCHOR_AT) / BLOCK_MS);
  return { block: ANCHOR_BLOCK + sealed, at: ANCHOR_AT + sealed * BLOCK_MS };
}

/** When the block after the head at `now` is sealed. */
export function nextBlockAt(now: number): number {
  return blockAt(now).at + BLOCK_MS;
}

/** One step of a bounded random walk, kept inside [GAS_MIN, GAS_MAX] and rounded to 0.01 gwei. */
export function nextGas(gwei: number, rnd: () => number, step: number = GAS_STEP): number {
  const moved = gwei + (rnd() * 2 - 1) * step;
  const bounded = Math.min(GAS_MAX, Math.max(GAS_MIN, moved));
  return Math.round(bounded * 100) / 100;
}

/** A starting gas price somewhere in the band. */
export function firstGas(rnd: () => number): number {
  return Math.round((GAS_MIN + rnd() * (GAS_MAX - GAS_MIN)) * 100) / 100;
}
