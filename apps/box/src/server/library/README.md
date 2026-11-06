# The library

The games the Box offers: the core's `LibraryPort` on the Pi.

- **Team games** come from `apps/box/src/games/<id>/game.json` (kind `team`), in the catalogue's rack order
  (`core/catalogue.ts`). A catalogue game with no folder (Bet on X, B17) stays sealed as the catalogue lists it.
- **Built games** come from `$EGB_DATA/games/<id>/`, oldest install first (by `forge.json`), so a new cartridge
  slides in at the end of the rack. A game the Forge's `installedProblems` rejects (a bad manifest, a missing bundle)
  is listed sealed, with its own title when game.json has one; so is one whose bundle didn't load in its rules child
  (`seal`, from the rules host), until its folder goes. A built game can't take a team game's id: it is left out.
  Each reason is logged once.
- **Store games** come from the store's index (`store-index.ts`), after everything else, with `kind` `store`, tier
  `judged`, no folder and no manifest until a match fetches the bundle, and the fallback icon (`/games/icon.svg`). The
  index is read at the start and every minute: while it can't be read they aren't in the list, and team and built games
  never notice. A listing that isn't good is left out on its own. One whose id a team or built game holds is left out
  and logged. One that needs more seats than the Box has is sealed.
- **A store game's bundle** is fetched by hash for each match (`bundles.ts`), into its own folder under
  `$EGB_DATA/store-bundles/`, and deleted when the match is over or the players leave. There is no cache, and the folder
  is emptied at the start for whatever a power cut left. It is checked in memory with `@egb/sdk/bundle`, and against the
  listing's hash and id, before anything is written. A failure seals the game before anything is staked: for as long as
  it stays listed when the zip is bad, and until the next scan when it never arrived, so a blip costs nothing lasting. A
  bundle's code never runs here. Node only moves its bytes, and only the kiosk's sandboxed frame runs it.
- A built game's `GameInfo.icon` is `/games/<id>/icon.svg?v=…`, versioned by the file's time (`server/games/`
  serves it).
- It answers at once with the catalogue: the server listens first and calls `rescan()` after, and again on the
  Forge's `onLibraryChange`. One scan runs at a time; asks during a scan fold into one more. Listeners hear only real
  changes to the list.

| Module | What it is | API |
|---|---|---|
| `library.ts` | The library above. | `createLibrary({ teamDir, gamesDir, log, store? }): Library` (`LibraryPort` plus `rescan`, `scanned`, `entry(id)`, `rules(id)` for the rules host's `locate`, `seal(id, reason, passing?)`); `iconUrl` |
| `store-index.ts` | The store's `/index.json`, read and checked. | `createStoreIndex({ url, log, fetcher? }): StoreIndex`, `parseIndex`, `STORE_INDEX_MS`, `RackListing` |
| `bundles.ts` | The core's `BundlePort`: a bundle fetched, checked and written for one match. | `createBundles({ url, dir, log, seal, fetcher? }): Bundles` (`fetch`, `drop`, `held(hash)` for the frame's routes, `clear`) |
| `fetch-capped.ts` | A response's body, read no further than a cap. | `readCapped(response, max)`, `TooBig` |

Tests: `library.test.ts` (the catalogue first, the team games' game.json against it, built games ordered and sealed,
seals, folded scans, store games after them and gone with their index, their seals); `store-index.test.ts` (good and bad
listings, an index that can't be read, one too big); `bundles.test.ts` (real bundles from the packer: the folder and its
files, dropped and fetched again, every bad zip sealing with nothing on disk, a zip past its limit, one that never
arrives, a drop mid-fetch, what a power cut leaves); `templates.test.ts` (the team games on the Forge's shelf: each built form passes the Forge's
whole build check as a fresh build starts).
