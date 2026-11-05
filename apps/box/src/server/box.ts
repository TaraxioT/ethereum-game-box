// The Box server, put together: the core on Node's ports, the taps library on the receiver's port (the core's
// stations), the session log, the HTTP routes and the built screen and test page, and the screen's WebSocket link,
// on one port. main.ts reads the settings and starts it; tests start it on a free port with a fake clock.
import http from "node:http";
import { randomInt } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { SEATS } from "@egb/sdk";
import type { Clock } from "../core/ports.ts";
import { createCore, type Core } from "../core/core.ts";
import { teamLibrary } from "../core/catalogue.ts";
import { systemClock } from "../core/system-clock.ts";
import type { FakeOptions } from "../taps/fake/fake-receiver.ts";
import { badgeOf } from "../taps/roster.ts";
import { createTaps, type Taps } from "../taps/taps.ts";
import type { Settings } from "./settings.ts";
import { apiRoutes } from "./api.ts";
import { createLedgerFile } from "./ledger-file.ts";
import { attachLink } from "./link.ts";
import { readCommit } from "./release.ts";
import { createHandler } from "./routes.ts";
import { createLauncherToken } from "./security.ts";
import { createSessionLog } from "./sessions.ts";
import { tapsRoutes } from "./taps-api.ts";

export interface BoxOptions {
  readonly settings: Settings;
  readonly repoRoot: string;
  /** The clock of the core and the taps (tests: a fake one; HTTP and the link stay on real time). */
  readonly clock?: Clock;
  /** The fake receiver's timing, with EGB_RECEIVER=fake (tests: `timeScale: 0`). */
  readonly fake?: FakeOptions;
  readonly log?: (text: string) => void;
}

export interface Box {
  /** Where the screen is served. */
  readonly url: string;
  readonly port: number;
  readonly core: Core;
  /** The taps library, once it has started (after the server listens); null with EGB_RECEIVER=none. */
  taps(): Taps | null;
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
  await mkdir(settings.dataDir, { recursive: true });
  const ledger = createLedgerFile(join(settings.dataDir, "ledger.json"), log);
  const sessions = createSessionLog(settings.dataDir, log);
  let taps: Taps | null = null;
  const core = createCore({
    clock,
    // The taps library is the stations port once it has started; the core's views before then are sent on start.
    stations: {
      show: (seat, view) => taps?.show(seat, view),
      buzz: (seat, kind) => taps?.buzz(seat, kind),
    },
    ledger,
    library: teamLibrary(),
    log: sessions,
    random: () => randomInt(2 ** 32),
  });
  const token = createLauncherToken();
  let commit: string | null = null;
  const routes = [
    ...apiRoutes({
      core,
      commit: () => commit,
      uptimeMs: () => performance.now() - started,
      roster: () => taps?.roster().map(badgeOf) ?? [],
      records: () => sessions.records(),
    }),
    ...tapsRoutes({ taps: () => taps, receiver: settings.receiver.kind, stations: settings.stations }),
  ];
  const server = http.createServer(createHandler({ routes, screenDir: settings.screenDir, token, log }));
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
    taps: () => taps,
    token,
    stop() {
      stopping ??= (async () => {
        link.close();
        core.stop();
        server.closeAllConnections();
        await Promise.all([new Promise<void>((resolve) => server.close(() => resolve())), taps?.close()]);
        await Promise.all([ledger.flush(), sessions.flush()]);
      })();
      return stopping;
    },
  };
}
