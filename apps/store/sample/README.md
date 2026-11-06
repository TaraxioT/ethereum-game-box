# apps/store/sample

Sample games, one folder each. A folder holds exactly what goes in the bundle (`@egb/sdk/bundle`): `index.html`,
`manifest.json` and any assets the page uses by relative path, so a stray file such as a `README.md` makes the packer
refuse it.

## Tap Rush

`tap-rush/`: the first tap starts ten seconds, and the most taps takes the pot. Two to four players.

Its page uses the frame's one object, `window.egb`, which the Box adds to the frame:

| Member | What it does |
|---|---|
| `players` | One item per player, in seat order. Tap Rush draws a lane for each, named and coloured by the player's `boxSeat`, as on their station. |
| `onTap(fn)` | Calls `fn` with each tap. Tap Rush reads `seat` from it: a place in `players`. |
| `event(name, data)` | Adds a game event to the log. |
| `station(seat, text)` | Shows text on a seat's station. |
| `buzz(seat)` | Buzzes a seat's station. |
| `end()` | Closes the match. |

The page decides nothing. It shows the race, posts one `score` event and calls `end()`. The manifest's instructions
judge the Box's taps alone, by their touch times, and read how the match closed. A match whose frame was lost, or a race
closed before its ten seconds were up, ends in `cannot_judge` and each stake goes back. So a rigged page can't win the
pot: the most `end()` can do is call the match off.

The instructions are exact enough to work out by hand, and `packages/sdk/test/bundle/tap-rush.test.ts` does so. That
test holds them word for word, so a change to the text that decides the money has to be made there too.
