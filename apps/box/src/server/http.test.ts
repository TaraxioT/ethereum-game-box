import { readdirSync, writeFileSync } from "node:fs";
import { createServer, get, type Server } from "node:http";
import { rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { tempDir } from "../builder/forge/test-helpers.ts";
import { LINK_PATH } from "../core/wire.ts";
import { loopbackHost, sameOrigin, sendFile, within } from "./http.ts";
import { CSP, LAUNCHER_HEADER } from "./security.ts";
import { busy } from "./api.ts";
import { PAGE, post, startTestBox, type TestBox } from "./testing.ts";

let tb: TestBox | null = null;
afterEach(async () => {
  await tb?.stop();
  tb = null;
});

async function start(): Promise<TestBox> {
  tb = await startTestBox();
  return tb;
}

const NAVIGATION = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" };

/** A plain GET with exactly these headers (fetch sets its own Sec-Fetch-* headers, and its own Host). */
function getRaw(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    get(url, { headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    }).on("error", reject);
  });
}

const page = async (url: string, headers: Record<string, string>): Promise<string> => (await getRaw(url, headers)).body;

/** The status a WebSocket upgrade is refused with, or 101 when it opens. */
function upgrade(url: string, options: { origin?: string; headers?: Record<string, string> }): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, options);
    ws.on("open", () => {
      ws.close();
      resolve(101);
    });
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
  });
}

describe("the loopback-host and same-origin rules", () => {
  it("takes only this machine's names as the Host, any port", () => {
    for (const host of ["localhost", "localhost:5173", "127.0.0.1:8790", "[::1]:8790", "LOCALHOST:8790"]) expect(loopbackHost(host), host).toBe(true);
    for (const host of [undefined, "", "evil.example", "evil.example:8790", "localhost.evil.example", "127.0.0.1.nip.io:8790", "127.0.0.2:8790", "0.0.0.0:8790", "box:8790"]) {
      expect(loopbackHost(host), String(host)).toBe(false);
    }
  });

  it("allows only the origin the request was sent to, port and all, and requests without an Origin", () => {
    expect(sameOrigin(undefined, "127.0.0.1:8790")).toBe(true);
    expect(sameOrigin("http://127.0.0.1:8790", "127.0.0.1:8790")).toBe(true);
    // The dev server passes the page's requests through with its own Host.
    expect(sameOrigin("http://localhost:5173", "localhost:5173")).toBe(true);
    const refused: [string, string | undefined][] = [
      ["http://localhost:3000", "127.0.0.1:8790"], // another local server's page
      ["http://127.0.0.1:9999", "127.0.0.1:8790"],
      ["http://localhost:8790", "127.0.0.1:8790"],
      ["http://evil.example:8790", "evil.example:8790"], // a rebound name
      ["https://127.0.0.1:8790", "127.0.0.1:8790"],
      ["null", "127.0.0.1:8790"],
      ["http://127.0.0.1:8790", undefined],
    ];
    for (const [origin, host] of refused) expect(sameOrigin(origin, host), `${origin} → ${String(host)}`).toBe(false);
  });

  it("refuses every request and every link addressed to another name (DNS rebinding)", async () => {
    const { box } = await start();
    const rebound = { host: `evil.example:${box.port}` };
    for (const path of ["/", "/api/state", "/api/box", "/assets/app-1234.js"]) {
      expect((await getRaw(`${box.url}${path}`, { ...rebound, ...NAVIGATION })).status, path).toBe(421);
    }
    const opened = await getRaw(`${box.url}/`, { ...rebound, ...NAVIGATION });
    expect(opened.body).not.toContain(box.token);
    expect((await getRaw(`${box.url}/api/state`, { host: `localhost:${box.port}` })).status).toBe(200);
    const link = `${box.url.replace("http", "ws")}${LINK_PATH}`;
    expect(await upgrade(link, { headers: rebound })).toBe(421);
    expect(await upgrade(link, { headers: rebound, origin: `http://evil.example:${box.port}` })).toBe(421);
  });

  it("refuses a POST and a link from another port on this machine, and takes them from the Box's own origin", async () => {
    const { box } = await start();
    const badge = `0x${"ab".repeat(20)}`;
    const own = new URL(box.url).origin;
    expect((await post(box, "/api/taps/inject", { seat: 0, badge }, { origin: "http://127.0.0.1:5999" })).status).toBe(403);
    expect((await post(box, "/api/taps/inject", { seat: 0, badge }, { origin: own })).status).toBe(200);
    const link = `${box.url.replace("http", "ws")}${LINK_PATH}`;
    expect(await upgrade(link, { origin: "http://localhost:5999" })).toBe(403);
    expect(await upgrade(link, { origin: own })).toBe(101);
  });

  it("keeps file paths inside the screen's folder", () => {
    expect(within("/srv/screen", "/assets/a.js")).toBe("/srv/screen/assets/a.js");
    expect(within("/srv/screen", "/../etc/passwd")).toBeNull();
    expect(within("/srv/screen", "/%2e%2e/screen-other/x")).toBeNull();
    expect(within("/srv/screen", "/%E0%A4%A")).toBeNull();
  });

  it("refuses a POST and a link from another origin", async () => {
    const { box } = await start();
    const badge = `0x${"ab".repeat(20)}`;
    const evil = await post(box, "/api/taps/inject", { seat: 0, badge }, { origin: "http://evil.example" });
    expect(evil.status).toBe(403);
    expect((await post(box, "/api/taps/inject", { seat: 0, badge })).status).toBe(200);
    const refused = new WebSocket(`${box.url.replace("http", "ws")}${LINK_PATH}`, { origin: "http://evil.example" });
    const status = await new Promise<number>((resolve) => refused.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0)));
    expect(status).toBe(403);
    const elsewhere = new WebSocket(`${box.url.replace("http", "ws")}/other`);
    const missing = await new Promise<number>((resolve) => elsewhere.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0)));
    expect(missing).toBe(404);
  });
});

describe("sendFile", () => {
  const LARGE = 8 * 1024 * 1024; // past what a socket's buffers hold, so a transfer is still going when the client leaves
  const openFiles = () => readdirSync("/dev/fd").length;
  let server: Server | null = null;

  afterEach(() => {
    server?.closeAllConnections();
    server?.close();
    server = null;
  });

  /** A server sending a large file to everyone, and each request's send so far. */
  async function serve(): Promise<{ url: string; sends: Promise<boolean>[] }> {
    const file = join(tempDir("egb-http-"), "large.bin");
    writeFileSync(file, Buffer.alloc(LARGE, 7));
    const sends: Promise<boolean>[] = [];
    const listening = createServer((_req, res) => void sends.push(sendFile(res, file)));
    server = listening;
    await new Promise<void>((done) => listening.listen(0, "127.0.0.1", done));
    return { url: `http://127.0.0.1:${(listening.address() as AddressInfo).port}/`, sends };
  }

  function abandon(url: string): Promise<void> {
    return new Promise((done) => {
      const req = get(url, (res) =>
        res.once("data", () => {
          req.destroy();
          done();
        }),
      );
      req.on("error", () => {});
    });
  }

  it("sends a whole file", async () => {
    const { url } = await serve();
    expect((await (await fetch(url)).arrayBuffer()).byteLength).toBe(LARGE);
    expect((await fetch(url, { method: "HEAD" })).headers.get("content-length")).toBe(String(LARGE));
  });

  it("lets go of the file when the client leaves part way: a game can abort its own requests at will", async () => {
    const { url, sends } = await serve();
    const before = openFiles();
    for (let i = 0; i < 20; i++) await abandon(url);
    expect(await Promise.all(sends)).toEqual(Array.from({ length: 20 }, () => true));
    await vi.waitFor(() => expect(openFiles()).toBeLessThanOrEqual(before));
  });
});

describe("the screen", () => {
  it("serves the page under the CSP, with the launcher token only for a top-level navigation", async () => {
    const { box } = await start();
    const fetched = await fetch(`${box.url}/`);
    expect(fetched.headers.get("content-security-policy")).toBe(CSP);
    expect(fetched.headers.get("cache-control")).toBe("no-store");
    expect(await fetched.text()).toBe(PAGE);
    const opened = await page(`${box.url}/`, NAVIGATION);
    expect(opened).toContain(`<head><meta name="egb-launcher" content="${box.token}">`);
    const framed = await page(`${box.url}/index.html`, { "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" });
    expect(framed).not.toContain(box.token);
  });

  it("has the plan's CSP", () => {
    for (const rule of ["default-src 'self'", "connect-src 'self'", "frame-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) {
      expect(CSP.split("; ")).toContain(rule);
    }
    expect(CSP).not.toMatch(/script-src[^;]*unsafe|style-src [^;]*unsafe/);
  });

  it("serves assets for good, 404s the rest, and says when the screen isn't built", async () => {
    const t = await start();
    const asset = await fetch(`${t.box.url}/assets/app-1234.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect((await fetch(`${t.box.url}/missing.js`)).status).toBe(404);
    expect((await fetch(`${t.box.url}/..%2f..%2fetc%2fpasswd`)).status).toBe(404);
    expect((await fetch(`${t.box.url}/`, { method: "DELETE" })).status).toBe(405);
    await rm(join(t.dir, "screen", "index.html"));
    expect((await fetch(`${t.box.url}/`)).status).toBe(503);
  });
});

describe("the API", () => {
  it("answers health and state", async () => {
    const { box } = await start();
    const health = (await (await fetch(`${box.url}/api/health`)).json()) as { ok: boolean; commit: unknown; uptimeMs: number };
    expect(health.ok).toBe(true);
    expect(health.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(await (await fetch(`${box.url}/api/state`)).json()).toEqual({ phase: "boot", match: false, busy: false, now: box.core.now() });
    expect((await fetch(`${box.url}/api/nope`)).status).toBe(404);
    expect((await post(box, "/api/state", {})).status).toBe(405);
  });

  it("calls the Box busy from Join on, while a match is open and while money moves", () => {
    const state = (patch: object) => ({ phase: "home", match: null, txs: [], ...patch }) as unknown as Parameters<typeof busy>[0];
    expect(busy(state({}))).toBe(false);
    expect(busy(state({ phase: "attract" }))).toBe(false);
    expect(busy(state({ phase: "join" }))).toBe(true);
    expect(busy(state({ phase: "result" }))).toBe(true);
    expect(busy(state({ txs: [{ step: "in-block" }] }))).toBe(true);
    expect(busy(state({ txs: [{ step: "paid" }] }))).toBe(false);
  });

  it("caps JSON bodies at 64 KB and refuses what isn't JSON", async () => {
    const { box } = await start();
    const big = JSON.stringify({ seat: 0, badge: `0x${"ab".repeat(20)}`, pad: "x".repeat(70_000) });
    expect((await post(box, "/api/taps/inject", big)).status).toBe(413);
    expect((await post(box, "/api/taps/inject", "{ nope")).status).toBe(400);
    expect((await post(box, "/api/taps/inject", { seat: 2, badge: "0x1" })).status).toBe(400);
    expect((await post(box, "/api/taps/inject", { seat: 0, badge: "NOBODY" })).status).toBe(404);
  });

  it("guards the builder's routes with this boot's launcher token", async () => {
    const { box } = await start();
    expect((await fetch(`${box.url}/api/builder`)).status).toBe(403);
    expect((await fetch(`${box.url}/api/builder`, { headers: { [LAUNCHER_HEADER]: "x".repeat(box.token.length) } })).status).toBe(403);
    expect((await fetch(`${box.url}/api/builder`, { headers: { [LAUNCHER_HEADER]: "short" } })).status).toBe(403);
    expect((await fetch(`${box.url}/api/builder`, { headers: { [LAUNCHER_HEADER]: box.token } })).status).toBe(200);
  });

  it("closes the screen only for the kiosk's own page, and says why when it can't", async () => {
    let exits = 0;
    tb = await startTestBox({ exitScreen: async () => void exits++ });
    const { box } = tb;
    expect((await post(box, "/api/box/exit", {})).status).toBe(403);
    expect((await post(box, "/api/box/exit", {}, { [LAUNCHER_HEADER]: box.token, origin: "http://127.0.0.1:5999" })).status).toBe(403);
    expect(exits).toBe(0);
    expect((await post(box, "/api/box/exit", {}, { [LAUNCHER_HEADER]: box.token })).status).toBe(204);
    expect(exits).toBe(1);
    expect((await fetch(`${box.url}/api/state`)).status).toBe(200);
    await tb.stop();

    tb = await startTestBox();
    const refused = await post(tb.box, "/api/box/exit", {}, { [LAUNCHER_HEADER]: tb.box.token });
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("no kiosk in tests");
  });
});
