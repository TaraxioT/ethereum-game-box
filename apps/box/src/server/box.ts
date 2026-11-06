// The Box server, put together: the core on Node's ports, the HTTP routes and the built screen, and the screen's
// WebSocket link, on one port. main.ts reads the settings and starts it; tests start it on a free port with a fake
// clock for the core.
import http from "node:http";
import { randomInt } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Clock } from "../core/ports.ts";
import { createCore, type Core } from "../core/core.ts";
import { teamLibrary } from "../core/catalogue.ts";
import { systemClock } from "../core/system-clock.ts";
import type { Settings } from "./settings.ts";
import { apiRoutes } from "./api.ts";
import { createLedgerFile } from "./ledger-file.ts";
import { attachLink } from "./link.ts";
import { readCommit } from "./release.ts";
import { createHandler } from "./routes.ts";
import { createLauncherToken } from "./security.ts";

export interface BoxOptions {
  readonly settings: Settings;
  readonly repoRoot: string;
  /** The core's clock (tests: a fake one; HTTP and the link stay on real time). */
  readonly clock?: Clock;
  readonly log?: (text: string) => void;
}

export interface Box {
  /** Where the screen is served. */
  readonly url: string;
  readonly port: number;
  readonly core: Core;
  /** This boot's launcher token. */
  readonly token: string;
  /** Stops the link, the core and the server, and waits for the ledger to reach the disk. */
  stop(): Promise<void>;
}

function urlHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host.includes(":") ? `[${host}]` : host;
}

export async function startBox(options: BoxOptions): Promise<Box> {
  const { settings } = options;
  const log = options.log ?? ((text: string) => console.log(text));
  const started = performance.now();
  await mkdir(settings.dataDir, { recursive: true });
  const ledger = createLedgerFile(join(settings.dataDir, "ledger.json"), log);
  const core = createCore({
    clock: options.clock ?? systemClock(),
    // The stations come with the taps library (step 3); until then nothing is drawn on them.
    stations: { show() {}, buzz() {} },
    ledger,
    library: teamLibrary(),
    // Transcripts go to the session log with the games on real taps (step 4).
    log: { record() {} },
    random: () => randomInt(2 ** 32),
  });
  const token = createLauncherToken();
  let commit: string | null = null;
  const routes = apiRoutes({ core, commit: () => commit, uptimeMs: () => performance.now() - started });
  const server = http.createServer(createHandler({ routes, screenDir: settings.screenDir, token, log }));
  const link = attachLink(server, core, log);

  // Listen first: the kiosk and the deploy's health check get answers before anything slow (the commit lookup now;
  // the library scan and the receiver later).
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(settings.port, settings.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.on("error", (error) => log(`http: ${error.message}`));
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
    token,
    stop() {
      stopping ??= (async () => {
        link.close();
        core.stop();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await ledger.flush();
      })();
      return stopping;
    },
  };
}
