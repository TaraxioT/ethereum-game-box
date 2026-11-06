// The Box server: `node apps/box/src/server/main.ts` (Node runs the TypeScript as it is).
//
// Settings come from the environment, after the env files (EGB_ENV_FILE or ~/.config/egb/env, then the repo's .env)
// have filled in what isn't set: EGB_PORT (8790), EGB_HOST (127.0.0.1), EGB_DATA (~/.local/share/egb), EGB_RECEIVER
// (a serial path, auto, fake or none), EGB_STATIONS (P1,P2 station ids), EGB_SCREEN_DIR (apps/box/dist/screen).
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.ts";
import { readSettings, SettingsError } from "./settings.ts";
import { startBox, type Box } from "./box.ts";

/** systemd gives a unit 15 s to stop; the Box takes at most this. */
const STOP_MS = 10_000;

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const loaded = loadEnv(process.env, homedir(), repoRoot);

// An error nobody caught (a stray timer, a dropped promise) is logged and the Box keeps running: a crash would take
// the screen and the stations down mid-match, and systemd's restart would lose the match.
process.on("uncaughtException", (error) => console.error("uncaught exception (the Box keeps running):", error));
process.on("unhandledRejection", (error) => console.error("unhandled rejection (the Box keeps running):", error));

let box: Box;
try {
  const settings = readSettings(process.env, homedir(), repoRoot);
  box = await startBox({ settings, repoRoot });
  const receiver = settings.receiver.kind === "serial" ? settings.receiver.path : settings.receiver.kind;
  console.log(
    `Game Box on ${box.url} · data ${settings.dataDir} · screen ${settings.screenDir} · receiver ${receiver} · ` +
      `stations P1 ${settings.stations[0]}, P2 ${settings.stations[1]}` +
      (loaded.length > 0 ? ` · env from ${loaded.join(", ")}` : ""),
  );
} catch (error) {
  console.error(error instanceof SettingsError ? error.message : error);
  process.exit(1);
}

let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: stopping`);
  setTimeout(() => {
    console.error(`still stopping after ${STOP_MS / 1000} s: exiting anyway`);
    process.exit(1);
  }, STOP_MS).unref();
  box.stop().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error("stop:", error);
      process.exit(1);
    },
  );
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
