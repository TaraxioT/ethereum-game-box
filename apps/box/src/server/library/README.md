# The library

The games the Box offers: the core's `LibraryPort` on the Pi.

- **Team games** come from `apps/box/src/games/<id>/game.json` (kind `team`), in the catalogue's rack order
  (`core/catalogue.ts`). A catalogue game with no folder (Bet on X, B17) stays sealed as the catalogue lists it.
- **Built games** come from `$EGB_DATA/games/<id>/`, oldest install first (by `forge.json`), so a new cartridge
  slides in at the end of the rack. A game the Forge's `installedProblems` rejects (a bad manifest, a missing bundle)
  is listed sealed, with its own title when game.json has one; so is one whose bundle didn't load in its rules child
  (`seal`, from the rules host), until its folder goes. A built game can't take a team game's id: it is left out.
  Each reason is logged once.
- A built game's `GameInfo.icon` is `/games/<id>/icon.svg?v=…`, versioned by the file's time (`server/games/`
  serves it).
- It answers at once with the catalogue: the server listens first and calls `rescan()` after, and again on the
  Forge's `onLibraryChange`. One scan runs at a time; asks during a scan fold into one more. Listeners hear only real
  changes to the list.

| Module | What it is | API |
|---|---|---|
| `library.ts` | The library above. | `createLibrary({ teamDir, gamesDir, log }): Library` (`LibraryPort` plus `rescan`, `scanned`, `entry(id)`, `rules(id)` for the rules host's `locate`, `seal(id, reason)`); `iconUrl` |

Tests: `library.test.ts` (the catalogue first, the team games' game.json against it, built games ordered and sealed,
seals, folded scans); `templates.test.ts` (the team games on the Forge's shelf: each built form passes the Forge's
whole build check as a fresh build starts).
