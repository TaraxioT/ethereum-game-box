# The test page

`/test` on the Box server: four tabs to check the Box on the Pi, in the screen's palette and type but plain and dense.
Plain DOM and TypeScript, built with the box build (`pnpm build:box` writes it to `dist/screen/test/`) and served by
the server like the screen (CSP, the launcher token on a top-level navigation). It polls `GET /api/taps` and
`GET /api/box` twice a second; every button posts to a route that needs this machine's origin. The routes are listed
in `src/server/README.md`.

| Tab | What it shows and does |
|---|---|
| Stations | The receiver (open, its path, the taps touched, done, failed and running); per station its link, RSSI, ping, reader, the chip on it and the screen it shows, with Buzz ok / no; the press round trip; the bench (samples, Run, median, p95, max per measurement). |
| Badges | Identify and Roll the badge resting on each station (the verified number); injected taps per seat with a badge picker from the roster or an address; the roster; with `EGB_RECEIVER=fake`, the simulated badges to place on P1 or P2 and lift, the stations' links, and the receiver's cable. |
| Box | The phase, the power switch (off: the Box misses its settle, so the match goes to Refund), Reset to Home, the badges' records, the whole state. |
| Builder | The slot the game builder fills: until it mounts, it says so and lists nothing. |

| Module | What it is |
|---|---|
| `index.html`, `main.ts` | The page, the tabs (the open one in the URL's hash) and the poll. |
| `wire.ts` | What the page reads from each route; the server's replies satisfy these types, so the two can't drift. No DOM, no Node. |
| `dom.ts` | `h`, `button`, `rows`, `get`, `post`, `show`. |
| `stations.ts`, `badges.ts`, `box.ts`, `builder.ts` | One tab each. |
| `test-page.css` | Its styles, on `screen/tokens.css`. |
