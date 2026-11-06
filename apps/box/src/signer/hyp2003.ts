// The Box's key on its HYP2003 token, through the signer daemon (`deploy/p256-signer/hyp2003_signer.py --serve`),
// started from P256_SIGNER_CMD and kept running. JSON lines: it prints `{"ready":true,"qx","qy"}` once the token is
// open, then answers `{"id","digest"}` with `{"id","r","s"}` (low `s`) or `{"id","error"}`. The PIN stays in its file
// on the Pi: nothing here reads it. A daemon that exits is started again after RESTART_MS, except after a `fatal`
// line or exit 3 (the token refused the PIN): another login could lock the token, so the Box stops asking.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { Hex } from "viem";
import type { BoxSigner, P256Signature } from "./signer.ts";

export const RESTART_MS = 5_000;
/** A signature takes ~11 ms on the token; past this the request fails (the daemon may be reopening the token). */
export const SIGN_TIMEOUT_MS = 10_000;
const EXIT_PIN_REJECTED = 3;

interface Pending {
  readonly resolve: (signature: P256Signature) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

const HEX32 = /^0x[0-9a-fA-F]{64}$/;

/** The daemon's command line, split on spaces (it isn't run through a shell). */
export function splitCommand(command: string): [string, ...string[]] {
  const [file, ...args] = command.trim().split(/\s+/);
  if (!file) throw new Error("P256_SIGNER_CMD is empty");
  return [file, ...args];
}

export function processSigner(command: string, log: (text: string) => void): BoxSigner {
  const [file, ...args] = splitCommand(command);
  let child: ChildProcessWithoutNullStreams | null = null;
  let key: { qx: Hex; qy: Hex } | null = null;
  /** Waiters for the next `ready`. */
  let waiters: { resolve: () => void; reject: (error: Error) => void }[] = [];
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let stopped = false;
  let fatal: string | null = null;
  let restart: NodeJS.Timeout | null = null;

  function failAll(error: Error): void {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      pending.delete(id);
      p.reject(error);
    }
  }

  function onLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      log(`signer: a line that isn't JSON: ${line.slice(0, 80)}`);
      return;
    }
    if (typeof message.fatal === "string") {
      fatal = `the signer stopped for good (${message.fatal}): ${String(message.error ?? "")}`;
      log(fatal);
      return;
    }
    if (message.ready === true && typeof message.qx === "string" && typeof message.qy === "string") {
      key = { qx: message.qx as Hex, qy: message.qy as Hex };
      log(`signer: ready, key ${key.qx.slice(0, 10)}…`);
      const ready = waiters;
      waiters = [];
      for (const w of ready) w.resolve();
      return;
    }
    const id = typeof message.id === "number" ? message.id : null;
    const p = id === null ? undefined : pending.get(id);
    if (id === null || !p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    if (typeof message.r === "string" && typeof message.s === "string" && HEX32.test(message.r) && HEX32.test(message.s)) {
      p.resolve({ r: message.r as Hex, s: message.s as Hex });
    } else {
      p.reject(new Error(`the signer refused: ${String(message.error ?? "no signature")}`));
    }
  }

  function start(): void {
    restart = null;
    if (stopped || fatal) return;
    const proc = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    child = proc;
    createInterface({ input: proc.stdout }).on("line", onLine);
    createInterface({ input: proc.stderr }).on("line", (line) => log(`signer: ${line}`));
    proc.on("error", (error) => log(`signer: can't start ${file}: ${error.message}`));
    proc.on("close", (code) => {
      if (child === proc) child = null;
      key = null;
      failAll(new Error("the signer stopped"));
      if (code === EXIT_PIN_REJECTED) fatal ??= "the signer exited 3: the token refused the PIN; not starting it again";
      if (stopped) return;
      if (fatal) {
        log(fatal);
        const left = waiters;
        waiters = [];
        for (const w of left) w.reject(new Error(fatal));
        return;
      }
      log(`signer: exited (${code ?? "signal"}), starting it again in ${RESTART_MS / 1000} s`);
      restart = setTimeout(start, RESTART_MS);
    });
  }

  function ready(): Promise<void> {
    if (fatal) return Promise.reject(new Error(fatal));
    if (key && child) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters = waiters.filter((w) => w.resolve !== done);
        reject(new Error("the signer isn't ready"));
      }, SIGN_TIMEOUT_MS);
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      waiters.push({ resolve: done, reject: (e) => (clearTimeout(timer), reject(e)) });
    });
  }

  start();

  return {
    async sign(digest) {
      if (!HEX32.test(digest)) throw new Error("a digest is 0x and 64 hex characters");
      await ready();
      const proc = child;
      if (!proc) throw new Error("the signer stopped");
      const id = nextId++;
      return new Promise<P256Signature>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`the signer didn't answer in ${SIGN_TIMEOUT_MS / 1000} s`));
        }, SIGN_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        proc.stdin.write(`${JSON.stringify({ id, digest })}\n`);
      });
    },
    async publicKey() {
      await ready();
      if (!key) throw new Error("the signer stopped");
      return key;
    },
    stop() {
      stopped = true;
      if (restart) clearTimeout(restart);
      failAll(new Error("the signer stopped"));
      // Closing stdin ends the daemon (EOF), and an ssh session with it.
      child?.stdin.end();
      child = null;
    },
  };
}
