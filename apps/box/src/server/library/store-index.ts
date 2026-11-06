// What the store offers: its `/index.json` (EGB_STORE_URL), read at the start and on a timer. The library lists what this
// holds. An index that can't be read holds nothing, so the store's games leave the rack until it is back. A listing that
// isn't good is left out on its own, with the rest kept.
import { isGameId, MANIFEST_LIMITS, PLAYER_LIMITS, sharedManifestProblems } from "@egb/sdk";
import { readCapped } from "./fetch-capped.ts";

/** How often the index is read. */
export const STORE_INDEX_MS = 60_000;
/** A read waits this long for its answer. */
export const STORE_INDEX_TIMEOUT_MS = 10_000;
/** More than any store this size will list. */
const INDEX_BYTES = 1024 * 1024;

const HASH = /^0x[0-9a-f]{64}$/;

/** What the rack reads of a store listing, before anyone downloads the game. */
export interface RackListing {
  readonly id: string;
  readonly title: string;
  readonly players: { readonly min: number; readonly max: number };
  /** The stakes the Box offers, in whole USDC, ascending. */
  readonly stakes: readonly number[];
  /** The zip's sha256 as `0x` hex: the game's identity. */
  readonly hash: `0x${string}`;
}

export interface StoreIndex {
  /** Reads the index again. Never rejects: a failed read empties it. */
  refresh(): Promise<void>;
  listings(): readonly RackListing[];
}

export interface StoreIndexOptions {
  /** EGB_STORE_URL. */
  readonly url: string;
  readonly log: (text: string) => void;
  readonly fetcher?: typeof fetch;
}

function isPlayers(value: unknown): value is RackListing["players"] {
  if (typeof value !== "object" || value === null) return false;
  const { min, max } = value as Record<string, unknown>;
  return Number.isInteger(min) && Number.isInteger(max) && PLAYER_LIMITS.min <= (min as number) && (min as number) <= (max as number) && (max as number) <= PLAYER_LIMITS.max;
}

/** One entry of the index, or null when the rack can't show it. Only what the rack reads is kept. */
function parseListing(value: unknown): RackListing | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, title, players, stakes, hash } = value as Record<string, unknown>;
  // The fields a listing shares with a manifest are checked by the manifest's own rule.
  const shared = sharedManifestProblems({ id, title, blurb: "-", minutes: 1, stakes, taps: "identify" }, "USDC");
  if (shared.length > 0 || !isGameId(id) || !isPlayers(players) || typeof hash !== "string" || !HASH.test(hash)) return null;
  return { id, title: (title as string).slice(0, MANIFEST_LIMITS.title), players, stakes: stakes as readonly number[], hash: hash as RackListing["hash"] };
}

/** The good listings of `/index.json`, the first of any id that comes twice; null when it isn't an index at all. */
export function parseIndex(value: unknown): readonly RackListing[] | null {
  const listed = typeof value === "object" && value !== null ? (value as { listings?: unknown }).listings : null;
  if (!Array.isArray(listed)) return null;
  const byId = new Map<string, RackListing>();
  for (const entry of listed) {
    const listing = parseListing(entry);
    if (listing && !byId.has(listing.id)) byId.set(listing.id, listing);
  }
  return [...byId.values()];
}

export function createStoreIndex({ url, log, fetcher = fetch }: StoreIndexOptions): StoreIndex {
  let listings: readonly RackListing[] = [];
  let down = false;

  async function read(): Promise<readonly RackListing[]> {
    const response = await fetcher(new URL("/index.json", url), { signal: AbortSignal.timeout(STORE_INDEX_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`it answered ${response.status}`);
    const parsed = parseIndex(JSON.parse(new TextDecoder().decode(await readCapped(response, INDEX_BYTES))));
    if (!parsed) throw new Error("it isn't an index");
    return parsed;
  }

  return {
    listings: () => listings,
    async refresh() {
      try {
        listings = await read();
        if (down) log("store: the index is back");
        down = false;
      } catch (error) {
        listings = [];
        if (!down) log(`store: no index, so no store games: ${error instanceof Error ? error.message : String(error)}`);
        down = true;
      }
    },
  };
}
