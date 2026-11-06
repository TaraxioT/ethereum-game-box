// `pnpm test:docker`: builds the real image and runs one job in it on an internal Docker network, with a fake model as
// the only thing it can reach. That stands in for Cloudflare's `enableInternet = false`; it doesn't prove Cloudflare.
// `EGB_DOCKER_PLATFORM=linux/amd64` builds for what Cloudflare runs.
import { execFileSync, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  allBlocked,
  BURST,
  DECOY_NAME,
  DECOY_VALUE,
  FIND_SERVER,
  INTERNET_PROBES,
  noSecrets,
  PROBES,
  SERVER_UID,
  VERDICT,
  VERIFIER_HOST,
  VERIFIER_PORT,
} from "./probes.ts";

const FOLDER = fileURLToPath(new URL("../..", import.meta.url));
const NODE_IMAGE = "node:26.13.0-trixie-slim";
const PLATFORM = process.env.EGB_DOCKER_PLATFORM;
const PLATFORM_ARGS = PLATFORM ? ["--platform", PLATFORM] : [];
const IMAGE = `egb-verifier-test:${process.pid}`;
const NETWORK = `egb-verifier-test-${process.pid}`;
const VERIFIER = `egb-verifier-test-${process.pid}`;
const STOPPED = `${VERIFIER}-stop`;
const REFUSED = `${VERIFIER}-refuse`;
/** The server's capabilities as `/proc/<pid>/status` writes them: setuid, setgid and setpcap. */
const SERVER_CAPS = "00000000000001c0";
/** Room for one file at the shell's size limit and not two, so the agent can fill it. */
const WORK_DISK = "/tmp:size=96m,mode=1777";
const MAX_LINES = 14;

let failures = 0;

function report(name: string, problem: string | null, detail: string): void {
  if (problem) failures++;
  console.log(`\n${problem ? "FAIL" : "ok  "} ${name}${problem ? `: ${problem}` : ""}`);
  const lines = detail.trimEnd().split("\n");
  const shown = lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `... ${lines.length - MAX_LINES} more lines`] : lines;
  for (const line of shown) console.log(`       ${line.slice(0, 140)}`);
}

const docker = (...args: readonly string[]): string =>
  execFileSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] });

/** Everything a command printed, whether or not it worked. */
function dockerOutput(...args: readonly string[]): string {
  const { stdout, stderr } = spawnSync("docker", args, { encoding: "utf8" });
  return `${stdout}${stderr}`;
}

function cleanUp(): void {
  spawnSync("docker", ["rm", "-f", VERIFIER, STOPPED]);
  spawnSync("docker", ["network", "rm", NETWORK]);
  spawnSync("docker", ["rmi", "-f", IMAGE]);
}

const startVerifier = (name: string, ...options: readonly string[]): string =>
  docker("run", "--detach", ...PLATFORM_ARGS, "--name", name, "--network", NETWORK, "--network-alias", VERIFIER_HOST, ...options, IMAGE);

/** A running server's real environment. Only a privileged exec can read it: root in the container can't ptrace. */
const serverEnv = (name: string): string =>
  dockerOutput("exec", "--privileged", name, "bash", "-c", `${FIND_SERVER}\ntr '\\0' '\\n' < /proc/$server/environ | sort`);

async function waitForPort(name: string): Promise<void> {
  for (let tries = 0; tries < 60; tries++) {
    const probe = spawnSync("docker", ["exec", name, "bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${VERIFIER_PORT}`]);
    if (probe.status === 0) return;
    await delay(500);
  }
  throw new Error("the server never opened its port");
}

/** The container's two processes, seen from outside them, before the job starts. */
function checkProcesses(): void {
  const field = (status: string, key: string): string => status.split("\n").find((line) => line.startsWith(key)) ?? "";
  const asServer = (status: string): string | null =>
    new RegExp(`^Uid:\\s+${SERVER_UID}\\s+${SERVER_UID}`).test(field(status, "Uid:")) &&
    field(status, "CapEff:").endsWith(SERVER_CAPS)
      ? null
      : "wrong user or capabilities";
  const summary = (status: string): string =>
    ["Name:", "Pid:", "Uid:", "Gid:", "CapEff:", "CapBnd:"].map((key) => field(status, key)).join("\n");

  const init = docker("exec", VERIFIER, "cat", "/proc/1/status");
  report("PID 1 isn't root, and holds only the server's three capabilities", asServer(init), summary(init));
  const server = docker("exec", VERIFIER, "bash", "-c", `${FIND_SERVER}\ncat /proc/$server/status`);
  report("the server isn't root, and holds only its three capabilities", asServer(server), summary(server));

  const env = serverEnv(VERIFIER);
  report("the server's environment holds no secrets", noSecrets(env), env);

  const blocked = dockerOutput("exec", VERIFIER, "bash", "-c", INTERNET_PROBES);
  report("the internet is unreachable from the container, even as root", allBlocked(blocked), blocked);
}

/** The same probes on a normal network: they only prove anything if they can succeed. */
function checkProbesCanSucceed(): void {
  const open = dockerOutput("run", "--rm", ...PLATFORM_ARGS, NODE_IMAGE, "bash", "-c", INTERNET_PROBES);
  report(
    "control: the same probes reach the internet from a container on a normal network",
    /tcp 1\.1\.1\.1:443 exit=0/.test(open) && /https example\.com exit=0/.test(open)
      ? null
      : "they failed on an open network too, so they prove nothing here",
    open,
  );
}

/** A second server, holding a decoy: the secrets check must find it, and `SIGTERM` must stop it, as the platform waits
 *  up to 15 minutes for a container that ignores one. */
async function checkDecoyAndStop(): Promise<void> {
  startVerifier(STOPPED, "--env", "ZG_API_KEY=decoy");
  await waitForPort(STOPPED);
  const env = serverEnv(STOPPED);
  report(
    "control: the secrets check finds a decoy in a server that holds one",
    noSecrets(env) === "found ZG_API_KEY" ? null : "it missed the decoy, so it proves nothing",
    env,
  );

  const started = Date.now();
  docker("stop", "--timeout", "30", STOPPED);
  const elapsed = Date.now() - started;
  report("the server stops on SIGTERM", elapsed < 5_000 ? null : "it ran until it was killed", `${elapsed} ms`);
}

/** A broken sandbox must stop the server from serving at all, so it runs here without the image's entry point. */
function checkRefusesToStart(name: string, user: string, error: string): void {
  const { status, stderr } = spawnSync(
    "docker",
    ["run", "--rm", ...PLATFORM_ARGS, "--name", REFUSED, "--user", user, "--entrypoint", "node", IMAGE, "src/main.ts"],
    { encoding: "utf8", timeout: 30_000 },
  );
  spawnSync("docker", ["rm", "-f", REFUSED]);
  const line = stderr.split("\n").find((text) => text.includes(error)) ?? "";
  report(name, status !== null && status !== 0 && line !== "" ? null : "it started", `exit code ${status}\n${line}`);
}

interface DriveResult {
  readonly status: number;
  readonly body: unknown;
  readonly results: readonly string[];
  readonly turns: number;
  readonly authorized: number;
}

function checkRun(result: DriveResult): void {
  PROBES.forEach((probe, index) => {
    const output = result.results[index];
    if (output === undefined) report(probe.name, "the agent never got this far", "");
    else report(probe.name, probe.check(output), output);
  });
  const burst = BURST.map((probe, index) => ({ probe, output: result.results[PROBES.length + index] ?? "" }));
  const lost = burst.filter(({ probe, output }) => probe.check(output) !== null);
  report(
    `${BURST.length} shell calls in one reply all finish, untouched by each other's cleanup`,
    lost.length > 0 ? `${lost.length} were lost` : null,
    lost.map(({ probe, output }) => `${probe.name}: ${JSON.stringify(output)}`).join("\n"),
  );
  report(
    "the run ends with the agent's verdict",
    result.status === 200 && JSON.stringify(result.body) === JSON.stringify({ verdict: VERDICT })
      ? null
      : "a different answer",
    `HTTP ${result.status} ${JSON.stringify(result.body)}`,
  );
  report(
    "the container sent no key to the model",
    result.authorized > 0 ? `${result.authorized} calls had one` : null,
    `${result.turns} model calls`,
  );
  const exitCode = docker("wait", VERIFIER).trim();
  const state = docker("inspect", "-f", "{{.State.Status}}", VERIFIER).trim();
  report(
    "the server exits after its one job",
    exitCode === "0" && state === "exited" ? null : "it's still there, or it failed",
    `state ${state}, exit code ${exitCode}`,
  );
}

try {
  console.log(`Building for ${PLATFORM ?? "the native platform"}.`);
  docker("pull", "--quiet", ...PLATFORM_ARGS, NODE_IMAGE);
  docker("build", ...PLATFORM_ARGS, "--quiet", "--tag", IMAGE, FOLDER);
  docker("network", "create", "--internal", NETWORK);
  startVerifier(VERIFIER, "--env", `${DECOY_NAME}=${DECOY_VALUE}`, "--tmpfs", WORK_DISK);
  await waitForPort(VERIFIER);

  checkProcesses();
  checkProbesCanSucceed();
  await checkDecoyAndStop();
  checkRefusesToStart("the server refuses to start as root", "root", "the server is running as root");
  checkRefusesToStart("the server refuses to start without the capabilities to switch user", "judge", "setpriv");

  const raw = docker(
    "run",
    "--rm",
    ...PLATFORM_ARGS,
    "--network",
    NETWORK,
    "--network-alias",
    "zg.internal",
    "--volume",
    `${FOLDER}test:/test:ro`,
    NODE_IMAGE,
    "node",
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "/test/docker/drive.ts",
  );
  checkRun(JSON.parse(raw) as DriveResult);
} catch (error) {
  failures++;
  console.error(error);
  console.error(dockerOutput("logs", VERIFIER));
} finally {
  cleanUp();
}

console.log(failures === 0 ? "\nAll passed." : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
