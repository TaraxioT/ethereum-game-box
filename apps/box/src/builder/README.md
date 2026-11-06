# The game builder

Build a new game on the Box: the Designer asks one question at a time and settles a `GameBrief`; the Forge builds
the game from it. Shared types are in `types.ts` (with `isFinished(status)`: a build that has ended, which the server,
the Forge and the test page all ask).

## Routes and screens

The Box server mounts the builder (`server/builder-host.ts`): one Forge and one Designer on a shared edit lock, a
confirmed design built at once on `EGB_FORGE_PROVIDER` (`claude`, or `sim`, shown SIMULATED), and their routes under
`/api/builder` behind the launcher token, with one Server-Sent Events stream carrying every `DesignerState` change and
every `ForgeEvent` (a late screen gets the running build's replay first). The routes are in `server/README.md`; their
wire types in `server/builder-wire.ts`. On the screen, Home's NEW GAME cartridge opens the Box's `build` phase: the
Designer and the Build screen (`screen/README.md`), and the voice client (`screen/voice/`).

## Designer

`designer/`: one question at a time, ending in a `GameBrief`. The steps are template, mechanic, theme, twist, stakes,
voice, title, confirm; a settled step is skipped (a template that fixes the mechanic, a shelf of one template, or one
answer that settles several steps). Every step has brass keys (`DesignerChoice`); typed or spoken words work on every
step too, read by the model client with a 5 s deadline and a keyword fallback. The server mounts the service behind
the launcher token; it holds one session at a time.

```ts
const designer = createDesigner({ shelf, lock, model: createModelClient(env), voice: createVoice(env, { dir }) });
designer.onConfirm((brief) => forge.start(brief)); // the Forge takes `lock` here, before returning
designer.onChange((state) => socket.send(state));  // DesignerState, on every change
```

| Call | Does |
|---|---|
| `start(): DesignerState` | A new session (replacing any other), at its first open question. |
| `state(): DesignerState \| null` | The active session. |
| `choose(choiceId, session?): DesignerState` | Answers with a key. On confirm, `build` confirms. |
| `answer(text, session?): Promise<DesignerState>` | Answers with words. Settles in at most 5 s. |
| `back(session?): DesignerState` | Reopens the last step the player settled before this one (its value stays). |
| `confirm(session?): GameBrief` | The brief, also handed to every `onConfirm` listener. |
| `transcribe(audio, mime, session?)` | Hears a recorded answer and reads it: `{ text, state }`, `text` null if nothing was heard. |
| `speak(session?): Promise<SpokenLine>` | The current question spoken: `{ text, clip }`, `clip` a file name or null (caption only). |
| `clipPath(file)` | The file behind a clip name, or null: the clip route serves only these. |
| `mockTurns()` | Mock voice: the rest of the session as `{ say, hear }` turns. Empty otherwise. |
| `status()` | `{ model: { provider, reason }, voice: VoiceStatus }`. |
| `onChange(fn)`, `onConfirm(fn)` | Subscriptions; each returns its unsubscribe. |
| `stop()` | Lets go of the lock's listener and any model call in flight. |

`session` is optional on every edit: a screen that sends it gets `stale` instead of editing a newer session. Refusals
are `DesignerError`s with `code` and `status`: `no-session` 404, `stale` 409, `locked` 409, `bad-choice` 400, `empty`
400, `not-ready` 409.

**The edit lock.** The Forge holds `EditLock` while a build runs; every edit (and `start`) is refused with `locked`,
the state streams `locked: true`, and a model reply that lands meanwhile is dropped.

**A late model reply** applies to the brief as it is when it lands, never to the brief it was asked about. The
session counts edits: a generation number, and the generation each field was last edited at. A reply sets only the
fields nobody touched since the question (a key tapped meanwhile wins), reopens a step only if it wasn't edited
since, and its "yes, build it" counts only if nothing changed at all. A newer answer supersedes one still being read.

| Module | Job |
|---|---|
| `service.ts` | The service above: the session, the lock, the generations, the voice calls. |
| `steps.ts` | The step graph, pure: the current step, questions, keys, the read-back, patches, reopening a step. |
| `options.ts` | The fixed keys (ways to score, places, twists, stake sets in USDC, voices) and the words that name them. |
| `keywords.ts` | The keyword reader: words to brief fields with no model (numbers, stake sets, "call it …", "yes", "change the …"). |
| `reader.ts` | Reads an answer: the model within 5 s, else keywords; the model's reading wins only when it adds something. |
| `script.ts` | `mockTurns`: the Designer's lines and a player's spoken answers for every open step, checked against the keyword reader. |
| `shelf.ts` | The shelf port (`{ id, label, default, mechanic? }`, discovered by the Forge from `forge.template`) and its default. |
| `lock.ts` | `EditLock`: held by the Forge while a build runs. |
| `errors.ts` | `DesignerError`, with its HTTP status. |
| `test-helpers.ts` | The tests' shelf and a model whose replies the test controls. |

## Model client

`llm/`: one small structured call that must come back fast. `claude-haiku-5-5`, through the Anthropic API when
`ANTHROPIC_API_KEY` is set (one HTTPS request, the quickest path), else through the Claude Agent SDK on the Pi's
Claude Code login (`~/.claude/.credentials.json`; on a Mac, the keychain). `EGB_MODEL=off` turns it off: keywords read
every answer. The SDK is imported on the first call, not at boot.

Every failure is a rejection, never a guess: no login, an error result, a reply that fails validation, or the
deadline. The client rejects at the deadline even if the backend ignores its abort, so a caller never waits longer,
and the Claude Code child is closed. One child runs at a time (each is a few hundred MB on the Pi). The child gets an
allowlisted environment: the Box's secrets (relayer key, RPC and ElevenLabs keys) never reach it. Errors carry an HTTP
status or an SDK result type, never a key or a prompt.

| Module | Job |
|---|---|
| `model.ts` | `createModelClient(env)`: picks the path; `json({ system, prompt, schema, parse, timeoutMs, signal })` with the deadline, the caller's abort and validation. |
| `sdk.ts` | The Agent SDK path: one turn, no tools or settings, no session on disk, no thinking, structured output, one child at a time. |
| `api.ts` | The Messages API path: the answer forced through one tool whose input schema is the answer's. |
| `claude-env.ts` | Whether Claude has credentials here, and the Claude Code child's allowlisted environment (the Forge uses it too). |
| `designer.ts` | The Designer's call: its prompt, its schema (every field, nullable, template ids from the shelf), and the reply's validation. |

## Voice

`voice/`: a port. `mock` by default: no network, it hears scripted lines and speaks captions. ElevenLabs only with
`EGB_VOICE=elevenlabs` **and** `ELEVENLABS_API_KEY` (asking without the key stays on mock and says why): Scribe
speech-to-text for the player's answer, Flash v2.5 text-to-speech for the Designer's question, into a
content-addressed clip cache in `$EGB_DATA/voice` (a repeated question costs nothing). The Designer works fully by
touch.

**The budget guard.** The free tier's 10,000 credits a month are shared, so the Box keeps its own monthly caps on disk:
`EGB_VOICE_TTS_MAX_CHARS` (default 6,000 characters) and `EGB_VOICE_STT_MAX_MIN` (default 40 minutes). Each call
reserves its cost before it starts and is refused when it wouldn't fit (calls in flight count), and spends only once
ElevenLabs answered; a refused call costs nothing. Past a cap the screen shows captions and the player taps keys. The
totals and the clips are written atomically (`server/files.ts`); a totals file that is there but can't be read counts
as the whole cap spent until the month turns, so a damaged file never starts the spending over from zero.
`EGB_VOICE_ID` changes the Designer's voice (default Charlie, a stock voice).

| Module | Job |
|---|---|
| `port.ts` | `VoicePort` (`mock` or `elevenlabs`): `transcribe`, `speak`, `clipPath`, `status`. |
| `select.ts` | `createVoice(env, { dir })`: picks the port from the env. |
| `mock.ts` | The scripted voice: hears queued lines in order, speaks captions. |
| `elevenlabs.ts` | Speech-to-text and text-to-speech, behind the budgets; logs only HTTP statuses. |
| `budget.ts` | The monthly caps: reserve, release, spend (saved atomically, in order), persisted per UTC month; an unreadable total counts as spent. |

## Forge

`forge/`: turns a confirmed `GameBrief` into an installed game. It runs on the Pi with the Pi's Claude login. The
parent is a small service the server mounts; each build runs in its own child process, so the agent, the type checker
and the bundler never share the server's event loop or the tap path. One build at a time; the rest queue.

```ts
const forge = createForge({ dataDir, gameRoots: [gamesDir], env: process.env, lock, onLibraryChange: () => library.rescan() });
designer.onConfirm((brief) => forge.submit(brief, "claude")); // takes the Designer's lock until the build ends
forge.subscribe((event) => socket.send(event), { replay: jobId }); // a late screen gets the build so far first
```

| Call | Does |
|---|---|
| `submit(brief, provider): ForgeJob` | Queues a build (`claude` or `sim`). Throws `ForgeRequestError` for a brief the shelf can't build. |
| `list()`, `get(id)` | Jobs, newest first (the last 50 finished, kept in `$EGB_DATA/forge/jobs/` across restarts). |
| `events(id)`, `subscribe(fn, { replay? })` | A job's `ForgeEvent`s so far; every event from now on (with `replay`, that job's first). |
| `cancel(id)` | Stops a queued or running build; false once it is installing. |
| `remove(game)` | Deletes an installed built game; refuses anything whose game.json doesn't say `built`. |
| `shelf()`, `ready(provider)` | The templates; whether a provider can build here (`claude` needs a login). |
| `stop()` | Cancels the running build (10 s cap) and saves every record. |

**A build** (`job.ts`, in the child: `node apps/box/src/builder/forge/child.ts`, forked with an IPC channel, in its own
process group with the allowlisted environment): copy the template's built form into `$EGB_DATA/forge/work/<job>/`
with a read-only `.reference/` (the SDK's sources, the template as it started, the parts by tag), render the brief into
the agent's task, run the agent, check the game, give a failed check one resumed fix-up turn and a bad icon one more
turn (then a plain icon), and install. Statuses: `queued`, `preparing`, `working`, `compiling`, `fixing`,
`installing`, `done` or `failed`; a job's last event is its `result`. A cancel or the time limit stops it until the
install begins. Limits: 40 turns, 8 minutes (`FORGE_TIMEOUT_MS`), `claude-sonnet-5-5` (`FORGE_MODEL`), 40 files of at
most 128 KB, bundles of 256 KB (rules) and 768 KB (screen), a 12 KB icon. Every text an event carries is cut to 4,000
characters before the Forge keeps, saves or streams it (a compile event quotes the game's own error messages), and a
job's record is written atomically.

**The agent** (`claude.ts`): the Claude Agent SDK, imported when a build starts. Tools Read, Write, Edit, Glob and
Grep, and one MCP tool, `build_game`, deliberately not in `allowedTools` so every call passes the permission check;
`settingSources: []`, `permissionMode: "default"`; `canUseTool` and a `PreToolUse` hook both call `checkToolUse`. Its
environment is `llm/claude-env.ts`'s allowlist: no other key the Box holds reaches it.

**Confinement** (`confine.ts`): symlinks are resolved (the real path of the nearest existing parent); reads only
inside the folder and outside `dist/` and `node_modules/`; no writes to `.reference/`, `dist/`, `node_modules/` or
`.claude/`; no `..`, `~` or outside paths in globs; every other tool is denied.

**Templates.** The shelf is every game under the given roots whose game.json has `forge.template`. A template whose
own rules.ts and screen.ts aren't a built game's (a team game: core rules, a kiosk screen) carries its built form in
`built/`: rules.ts default-exporting `BuiltRules`, screen.ts default-exporting `GameScreen`, and what they import,
importing only each other and `@egb/sdk`. A build starts from `built/` plus the template's game.json, icon.svg and
BLUEPRINT.md; a folder without `built/` is its own built form (the test fixture `fixtures/tap-three/` is one).

**An installed game**, `$EGB_DATA/games/<id>/`, renamed into place in one step:

```
game.json        the manifest: kind "built", tier "refereed", the brief's title and stakes
rules.ts …       the game's sources as the agent left them; screen.ts; any files they import
icon.svg         checked, or the Box's plain one
BLUEPRINT.md     how it plays
forge.json       how it was built: job, provider, simulated, model, template, brief, turns, cost, builtAt
dist/rules.js    the rules child's whole program: node --permission --allow-fs-read=<dist/rules.js> dist/rules.js
dist/screen.js   the frame's screen: an ES module whose default export is the GameScreen
```

`installedProblems(dir)` says why one can't be offered (the library shows it sealed); a bundle that fails to load in
its rules child seals it too.

**Providers.** `claude` is live. `sim` replays `sim/run.jsonl`, a recorded run at its recorded pace, through the same
event mapper; its tool calls really happen (confined writes, the real `build_game`), so a sim build installs a real,
playable game (Lantern Race). Its status says `SIMULATED`, and it is never a fallback.

**Built games are refereed.** The task, the guide and the manifest check all hold the game's words to that: nothing
may call it verified, provable or proven.

| Module | Job |
|---|---|
| `service.ts` | `createForge`: the queue, job records (written atomically), events (their text capped) and replays, cancel, remove; `forkLauncher` runs `child.ts`. |
| `child.ts` | The build's process: takes `{ t: "run", spec }` and `{ t: "cancel" }`, sends `{ t: "event", event }`. |
| `job.ts` | `runJob`: one build, from the folder to the install, as ForgeEvents. |
| `shelf.ts` | `readShelf(roots)`: the templates, the default first; where each one's built form is. |
| `brief.ts` | `briefProblem` (the brief is untrusted), `briefToTask` (the agent's first turn), the fix-up and icon prompts. |
| `slug.ts` | Game ids: the design's words and a four-letter suffix, at most 40 characters. |
| `workspace.ts` | The work folder and `.reference/`; game.json's checks and its final form. |
| `build.ts` | `build_game`: game.json, then the type check and the bundle (with a test match) in parallel, then the icon; `formatBuild`. |
| `claude.ts` | The live provider: `agentOptions`, the `build_game` MCP server, API errors in words. |
| `sim.ts` | The replay provider and its recording's loader. |
| `confine.ts` | `checkToolUse`: the one confinement check. |
| `events.ts` | SDK messages to `say`, `tool` and `tool_done` events; result errors in words. |
| `icon.ts` | The icon check and the plain fallback icon. |
| `install.ts` | The data folders, the install, `installedProblems`, `removeGame`. |
| `provider.ts` | The provider interface. |
| `limits.ts` | Turns, time, events and their text, files and sizes. |
| `smoke.ts` | One whole build from the command line: `node apps/box/src/builder/forge/smoke.ts [--provider claude] [--fixture] [--fast]`. |
| `authoring.md` | The agent's guide, appended to its system prompt (read fresh for every build). |
| `reference/parts.md` | The Box's parts a built screen may use by tag. |
| `sim/run.jsonl` | The sim's recorded run. |
| `fixtures/` | The test template `tap-three` and a recorded error run. |
| `test-helpers.ts` | Temp folders, briefs, a scripted provider, an in-process launcher, a rules.js played in the rules host's own child (`playRules`). |

## Bundler

`bundle/`: turns a built game's folder into its two bundles and checks it, for `build_game`. Both bundles are single
files with nothing left to import.

- `rules.js`: Node, ES module. Its entry is the runner program (`runner-main.ts`) and then the game's `rules.ts`, so the
  runner takes stdout before any game code runs (what a game prints goes to stderr) and the child's whole program is
  that one file.
- `screen.js`: browser, ES module (minified); its default export is the `GameScreen`.

**The guard** (`guard.ts`, an esbuild plugin) sees every import: a game may import only its own files (relative paths
that really land inside its folder) and `@egb/sdk` / `@egb/sdk/screen`. It refuses import attributes, Node modules,
packages, other SDK paths, and any file but `.ts`, `.js` and `.json` (no CSS, no assets, no extensionless files).
`tsconfigRaw` is fixed, so no tsconfig on disk steers the build.

| Module | Job |
|---|---|
| `bundle.ts` | `bundleGame(gameDir, outDir, sdk)`: both bundles into a staging folder, swapped in only when both built and fit. |
| `guard.ts` | The esbuild plugin above. |
| `typecheck.ts` | `typecheckGame`: the repo's TypeScript with a Box-written tsconfig mapping `@egb/sdk` to its sources, and a contract file checking the two default exports. Confined: see below. |
| `rules-check.ts` | `checkRulesBundle`: plays a short match against rules.js in the rules host's own child (`server/rules/child.ts`: the same flags, memory caps, line cap and reply check); `stationProblems`. |
| `runner-loop.ts` | The runner protocol's loop, pure: one request line in, one reply out. |
| `runner-main.ts` | The rules child's program: takes stdout, reads stdin, sends `ready`, exits when stdin closes. Bundled into rules.js, never imported. |
| `jail.ts` | Bundled first of all: closes what Node's permission model leaves open (`node:sqlite`, `v8` heap snapshots, `process.kill`): no import resolves at run time and `process.getBuiltinModule` throws. Proven in `server/rules/sandbox.test.ts`. |
| `paths.ts` | Where the SDK's sources and TypeScript's lib files are; the bundles' file names. |

**The type checker is confined** to what a game may read. TypeScript 7's compiler is a native binary, which Node's
permission model can't hold, so `typecheck.ts` runs it behind its API (`typescript/unstable/async`) with every
file-system call it makes (read, exists, list, realpath) answered by `confinedFileSystem`: the game's folder, the SDK's
sources, TypeScript's lib files and the temp folder holding the tsconfig, by real path, and nothing else. Outside them
nothing exists, so an absolute import naming a file elsewhere (a JSON of keys, say), a type query or a symlink out of the
folder is "cannot find module", and nothing in that file shows in an error. `bundle.test.ts` proves it.
