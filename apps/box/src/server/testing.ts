// What the server's tests share: a whole Box on a free port, its core on a fake clock, a data folder and a stand-in
// screen in a temp folder; and a screen's end of the link that records every message.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { ScreenCommand } from "../core/types.ts";
import type { LinkDown } from "../core/wire.ts";
import { LINK_PATH } from "../core/wire.ts";
import { ANCHOR_AT, BLOCK_MS } from "../core/chain.ts";
import { createFakeClock, type FakeClock } from "../core/fake-clock.ts";
import type { FakeOptions } from "../taps/fake/fake-receiver.ts";
import { startBox, type Box, type BoxOptions } from "./box.ts";
import type { ReceiverSetting } from "./settings.ts";

/** One second after a block, so the next one lands 11 s in. */
export const TEST_START = ANCHOR_AT + 1_000 * BLOCK_MS + 1_000;

export const PAGE = "<!doctype html><html><head><title>screen</title></head><body></body></html>";

export interface TestBox {
  readonly box: Box;
  readonly clock: FakeClock;
  /** The temp folder: data/ and screen/ are in it. */
  readonly dir: string;
  readonly logs: string[];
  /** Moves the core's clock on in steps of `step` ms, as its timers would. */
  advance(ms: number, step?: number): void;
  /** Steps the clock until `check` passes; fails after `limit` ms of Box time. */
  until(check: () => boolean, limit?: number): void;
  /** Like `until`, letting I/O (the fake receiver's serial lines) run between steps of `step` ms. */
  settle(check: () => boolean, limit?: number, step?: number): Promise<void>;
  stop(): Promise<void>;
}

/** Lets pending I/O callbacks run. */
export async function flush(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * The builder's environment in tests: keywords read every answer (no model call), mock voice, the sim provider at once.
 * Nothing from the developer's own environment (an API key) reaches it.
 */
export const TEST_BUILDER_ENV = { EGB_MODEL: "off", EGB_FORGE_PROVIDER: "sim", PATH: process.env.PATH, HOME: process.env.HOME };

export async function startTestBox(
  options: { port?: number; dir?: string; receiver?: ReceiverSetting; fake?: FakeOptions; builder?: BoxOptions["builder"] } = {},
): Promise<TestBox> {
  const dir = options.dir ?? (await mkdtemp(join(tmpdir(), "egb-box-")));
  await mkdir(join(dir, "screen", "assets"), { recursive: true });
  await writeFile(join(dir, "screen", "index.html"), PAGE);
  await writeFile(join(dir, "screen", "assets", "app-1234.js"), "export {};\n");
  const clock = createFakeClock(TEST_START);
  const logs: string[] = [];
  const box = await startBox({
    settings: {
      host: "127.0.0.1",
      port: options.port ?? 0,
      dataDir: join(dir, "data"),
      screenDir: join(dir, "screen"),
      receiver: options.receiver ?? { kind: "none" },
      stations: ["e4ba70", "df3d88"],
    },
    repoRoot: dir,
    clock,
    ...(options.fake ? { fake: options.fake } : {}),
    log: (text) => logs.push(text),
    builder: { env: TEST_BUILDER_ENV, simSpeed: 0, ...options.builder },
  });
  return {
    box,
    clock,
    dir,
    logs,
    advance(ms, step = 50) {
      for (let left = ms; left > 0; left -= step) clock.advance(Math.min(step, left));
    },
    until(check, limit = 60_000) {
      for (let waited = 0; !check(); waited += 50) {
        if (waited > limit) throw new Error(`timed out in ${box.core.state().phase}`);
        clock.advance(50);
      }
    },
    async settle(check, limit = 60_000, step = 10) {
      for (let waited = 0; !check(); waited += step) {
        if (waited > limit) throw new Error(`timed out in ${box.core.state().phase}`);
        clock.advance(step);
        await flush(2);
      }
    },
    async stop() {
      await box.stop();
      if (!options.dir) await rm(dir, { recursive: true, force: true });
    },
  };
}

/** A screen on the link: every message it got, in order. */
export interface TestScreen {
  readonly messages: LinkDown[];
  /** Resolves with the first message from index `from` that passes `check`. */
  next(check: (message: LinkDown) => boolean, from?: number, ms?: number): Promise<LinkDown>;
  send(command: ScreenCommand): void;
  close(): Promise<void>;
}

export async function openScreen(box: Box, origin?: string): Promise<TestScreen> {
  const ws = new WebSocket(`${box.url.replace("http", "ws")}${LINK_PATH}`, origin ? { origin } : {});
  const messages: LinkDown[] = [];
  const waiters = new Set<() => void>();
  ws.on("message", (data) => {
    messages.push(JSON.parse(data.toString()) as LinkDown);
    for (const wake of waiters) wake();
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return {
    messages,
    async next(check, from = 0, ms = 3_000) {
      const deadline = Date.now() + ms;
      for (;;) {
        const hit = messages.slice(from).find(check);
        if (hit) return hit;
        if (Date.now() > deadline) throw new Error(`no such message in ${ms} ms (got ${messages.length})`);
        await new Promise<void>((resolve) => {
          const wake = (): void => {
            waiters.delete(wake);
            resolve();
          };
          waiters.add(wake);
          setTimeout(wake, 20);
        });
      }
    },
    send(command) {
      ws.send(JSON.stringify({ t: "command", command }));
    },
    close() {
      return new Promise((resolve) => {
        if (ws.readyState === ws.CLOSED) return resolve();
        ws.once("close", () => resolve());
        ws.close();
      });
    },
  };
}

/** A POST from this machine's page. */
export function post(box: Box, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${box.url}${path}`, {
    method: "POST",
    // A page of the Box's own makes the request: its origin is the one the request goes to.
    headers: { "content-type": "application/json", origin: new URL(box.url).origin, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
