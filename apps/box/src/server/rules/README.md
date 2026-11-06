# The rules runner

Built games' rules, each in its own sandboxed child process, one game at a time: the core's `RulesRunnerPort` on the
Pi (`core/ports.ts`). A game's rules are code nobody reviewed, so they never run in the server's process or on its
event loop.

## The child

`node --max-old-space-size=64 --disable-warning=ExperimentalWarning --permission --allow-fs-read=<dist/rules.js>
dist/rules.js` (`CHILD_FLAGS` and `rulesChildArgs`), with an empty environment and its bundle's folder as the cwd. It
speaks `@egb/sdk`'s runner protocol in JSON lines: `ready` once, then one reply per request, in order. The Forge's
rules check (`builder/bundle/rules-check.ts`) plays its test match through this same child, so a game is checked
exactly as it will run.

- **Node's permission model** refuses reads outside the bundle, every write, child processes, workers, addons, WASI,
  the inspector, sockets, DNS and `process.binding`.
- **The jail** (`builder/bundle/jail.ts`, bundled first into every rules.js) closes what Node 26.5 leaves open:
  `node:sqlite` (opens and writes database files past both fs checks), `v8.setHeapSnapshotNearHeapLimit` (writes a
  heap snapshot into the cwd), and `process.kill` / `process._kill` (signal any process of the same user, the Box
  included). No import resolves at run time and `process.getBuiltinModule` throws, so no Node module is reachable.
- **Node 26 or later.** The permission model's network refusals (sockets, `fetch`, DNS) came after Node 24, whose
  rules child could fetch from the Box's own port. `SANDBOX_NODE_MAJOR` is the major `sandbox.test.ts` proved; on an
  older Node the host runs no built game and seals each one asked for with the reason (the root `engines` asks for
  26 too).
- **Two memory caps.** The 64 MB heap makes a game that allocates objects without end crash itself. ArrayBuffers and
  typed arrays live outside that heap, so on Linux a guard (`memory.ts`) reads the child's resident memory from
  `/proc/<pid>/status` every 25 ms and SIGKILLs it past 256 MB: a gigabyte of typed arrays dies within one poll (on
  the Pi, at about 270 MB). Resident memory rather than RLIMIT_AS: V8 reserves about 900 MB of address space before
  it runs any code, a margin that moves with every Node release. macOS (development only) has the heap cap alone.
- **stdout** is the protocol's: a line that isn't a reply, or one over 256 KB, ends the child. **stderr** is kept,
  capped at 2 KB per child, and its tail goes into the log line when the child fails; never to the screen, never line
  by line to the journal.

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
  the game. So does a Node too old to sandbox it, before the child starts.
- A reply's station views come through as the game wrote them; the host cuts them to what a station shows
  (`fitStations`) before the core sees them.

## Modules

| Module | What it is | API |
|---|---|---|
| `host.ts` | The host above. | `createRulesHost({ locate, log, onUnloadable?, readyTimeoutMs?, stderrChars?, nodeVersion? }): RulesHost` (the core's `RulesRunnerPort`); `RulesError`, `RulesGame` |
| `child.ts` | One child: spawn with the sandbox flags and the memory guard, read reply lines, kill; the Node it needs. | `startRulesChild(rulesJs, { reply, fail, stderr })`, `rulesChildArgs`, `CHILD_FLAGS`, `MAX_LINE`, `SANDBOX_NODE_MAJOR`, `sandboxRefusal(version?)` |
| `memory.ts` | The resident-memory guard (Linux). | `guardMemory(pid, { over, capBytes?, everyMs?, read? })`, `readResident`, `residentBytes`, `canGuardMemory`, `MEMORY_CAP_BYTES` |
| `reply.ts` | A reply line checked against the protocol (an error's message cut to `MAX_MESSAGE`); views cut to what a station shows. | `parseReply(line)`, `fitStations(views)` |
| `capped-log.ts` | Text that keeps only its last characters. | `createCappedLog(max)` |
| `fixtures/hostile/` | A built game that tries every way out of the child (`attacks.ts`), for the sandbox test. | |
| `fixtures/raw-main.ts` | The attacks with no runner and no jail. | |

Tests: `host.test.ts` (order, budgets, the busy-loop reply, throws, crashes, protocol breaks, unloadable bundles, one
game at a time, a failing child's stderr in the log, no built game on an older Node) against hand-written children;
`memory.test.ts` (VmRSS read, the cap called once, reads never stacked); `sandbox.test.ts` as above, plus, on Linux,
a gigabyte of typed arrays killed at the memory cap.
