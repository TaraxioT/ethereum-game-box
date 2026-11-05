# The rules runner

Built games' rules, each in its own sandboxed child process, one game at a time: the core's `RulesRunnerPort` on the
Pi (`core/ports.ts`). A game's rules are code nobody reviewed, so they never run in the server's process or on its
event loop.

## The child

`node --max-old-space-size=64 --disable-warning=ExperimentalWarning --permission --allow-fs-read=<dist/rules.js>
dist/rules.js` (the Forge's `rulesChildArgs`), with an empty environment and its bundle's folder as the cwd. It speaks
`@egb/sdk`'s runner protocol in JSON lines: `ready` once, then one reply per request, in order.

- **Node's permission model** refuses reads outside the bundle, every write, child processes, workers, addons, WASI,
  the inspector, sockets, DNS and `process.binding`.
- **The jail** (`builder/bundle/jail.ts`, bundled first into every rules.js) closes what Node 26.5 leaves open:
  `node:sqlite` (opens and writes database files past both fs checks), `v8.setHeapSnapshotNearHeapLimit` (writes a
  heap snapshot into the cwd), and `process.kill` / `process._kill` (signal any process of the same user, the Box
  included). No import resolves at run time and `process.getBuiltinModule` throws, so no Node module is reachable.
- **The heap cap** makes a game that allocates without end crash itself instead of starving the kiosk.
- **stdout** is the protocol's: a line that isn't a reply, or one over 256 KB, ends the child. **stderr** goes to a
  capped log (`stderr()`, for the test page), never to the screen or line by line to the journal.

`sandbox.test.ts` proves each refusal on the Node that runs it, twice: the permission model alone (the attacks
bundled without runner or jail, run with the child's flags), and the real path (a hostile game bundled by the Forge
and played by the host, every attack refused, nothing on disk or on a socket, and a good game played afterwards).

## The host

- `prepare(game)` starts the child at Join, so the first step pays no start-up cost. Another game's child is killed
  first; the same game's live child is kept (a rematch reuses it).
- Requests go one at a time: a request is written only when the one before it has answered.
- A step's budget is the manifest's `budgetMs`, measured here in wall time from the write to the reply. When the timer
  fires the verdict waits one turn of the event loop, so a reply already in the pipe while the server was busy counts.
- Any failure (`budget`, `threw`, `crash`, `protocol`, `stopped`, `unavailable`) is a `RulesError` that rejects the
  call and everything queued behind it and kills the child; the core voids the match and refunds both stakes. Nothing
  restarts by itself: the next `prepare` or `start` does.
- A child that dies or errors before `ready` couldn't load its bundle: `onUnloadable` tells the library, which seals
  the game.

## Modules

| Module | What it is | API |
|---|---|---|
| `host.ts` | The host above. | `createRulesHost({ locate, log, onUnloadable?, readyTimeoutMs?, stderrChars? }): RulesHost` (`RulesRunnerPort` plus `running()`, `stderr()`); `RulesError`, `RulesGame` |
| `child.ts` | One child: spawn with the sandbox flags, read reply lines, kill. | `startRulesChild(rulesJs, { reply, fail, stderr })`, `CHILD_FLAGS`, `MAX_LINE` |
| `reply.ts` | A reply line checked against the protocol; station views cut to what a station shows. | `parseReply(line)` |
| `capped-log.ts` | Text that keeps only its last characters. | `createCappedLog(max)` |
| `fixtures/hostile/` | A built game that tries every way out of the child (`attacks.ts`), for the sandbox test. | |
| `fixtures/raw-main.ts` | The attacks with no runner and no jail. | |

Tests: `host.test.ts` (order, budgets, the busy-loop reply, throws, crashes, protocol breaks, unloadable bundles, one
game at a time, stderr) against hand-written children; `sandbox.test.ts` as above.
