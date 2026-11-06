# Gamebox arcade dashboard

The public dashboard at [gameboxdashboard.mathew.workers.dev](https://gameboxdashboard.mathew.workers.dev/) uses the approved Tron-inspired bento interface. The app owns its HTML, CSS, original canvas art, animation controller, bundled GSAP runtime and self-hosted fonts. It has no installation step, external runtime requests or dependency on the prototype folder.

## Develop and validate

From `apps/dashboard`:

```sh
npm run dev       # http://127.0.0.1:4174
npm test
npm run build     # deployable dist/ output
npm run preview   # preview the built output
```

`DASHBOARD_PORT` changes the server port. The dev and preview server exposes only website files. Build output excludes source tests, scripts, deployment configuration and repository files.

## Experience

- Stock Duel is game 01, first in the game rack and search, and the initial leaderboard selection. Quick Draw is game 02 and includes a local reaction practice round.
- All 11 dashboard cards activate their main action when clicked. Their native primary buttons/links support keyboard use. Player links, game filters and other controls remain independent.
- Search supports Cmd/Ctrl+K and Enter. Games, players, boxes, rankings, results and the cup open related detail panels with Back, Escape and focus restoration.
- The filled Ethereum-in-box logo and explicit ETHEREUM GAME BOX label appear in the header and hero. Complete rounded cards have no central globe or circular cutouts.
- The Make a name card opens the local demo identity form. A valid name is stored in the browser; this does not claim an ENS name.
- Motion is on by default, with no toggle or saved off preference. The device reduced-motion setting settles transitions and keeps artwork static; returning to normal enables future animation. Canvas artwork animates on hover/focus and rests while hidden, offscreen or behind a modal.

All identities, results, cup timing and box availability are illustrative. The filters and counters share one fixed sample history. Refresh rerenders that sample; it does not fetch chain data. No wallet connects, no funds move, and console gameplay, contracts, relayer, public names app and firmware are unchanged.

## Cloudflare deployment

`wrangler.jsonc` preserves the existing Worker `gameboxdashboard` in the original Cloudflare account, serving `dist/` with Workers Static Assets. Its build command runs before deployment.

```sh
npx --yes wrangler@4.158.0 whoami
npx --yes wrangler@4.158.0 deploy --dry-run
npm run deploy
```

Use the authenticated Wrangler session or standard Cloudflare environment variables. Never commit credentials. This app's deployment is separate from the public names site and the Box software.

## Sources and checks

`index.html`, `theme.css`, `art.js`, `motion.js` and `app.js` are the website source. `assets/` contains the reusable brand SVG, vendored GSAP and three fonts with their license notices. `scripts/` owns the static build/server; `tests/` verifies the build asset graph and HTTP serving behavior.

The source is promoted from the user-approved `prototypes/tron-bento` design. Its prior source/event-handler checks covered all card actions, nested controls, dialog trigger focus, motion defaults and reduced-motion changes. No new local browser verification is claimed because automatic access to the original local-file preview was blocked. Deployment validation is recorded in the PR.
