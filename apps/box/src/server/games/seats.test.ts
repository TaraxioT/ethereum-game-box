// Every seated page in a real browser (screen/seats-kiosk.ts), with 2, 3 and 4 seats, at the Pi's 16:9, the demo's 16:10
// and in portrait: the real shell, views, parts, styles and fonts, measured as they stand. Three or four seats must have
// nothing on top of anything else, and nothing sticking out of its panel. Two seats are the look the team games have,
// which isn't this test's to change: they are held to what they already do. Skipped without a Chromium (EGB_CHROMIUM
// names one, else the Pi's, Playwright's or Chrome).
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "../../builder/forge/test-helpers.ts";
import { readJson } from "../http.ts";
import { CHROMIUM, headlessFlags } from "./chromium.ts";

interface SceneReport {
  readonly scene: string;
  readonly size: string;
  readonly seats: number;
  readonly panels: number;
  readonly problems: readonly string[];
}

const PAGE = `<!doctype html><title>seats</title><link rel="stylesheet" href="/kiosk.css"><script type="module" src="/kiosk.js"></script>`;

/** A page of two panels is held to where it has always stood: the plate's corners sit on the panels'. */
const TWO_SEAT_LOOK = /^panel \d overlaps plate$/;

describe.skipIf(CHROMIUM === null)("the seats in a real browser", () => {
  let reports: readonly SceneReport[] = [];
  let chromium: ChildProcess | null = null;
  let server: http.Server | null = null;

  beforeAll(async () => {
    const root = tempDir();
    await esbuild.build({
      entryPoints: [fileURLToPath(new URL("../../screen/seats-kiosk.ts", import.meta.url))],
      outfile: path.join(root, "kiosk.js"),
      bundle: true,
      format: "esm",
      target: "es2023",
      platform: "browser",
      loader: { ".woff2": "dataurl", ".woff": "dataurl" },
      define: { "import.meta.env.VITE_EGB_MODE": JSON.stringify("box") },
      logLevel: "silent",
    });

    let finished: () => void = () => {};
    const done = new Promise<void>((resolve) => (finished = resolve));
    // The page frames itself, which the Box's own handler would refuse.
    server = http.createServer((req, res) => {
      const { pathname } = new URL(req.url ?? "/", "http://box");
      if (pathname === "/api/report") {
        void readJson(req, 1024 * 1024).then((sent) => {
          reports = sent as SceneReport[];
          res.writeHead(204).end();
          finished();
        });
      } else if (pathname === "/") {
        res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
      } else {
        const css = pathname.endsWith(".css");
        res.writeHead(200, { "content-type": css ? "text/css" : "text/javascript" }).end(readFileSync(path.join(root, css ? "kiosk.css" : "kiosk.js")));
      }
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    const browser = spawn(CHROMIUM ?? "", [...headlessFlags(path.join(root, "profile")), `http://127.0.0.1:${port}/`], { stdio: "ignore" });
    chromium = browser;
    const exited = new Promise<void>((resolve) => browser.once("exit", () => resolve()));
    void exited.then(finished);
    await done;
  }, 120_000);

  afterAll(() => {
    chromium?.kill("SIGKILL");
    server?.closeAllConnections();
    server?.close();
  });

  it("draws every page at every size", () => {
    expect(new Set(reports.map((r) => r.size))).toEqual(new Set(["pi", "demo", "portrait"]));
    expect(new Set(reports.map((r) => r.seats))).toEqual(new Set([2, 3, 4]));
  });

  it("has nothing on top of anything else with three or four seats", () => {
    const wrong = reports.filter((r) => r.panels > 2 && r.problems.length > 0).map((r) => `${r.size} ${r.scene}: ${r.problems.join("; ")}`);
    expect(wrong).toEqual([]);
  });

  it("keeps the two-seat look", () => {
    const wrong = reports.filter((r) => r.panels <= 2).flatMap((r) => r.problems.filter((problem) => !TWO_SEAT_LOOK.test(problem)).map((problem) => `${r.size} ${r.scene}: ${problem}`));
    expect(wrong).toEqual([]);
  });
});
