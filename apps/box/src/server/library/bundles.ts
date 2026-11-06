// Store games' bundles on the Box: the core's BundlePort. Each match fetches its zip by hash, checks it with the one
// reader, and only then writes its files to a temporary folder under $EGB_DATA for the kiosk's frame. There is no cache,
// and a dropped bundle's folder goes. One bundle at a time, like the matches.
//
// A bundle's code is untrusted and nothing here runs it: Node only moves its bytes. The hash pins the zip, the reader
// refuses every unsafe name, and the files are served to the sandboxed frame alone.
//
// A failed fetch seals the game before anything is staked. A zip that fails its checks stays sealed; one that never
// arrived is sealed only until the library's next scan.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { SEATS } from "@egb/sdk";
import { BUNDLE_LIMITS, BundleRefused, readBundle, type OpenedBundle } from "@egb/sdk/bundle";
import type { BundlePort, StoreBundle } from "../../core/ports.ts";
import { readCapped, TooBig } from "./fetch-capped.ts";

/** A download that takes longer than this has failed (a zip is at most 16 MB). */
export const DOWNLOAD_TIMEOUT_MS = 60_000;

export interface BundlesOptions {
  /** EGB_STORE_URL. */
  readonly url: string;
  /** Where the temporary folders go: emptied at the start. */
  readonly dir: string;
  readonly log: (text: string) => void;
  /** Seals a game whose fetch failed. `passing`: the zip never arrived, so a later scan may lift it. */
  readonly seal: (id: string, reason: string, passing: boolean) => void;
  readonly fetcher?: typeof fetch;
}

/** A bundle on disk: its temporary folder, and every file it lists, by its exact path. */
export interface HeldBundle {
  readonly dir: string;
  readonly files: ReadonlySet<string>;
}

export interface Bundles extends BundlePort {
  /** The bundle with this hash, once it is checked and written; null otherwise. The frame's routes serve from this. */
  held(hash: string): HeldBundle | null;
  /** Empties the temporary folder: a power cut leaves what `drop` never got to. */
  clear(): Promise<void>;
}

/** The one being fetched or held. */
interface Current {
  readonly hash: string;
  readonly folder: string;
  readonly stop: AbortController;
  /** Set once it is written. */
  held: HeldBundle | null;
}

/** Why a bundle that arrived can't be played here, or null. */
function problem(opened: OpenedBundle, game: string, hash: string): string | null {
  if (opened.hash !== hash) return "the zip isn't the one listed";
  if (opened.manifest.id !== game) return "the zip names another game";
  if (opened.manifest.players.min > SEATS.length) return `it needs ${opened.manifest.players.min} players, and this Box seats ${SEATS.length}`;
  return null;
}

export function createBundles(options: BundlesOptions): Bundles {
  const { url, dir, log, seal, fetcher = fetch } = options;
  let current: Current | null = null;
  let count = 0;

  function forget(): void {
    if (!current) return;
    const { folder, stop } = current;
    current = null;
    stop.abort();
    rm(folder, { recursive: true, force: true }).catch((error: unknown) => log(`store: ${folder} wasn't deleted: ${error instanceof Error ? error.message : String(error)}`));
  }

  async function download(hash: string, stop: AbortController): Promise<Uint8Array> {
    const response = await fetcher(new URL(`/bundles/${hash}.zip`, url), { signal: AbortSignal.any([stop.signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]) });
    if (!response.ok) throw new Error(`the store answered ${response.status}`);
    return readCapped(response, BUNDLE_LIMITS.zipBytes);
  }

  async function write(opened: OpenedBundle, folder: string): Promise<void> {
    for (const [name, body] of opened.files) {
      const file = path.join(folder, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
    }
  }

  return {
    async fetch(game, hash): Promise<StoreBundle> {
      forget();
      const mine: Current = { hash, folder: path.join(dir, `${hash.slice(2)}-${++count}`), stop: new AbortController(), held: null };
      current = mine;
      try {
        const opened = await readBundle(await download(hash, mine.stop));
        if (current !== mine) throw new Error("dropped");
        const wrong = problem(opened, game, hash);
        if (wrong) throw new BundleRefused(wrong);
        await write(opened, mine.folder);
        if (current !== mine) {
          await rm(mine.folder, { recursive: true, force: true });
          throw new Error("dropped");
        }
        mine.held = { dir: mine.folder, files: new Set(opened.files.keys()) };
        log(`store: ${game} fetched and checked`);
        const { minutes, taps } = opened.manifest;
        return { minutes, taps };
      } catch (error) {
        // A bundle dropped on the way is nobody's fault.
        if (current === mine) {
          const reason = error instanceof Error ? error.message : String(error);
          seal(game, `its bundle failed: ${reason}`, !(error instanceof BundleRefused || error instanceof TooBig));
          forget();
        }
        throw error;
      }
    },
    drop: forget,
    held: (hash) => (current?.hash === hash ? current.held : null),
    async clear() {
      const left = await readdir(dir).catch(() => []);
      await Promise.all(left.map((name) => rm(path.join(dir, name), { recursive: true, force: true })));
    },
  };
}
