# apps/store

`@egb/store`: the game store, a Cloudflare Worker named `gamebox-store` with its zips in the R2 bucket
`gamebox-bundles`, on the relayer's Cloudflare account. It serves the index and the zips to anyone, and takes uploads
from the team. A bundle's format is `@egb/sdk/bundle`, and the plan is section 7 and step 3 of
[`plan/game-store.md`](../../plan/game-store.md).

## Routes

| Route | Takes | Answers |
|---|---|---|
| `GET /index.json` | | `{ listings }`, every `StoreListing` by id: `id`, `title`, `blurb`, `players`, `stakes`, `icon`, `hash` and `size`. `icon` is always null for now: a cartridge uses the fallback icon |
| `GET /bundles/<hash>.zip` | | The zip, with `cache-control: public, max-age=31536000, immutable` |
| `POST /bundles` | The zip's bytes, with `Authorization: Bearer <STORE_PUBLISH_TOKEN>` | The listing: `201` if this upload finished it, `200` if it was already there |

A hash is the zip's sha256 as lower-case `0x` hex, and anything else in that path is a `404`. Reads are open to any
origin, and `HEAD` answers as `GET` does, with the length and no body. An upload has no CORS, since nothing uploads from
a browser. Nothing else is routed, so no request can change or remove what is stored.

An error is `{ error }`, with one of these statuses:

| Status | When |
|---|---|
| `400` | The reader refused the zip, saying why |
| `401` | The token is missing or wrong |
| `404` | No such route, or no such zip |
| `409` | The id is held by another hash. A new version needs a new id, such as `tap-rush-2` |
| `413` | The zip is over 16 MB, by its stated length or by counting |
| `500` | R2 failed. The same upload can be repeated |
| `503` | `STORE_PUBLISH_TOKEN` isn't set, so uploads are off |

## What goes here

| Path | Holds |
|---|---|
| `src/index.ts` | The Worker |
| `src/routes.ts` | The routes, the reads and the last catch |
| `src/upload.ts` | `POST /bundles`, its checks in order |
| `src/token.ts` | The publish token's constant-time check |
| `src/body.ts` | Reading a body up to a limit |
| `src/shelf.ts` | The bucket's layout, and the only code that writes to it |
| `src/catalog.ts` | `/index.json`, built from the listings and kept briefly |
| `scripts/` | `pnpm store:publish`: `publish.ts` starts it, `publisher.ts` is what it does, `folder.ts` reads the folder, `list.ts` is the chain |
| `sample/` | Sample games, with their own README |
| `test/` | The Worker against an in-memory R2 (`memory-r2.ts`) |
| `test/cli/` | `store:publish` against a fake store and a fake node |
| `test/live/` | The real Worker on `wrangler dev --local` |

## Rules

- **Nothing is overwritten.** The bucket holds `ids/<id>` (the hash that holds an id), `bundles/<hash>.zip` and
  `listings/<hash>.json`. Every put carries `If-None-Match: *`, so R2 itself refuses to replace anything.
- **`ids/<id>` settles races.** Two uploads of one id have different hashes, so their zip and listing keys differ and
  both could be written. The claim is the one key both must write, and R2 lets only one of them.
- **An upload is written in order:** the claim, the zip, then the listing, so no listing points at nothing. An upload
  that died part way is finished by the same upload again. It keeps its id: if it is never finished, the claim needs
  deleting by hand before another hash can have that id.
- **The size is checked before the body is read.** `Content-Length` is only a claim and a chunked body has none, so the
  bytes are counted too, and reading stops at 16 MB.
- **The hash comes from the bytes that arrived,** and from nothing the client says.
- **The token** is compared by its sha256 with `crypto.subtle.timingSafeEqual`. With no secret set, uploads are off.
- **The index is kept for 30 seconds** in each isolate, and for as long by whoever reads it. The Cache API works only
  on custom domains and the store is on workers.dev. When it runs out, one request rebuilds it and the others get the
  old text meanwhile, for 5 seconds at most if that request never comes back. A request with no text to serve, in a new
  isolate or just after an upload, builds its own, since a Worker can't await another request's I/O.
- **A publish is in the index at once** in the isolate that took it, even if a build was under way, and in the others
  soon after 30 seconds.

An upload's work is the reader's. A bundle's files are stored, so a read is one pass over the zip: its cost follows the
zip's size, and nothing in it can make that worse. Measured under `wrangler dev` on a Mac, against a CPU limit of 30 s,
the full 16 MB of the text that was slowest when files were deflated uploads in 0.3 s, where it took 37 s. A bomb is
refused at its header: a 1 MB zip of 1 GiB took 0.01 s and 4 MB of memory.

Memory at the limit is unproven. A 16 MB upload grew workerd's resident memory by 70 MB to read it, and by 101 MB with
local R2 writing it in the same process. That isn't how Cloudflare measures an isolate, and `wrangler dev` doesn't
enforce a Worker's 128 MB.

## Publish

`pnpm store:publish <folder>` packs the folder, uploads it, prints the hash, and lists it on `StorePot`, whose `list`
is what lets a Box stake on it. It is safe to repeat. It reads `.env`:

| Name | What it is |
|---|---|
| `EGB_STORE_URL` | The store |
| `STORE_PUBLISH_TOKEN` | The token |
| `STORE_LISTER_KEY` | Optional: a key holding `LISTER_ROLE` |
| `SEPOLIA_RPC_URL` | Optional: the node that key sends through |

With `StorePot` in `deployments/sepolia.json`, a key and a node, it sends `list(hash)`, unless the hash is already
listed. Otherwise it prints the `cast send` that does so from the `sepolia-deployer` keystore. The deployer shares its
nonce with the relayer, so list while the relayer is quiet.

## Run

```sh
pnpm --filter @egb/store test                   # the Worker and store:publish, no network
pnpm --filter @egb/store test:live              # the real Worker, local only, on a made-up token
cp apps/store/.dev.vars.example apps/store/.dev.vars && pnpm --filter @egb/store dev
```

`test:live` needs `wrangler` on the path. `wrangler.jsonc`'s compatibility date is the newest the runtime in wrangler
4.111 can run, so what it tests is what deploys.

`test:live` publishes Tap Rush with the real script and downloads it back by hash. On the real runtime, it shows every
put's condition is honoured: without it, four of its tests fail. It can't show a true race, because the local isolate
runs parallel uploads almost one after the other, and a claim that checked and then wrote still passes it. A race is
forced in `test/overwrite.test.ts`, which holds both uploads until each has passed every check, and that bug fails
there. Neither touches production R2, so its promise of an atomic conditional put is taken on trust.

`test:live` also covers what only the real runtime shows: what a `HEAD` sends, a bomb, and the slowest text at the
limit.

Deploy, then set the secret. A Worker secret can't be read back and `pnpm store:publish` needs the same value, so it
goes in `.env` too. The last line of a name in `.env` wins, so a blank one left from `.env.example` does no harm.

```sh
cd apps/store
wrangler r2 bucket create gamebox-bundles
wrangler deploy
token=$(openssl rand -hex 32)
echo "STORE_PUBLISH_TOKEN=$token" >> ../../.env
printf %s "$token" | wrangler secret put STORE_PUBLISH_TOKEN
```
