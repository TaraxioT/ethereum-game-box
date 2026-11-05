// The Box server, put together: the core on Node's ports, the taps library on the receiver's port (the core's
// stations), the session log, the HTTP routes and the built screen and test page, and the screen's WebSocket link,
// on one port. main.ts reads the settings and starts it; tests start it on a free port with a fake clock.
import http from "node:http";
import { randomInt } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SEATS } from "@egb/sdk";
import type { Clock } from "../core/ports.ts";
import { createCore, type Core } from "../core/core.ts";
import { systemClock } from "../core/system-clock.ts";
import type { FakeOptions } from "../taps/fake/fake-receiver.ts";
import { badgeOf } from "../taps/roster.ts";
import { createTaps, type Taps } from "../taps/taps.ts";
import type { Settings } from "./settings.ts";
import { apiRoutes } from "./api.ts";
import { builderRoutes } from "./builder-api.ts";
import { forgeProvider, startBuilder, type Builder, type BuilderOptions } from "./builder-host.ts";
import { createLedgerFile } from "./ledger-file.ts";
import { attachLink } from "./link.ts";
import { readCommit } from "./release.ts";
import { createHandler } from "./routes.ts";
import { createLauncherToken } from "./security.ts";
import { createSessionLog } from "./sessions.ts";
import { createFrameAssets } from "./games/assets.ts";
import { createGameRoutes } from "./games/routes.ts";
import { createLibrary, type Library } from "./library/library.ts";
import { createRulesHost, type RulesHost } from "./rules/host.ts";
import { tapsRoutes } from "./taps-api.ts";

export interface BoxOptions {
  readonly settings: Settings;
  readonly repoRoot: string;
  /** The clock of the core and the taps (tests: a fake one; HTTP and the link stay on real time). */
  readonly clock?: Clock;
  /** The fake receiver's timing, with EGB_RECEIVER=fake (tests: `timeScale: 0`). */
  readonly fake?: FakeOptions;
  readonly log?: (text: string) => void;
  /** The game builder's settings: its environment (default: process.env), its shelf's folders, the sim's pace. */
  readonly builder?: Partial<Pick<BuilderOptions, "env" | "gameRoots" | "simSpeed">>;
}

/** The team games: the Forge's templates. */
const GAMES_DIR = fileURLToPath(new URL("../games", import.meta.url));

export interface Box {
  /** Where the screen is served. */
  readonly url: string;
  readonly port: number;
  readonly core: Core;
  /** The games: the team games and the installed built games. */
  readonly library: Library;
  /** Built games' rules, each in its sandboxed child. */
  readonly rules: RulesHost;
  /** The taps library, once it has started (after the server listens); null with EGB_RECEIVER=none. */
  taps(): Taps | null;
  /** The game builder, once it has started (after the server listens). */
  builder(): Builder | null;
  /** This boot's launcher token. */
  readonly token: string;
  /** Stops the link, the core, the taps and the server, and waits for the ledger and the log to reach the disk. */
  stop(): Promise<void>;
}

function urlHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host.includes(":") ? `[${host}]` : host;
}

export async function startBox(options: BoxOptions): Promise<Box> {
  const { settings } = options;
  const log = options.log ?? ((text: string) => console.log(text));
  const clock = options.clock ?? systemClock();
  const started = performance.now();
  const builderEnv = options.builder?.env ?? process.env;
  // A bad EGB_FORGE_PROVIDER stops the start before anything listens.
  forgeProvider(builderEnv);
  await mkdir(settings.dataDir, { recursive: true });
  const ledger = createLedgerFile(join(settings.dataDir, "ledger.json"), log);
  const sessions = createSessionLog(settings.dataDir, log);
  // The library answers with the catalogue until its first scan, which runs after the listen.
  const library = createLibrary({ teamDir: GAMES_DIR, gamesDir: join(settings.dataDir, "games"), log });
  const rules = createRulesHost({
    locate: (id) => library.rules(id),
    log,
    // A bundle that doesn't load in its child seals its cartridge.
    onUnloadable: (id, reason) => library.seal(id, reason),
  });
  let taps: Taps | null = null;
  const core = createCore({
    clock,
    // The taps library is the stations port once it has started; the core's views before then are sent on start.
    stations: {
      show: (seat, view) => taps?.show(seat, view),
      buzz: (seat, kind) => taps?.buzz(seat, kind),
    },
    ledger,
    library,
    rules,
    log: sessions,
    random: () => randomInt(2 ** 32),
  }, { builder: true });
  const token = createLauncherToken();
  let commit: string | null = null;
  let builder: Builder | null = null;
  const routes = [
    ...apiRoutes({
      core,
      commit: () => commit,
      uptimeMs: () => performance.now() - started,
      roster: () => taps?.roster().map(badgeOf) ?? [],
      records: () => sessions.records(),
      building: () => builder?.building() ?? false,
    }),
    ...tapsRoutes({ taps: () => taps, receiver: settings.receiver.kind, stations: settings.stations }),
  ];
  const games = createGameRoutes({
    built(id) {
      const entry = library.entry(id);
      return entry?.info.kind === "built" && entry.dir ? { dir: entry.dir, ready: entry.info.ready, title: entry.info.title } : null;
    },
    assets: createFrameAssets(log),
  });
  const server = http.createServer(createHandler({ routes, games, screenDir: settings.screenDir, token, log }));
  const link = attachLink(server, core, log);

  // Listen first: the kiosk and the deploy's health check get answers before anything slow (opening the receiver,
  // the commit lookup; the library scan later).
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(settings.port, settings.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.on("error", (error) => log(`http: ${error.message}`));

  void library.rescan();

  if (settings.receiver.kind !== "none") {
    taps = createTaps({
      receiver: settings.receiver.kind === "serial" ? settings.receiver.path : settings.receiver.kind,
      stations: settings.stations,
      dataDir: settings.dataDir,
      clock,
      plan: (seat) => core.plan(seat),
      onTap: (event) => core.tap(event, "station"),
      log,
      ...(options.fake ? { fake: options.fake } : {}),
    });
    const state = core.state();
    for (const seat of SEATS) taps.show(seat, state.stations[seat]);
  }
  // The builder reads its jobs from the disk: it starts after the listen too, and its routes join the handler's then.
  builder = startBuilder({
    dataDir: settings.dataDir,
    env: builderEnv,
    gameRoots: options.builder?.gameRoots ?? [GAMES_DIR],
    log,
    // The Forge installed or removed a game: the rack follows (the core hears the library's change).
    onLibraryChange: () => void library.rescan(),
    ...(options.builder?.simSpeed === undefined ? {} : { simSpeed: options.builder.simSpeed }),
  });
  routes.push(...builderRoutes(builder));
  void readCommit(options.repoRoot).then((found) => {
    commit = found;
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : settings.port;
  let stopping: Promise<void> | null = null;

  return {
    url: `http://${urlHost(settings.host)}:${port}`,
    port,
    core,
    library,
    rules,
    taps: () => taps,
    builder: () => builder,
    token,
    stop() {
      stopping ??= (async () => {
        link.close();
        core.stop();
        server.closeAllConnections();
        await Promise.all([new Promise<void>((resolve) => server.close(() => resolve())), taps?.close(), builder?.stop()]);
        await Promise.all([ledger.flush(), sessions.flush()]);
      })();
      return stopping;
    },
  };
}
