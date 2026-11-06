// What the store says about a bundle before anyone downloads it. The store writes a listing from the reader's result,
// so it can't disagree with the zip, and the Box's rack shows one.
import type { OpenedBundle } from "./format.ts";

export interface StoreListing {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly players: { readonly min: number; readonly max: number };
  /** The stakes the Box offers, in whole USDC, ascending. */
  readonly stakes: readonly number[];
  /** Always null for now: a store cartridge uses the fallback icon. */
  readonly icon: null;
  /** The zip's sha256 as `0x` hex: the game's identity. */
  readonly hash: `0x${string}`;
  /** The zip's size in bytes. */
  readonly size: number;
}

/** `GET /index.json` on the store. */
export interface StoreIndex {
  readonly listings: readonly StoreListing[];
}

/** The listing of a bundle that has been read, given its zip's size. */
export function listingOf({ manifest, hash }: OpenedBundle, size: number): StoreListing {
  const { id, title, blurb, players, stakes } = manifest;
  return { id, title, blurb, players, stakes, icon: null, hash, size };
}
