// The sandbox proved in a real browser: Chromium with the flags the Pi's kiosk unit starts it with, read from that file,
// on the real handler, routes and CSPs, with the real view, gate and channel (screen/frame/sandbox-kiosk.ts). A second
// server and a UDP socket on this machine's real address stand for the outside world. Each scenario is a bundle that
// tries something, and the proof is what the outside and the Box then saw, not what the page says. Skipped without a
// Chromium (EGB_CHROMIUM names one, else the Pi's, Playwright's or Chrome), or without a network address to stand the
// outside on.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import dgram from "node:dgram";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { homedir, networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FRAME_LIMITS, SMALL_CHARS } from "@egb/sdk";
import { tempDir } from "../../builder/forge/test-helpers.ts";
import { readJson, sendJson } from "../http.ts";
import { createHandler } from "../routes.ts";
import { createFrameAssets } from "./assets.ts";
import { CHROMIUM, headlessFlags, kioskFlags } from "./chromium.ts";
import { createGameRoutes } from "./routes.ts";

interface Report {
  readonly id: string;
  readonly end: string;
  readonly said: readonly Record<string, unknown>[];
  /** The longest the kiosk's thread went without running a timer, in ms. */
  readonly stall: number;
}

/** The outside's address: a real one, as WebRTC gathers from real interfaces and KIOSK_WALLS lets loopback through. */
const HERE = Object.values(networkInterfaces())
  .flat()
  .find((address) => address?.family === "IPv4" && !address.internal)?.address;
const file = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
/** The most seconds a flood may take, in the rates it is held to: a loaded machine mustn't fail this. */
const FLOOD_SECONDS = 10;
/** The longest a heavy message may hold the kiosk's thread. Reading one costs tens of ms; parsing it cost seconds, or the tab. */
const MOST_STALL_MS = 1500;

/**
 * What no CSP can do. Under `default-src 'none'` and the sandbox, `<link rel="prerender">` still sends a full GET to any
 * URL, a preconnect still opens a connection, a dns-prefetch still looks a name up, and WebRTC still sends UDP: Chromium
 * doesn't enforce `webrtc 'block'`, and a nested srcdoc frame gets a fresh window, so the host can't take the API away
 * either. Only the browser's own start can stop them: no name resolves but the Box's own, and WebRTC has no route out.
 */
const KIOSK_WALLS = ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost", "--webrtc-ip-handling-policy=disable_non_proxied_udp"];

/** A tiny valid PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

/** What a probing page starts with: `attempt` starts one try, and `report` waits for them all and posts the answers. */
const HARNESS = `
const results = {};
const tries = [];
const after = (ms, word) => new Promise((_, no) => setTimeout(() => no(new Error(word)), ms));
function attempt(name, fn) {
  tries.push((async () => {
    try {
      results[name] = "open: " + String(await Promise.race([fn(), after(1500, "no answer")])).slice(0, 40);
    } catch (error) {
      results[name] = "shut: " + (error && error.name);
    }
  })());
}
function loads(element, parent = document.body) {
  return new Promise((yes, no) => {
    element.onload = () => yes("loaded");
    element.onerror = () => no(new Error("failed"));
    parent.append(element);
  });
}
function make(tag, fields) {
  return Object.assign(document.createElement(tag), fields);
}
async function report() {
  await Promise.all(tries);
  const names = Object.keys(results);
  for (let i = 0; i < names.length; i += 6) egb.event("results", Object.fromEntries(names.slice(i, i + 6).map((n) => [n, results[n]])));
  setTimeout(() => egb.end(), 300);
}
`;

/** Everything a page might use to reach past its frame, short of leaving it. `OUT` is the outside, `STUN` a UDP port on it. */
const WALLS = `
window.addEventListener("load", () => {
  attempt("fetch out", () => fetch(OUT + "/fetch"));
  attempt("fetch no-cors", () => fetch(OUT + "/no-cors", { mode: "no-cors" }));
  attempt("fetch keepalive", () => fetch(OUT + "/keepalive", { method: "POST", keepalive: true }));
  attempt("fetch the Box's API", () => fetch("/api/state").then((r) => r.text()));
  attempt("fetch a tap in", () => fetch("/api/taps/inject", { method: "POST", body: "{}" }));
  attempt("fetch its own file", () => fetch("own.js").then((r) => r.text()));
  attempt("xhr", () => new Promise((yes, no) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => yes(xhr.responseText);
    xhr.onerror = () => no(new Error("xhr"));
    xhr.open("GET", OUT + "/xhr");
    xhr.send();
  }));
  attempt("beacon", () => { navigator.sendBeacon(OUT + "/beacon", "x"); return after(200, "sent"); });
  attempt("image out", () => loads(make("img", { src: OUT + "/image.png" })));
  attempt("image from the API", () => loads(make("img", { src: "/api/state" })));
  attempt("script out", () => loads(make("script", { src: OUT + "/script.js" })));
  attempt("script from the Box", () => loads(make("script", { src: "/frame.js" })));
  attempt("stylesheet out", () => loads(make("link", { rel: "stylesheet", href: OUT + "/style.css" }), document.head));
  attempt("css background", () => { document.body.style.background = "url(" + OUT + "/background.png)"; return after(200, "set"); });
  attempt("font out", () => new FontFace("x", "url(" + OUT + "/font.woff2)").load());
  attempt("audio out", () => new Promise((yes, no) => {
    const audio = new Audio(OUT + "/sound.mp3");
    audio.oncanplay = yes;
    audio.onerror = () => no(new Error("failed"));
  }));
  attempt("iframe out", () => loads(make("iframe", { src: OUT + "/iframe" })));
  attempt("nested frame", () => new Promise((yes, no) => {
    const inside = "fetch('" + OUT + "/nested-fetch').catch(() => {}); new Image().src = '" + OUT + "/nested-image.png';"
      + "top.postMessage({ t: 'event', name: 'nested', data: null }, '*'); parent.postMessage('nested', '*');";
    window.addEventListener("message", (event) => event.data === "nested" && yes("ran"));
    document.body.append(make("iframe", { srcdoc: "<script>" + inside + "<\\/script>" }));
    setTimeout(() => no(new Error("silent")), 500);
  }));
  attempt("object", () => loads(make("object", { data: OUT + "/object" })));
  attempt("embed", () => loads(make("embed", { src: OUT + "/embed" })));
  attempt("dynamic import", () => import(OUT + "/import.js"));
  attempt("prefetch", () => loads(make("link", { rel: "prefetch", href: OUT + "/prefetch" }), document.head));
  attempt("preload", () => loads(make("link", { rel: "preload", as: "image", href: OUT + "/preload.png" }), document.head));
  attempt("prerender", () => { document.head.append(make("link", { rel: "prerender", href: OUT + "/prerender" })); return after(300, "set"); });
  attempt("preconnect", () => { document.head.append(make("link", { rel: "preconnect", href: OUT })); return after(300, "set"); });
  attempt("speculation rules", () => {
    document.head.append(make("script", { type: "speculationrules", textContent: JSON.stringify({ prefetch: [{ source: "list", urls: [OUT + "/speculation"] }] }) }));
    return after(300, "set");
  });
  attempt("csp report", () => {
    document.head.append(make("meta", { httpEquiv: "Content-Security-Policy", content: "img-src 'none'; report-uri " + OUT + "/report" }));
    document.body.append(make("img", { src: "data:image/png;base64,xx" }));
    return after(300, "set");
  });
  attempt("ping", () => {
    const a = make("a", { href: "#x", ping: OUT + "/ping", textContent: "x" });
    document.body.append(a);
    a.click();
    return after(200, "clicked");
  });
  attempt("websocket out", () => new Promise((yes, no) => {
    const socket = new WebSocket(OUT.replace("http", "ws") + "/socket");
    socket.onopen = () => yes("open");
    socket.onerror = () => no(new Error("failed"));
  }));
  attempt("websocket to the Box", () => new Promise((yes, no) => {
    const socket = new WebSocket("ws://" + location.host + "/link");
    socket.onopen = () => yes("open");
    socket.onerror = () => no(new Error("failed"));
  }));
  attempt("event source", () => new Promise((yes, no) => {
    const source = new EventSource(OUT + "/events");
    source.onopen = () => yes("open");
    source.onerror = () => no(new Error("failed"));
  }));
  attempt("web transport", () => new WebTransport(OUT.replace("http", "https") + "/transport").ready);
  attempt("webrtc", async () => {
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:" + STUN }] });
    peer.createDataChannel("x");
    await peer.setLocalDescription(await peer.createOffer());
    return after(1000, "gathered");
  });
  attempt("form", () => {
    const form = make("form", { action: OUT + "/form", method: "post" });
    document.body.append(form);
    form.submit();
    return after(300, "submitted");
  });
  attempt("window.open", () => {
    if (window.open(OUT + "/open")) return "opened";
    throw new Error("no window");
  });
  attempt("parent's document", () => parent.document.title);
  attempt("top's document", () => top.document.title);
  attempt("parent's URL", () => parent.location.href);
  attempt("the frame element", () => {
    if (window.frameElement === null) throw new Error("none");
    return window.frameElement;
  });
  attempt("navigate the top", () => { top.location.href = OUT + "/top"; return after(300, "no effect"); });
  attempt("link to the top", () => {
    const a = make("a", { href: OUT + "/top-link", target: "_top", textContent: "x" });
    document.body.append(a);
    a.click();
    return after(300, "no effect");
  });
  attempt("cookie", () => document.cookie);
  attempt("local storage", () => localStorage.length);
  attempt("indexed db", () => new Promise((yes, no) => {
    const open = indexedDB.open("x");
    open.onsuccess = () => yes("open");
    open.onerror = () => no(new Error("failed"));
  }));
  attempt("cache storage", () => caches.keys());
  attempt("service worker", () => navigator.serviceWorker.register("own.js"));
  attempt("worker", () => new Promise((yes, no) => {
    new Worker("own.js").onerror = () => no(new Error("failed"));
    setTimeout(() => yes("started"), 200);
  }));
  attempt("blob worker", () => new Promise((yes, no) => {
    new Worker(URL.createObjectURL(new Blob(["1"]))).onerror = () => no(new Error("failed"));
    setTimeout(() => yes("started"), 200);
  }));
  attempt("eval", () => eval("1"));
  attempt("new Function", () => new Function("return 1")());
  attempt("microphone", () => navigator.mediaDevices.getUserMedia({ audio: true }));
  attempt("serial", () => navigator.serial.requestPort());
  attempt("usb", () => navigator.usb.requestDevice({ filters: [] }));
  attempt("hid", () => navigator.hid.requestDevice({ filters: [] }));
  attempt("bluetooth", () => navigator.bluetooth.requestDevice({ acceptAllDevices: true }));
  report();
});
`;

/** Words the kiosk doesn't have, and a flood of the ones it does. */
const FORGERIES = `
window.addEventListener("load", () => {
  parent.postMessage({ t: "tap", seat: 0, at: 1, roll: 7 }, "*");
  parent.postMessage({ t: "command", command: { type: "topup" } }, "*");
  parent.postMessage({ t: "stake", amount: 25 }, "*");
  parent.postMessage({ t: "event", name: "x".repeat(41), data: null }, "*");
  parent.postMessage({ t: "event", name: "big", data: "d".repeat(2000) }, "*");
  parent.postMessage({ t: "buzz", seat: 9 }, "*");
  for (let i = 0; i < 5000; i++) parent.postMessage({ t: "event", name: "flood", data: i }, "*");
  for (let i = 0; i < 100; i++) egb.buzz(0);
  for (let i = 0; i < 100; i++) egb.station(1, "x".repeat(100));
  egb.end();
  egb.event("after the end");
});
`;

/** Each message here once crashed the kiosk's tab: its size was only looked at after the work on it. */
const CRUSHERS = `
window.addEventListener("load", () => {
  const text = "é".repeat(2 ** 28);
  parent.postMessage({ t: "station", seat: 0, text }, "*");
  parent.postMessage({ t: "event", name: "x", data: text }, "*");
  egb.event("still here");
  egb.end();
});
`;

/** Buffers: each is free to send, and each cost the kiosk seconds to list or stringify, so no rate ever dropped one. */
const BUFFERS = `
window.addEventListener("load", () => {
  for (let i = 0; i < 12; i++) {
    const data = new Uint8Array(2 ** 25);
    parent.postMessage(i % 2 ? { t: "event", name: "x", data } : data, "*", [data.buffer]);
  }
});
`;

const SAYS_ITS_MODE = `window.addEventListener("load", () => { egb.event("page", { mode: document.compatMode, first: document.scripts[0].getAttribute("src") }); egb.end(); });`;

/** Gives what a page set going the time to get there. */
const ENDS_SOON = `window.addEventListener("load", () => setTimeout(() => egb.end(), 500));`;

/** WebRTC over TCP to a TURN server at `address`: the one WebRTC route the kiosk's flags leave, and only to this machine. */
const turnTo = (address: string) => `
const peer = new RTCPeerConnection({ iceServers: [{ urls: "turn:${address}?transport=tcp", username: "x", credential: "y" }] });
peer.createDataChannel("x");
peer.createOffer().then((offer) => peer.setLocalDescription(offer));
`;

/** What a game can do: reads its players on its first line, loads its own files, hears a tap and answers. */
const GAME = `
const egb = window.egb;
const first = { egb: typeof egb, keys: Object.keys(egb).sort(), players: egb.players.map((p) => p.name), script: document.scripts[0].getAttribute("src") };
const violations = [];
document.addEventListener("securitypolicyviolation", (event) => violations.push(event.blockedURI + " " + event.effectiveDirective));
window.addEventListener("load", async () => {
  egb.event("first", first);
  egb.event("page", { mode: document.compatMode, lang: document.documentElement.lang, title: document.title, head: document.head.firstElementChild.getAttribute("src") });
  egb.event("own", {
    classic: window.ownClassic,
    module: window.ownModule,
    color: getComputedStyle(document.body).color,
    image: await loads(make("img", { src: "own.png" })).catch(() => "failed"),
    nested: await loads(make("img", { src: "art/own-art.png" })).catch(() => "failed"),
    data: await loads(make("img", { src: "data:image/png;base64,${PNG.toString("base64")}" })).catch(() => "failed"),
    font: await new FontFace("own", "url(own.woff2)").load().then(() => "loaded", () => "failed"),
    sound: await new Promise((yes) => {
      const audio = new Audio("own.mp3");
      audio.oncanplay = () => yes("loaded");
      audio.onerror = () => yes("failed");
    }),
  });
  egb.onTap((tap) => {
    egb.event("got-tap", tap);
    egb.station(1, "NICE");
    egb.buzz(1);
    egb.event("violations", violations);
    egb.end();
  });
  egb.event("want-tap");
});
`;

const page = (head: string) => `<!doctype html>\n<html lang="en"><head><title>probe</title>${head}</head><body></body></html>`;
const inline = (code: string) => `<script>${code}</script>`;
/** A page that says one thing, then goes to the URL this JavaScript expression makes. */
const leaves = (url: string) => page(inline(`window.addEventListener("load", () => { egb.event("before"); setTimeout(() => { location.href = ${url}; }); });`));
/** What a page that landed in the frame would want to say. */
const LANDED = `parent.postMessage({ t: "ready" }, "*"); parent.postMessage({ t: "event", name: "after", data: null }, "*"); parent.postMessage({ t: "end" }, "*");`;

/** A page that says ready by hand on its first line, as if it had loaded, and then does this. */
const vouches = (then: string) => page(inline(`parent.postMessage({ t: "ready" }, "*"); ${then}`));
/** The URL of a page that answers the kiosk as the host would, as a JavaScript expression. The kiosk's CSP keeps it out. */
const ANSWERS = `"data:text/html,<script>addEventListener('message', () => { " + ${JSON.stringify(LANDED)} + " });<" + "/script>"`;

const VOUCHERS: Readonly<Record<string, string>> = {
  "says ready, then leaves for its second page": `location.href = "second.html";`,
  "says ready, then leaves for the API": `location.href = "/api/state";`,
  "says ready, then leaves for a blank page": `location.href = "about:blank";`,
  "says ready, then leaves for a blob": `location.href = URL.createObjectURL(new Blob(["<p>here</p>"], { type: "text/html" }));`,
  "says ready, stops its own load, then leaves": `window.stop(); setTimeout(() => { location.href = "second.html"; }, 2000);`,
  "says ready, then reloads for ever": `location.reload();`,
};

const LEAVERS = [
  ...["for the outside", "by a meta refresh", "for a data page", "for the API", "for its second page", "by reloading", "for its second page before it has loaded", "for a page that answers, before it has loaded"].map((how) => `leaves ${how}`),
  ...Object.keys(VOUCHERS),
];

describe.skipIf(!CHROMIUM || !HERE)("a bundle's page in a real browser", () => {
  const servers: (http.Server | net.Server)[] = [];
  const bundles = new Map<string, { dir: string; files: ReadonlySet<string> }>();
  const scenarios: { id: string; hash: string; waits: boolean }[] = [];
  const reports = new Map<string, Report>();
  const outsideRequests: string[] = [];
  let outsideConnections = 0;
  let udpPackets = 0;
  const boxRequests: string[] = [];
  let routeRuns = 0;
  const localRequests: string[] = [];
  let localConnections = 0;
  let netLog = "";
  let chromium: ChildProcess | null = null;

  function listen(server: http.Server | net.Server, host: string): Promise<number> {
    servers.push(server);
    return new Promise((resolve) => server.listen(0, host, () => resolve((server.address() as AddressInfo).port)));
  }

  function reportOf(id: string): Report {
    const report = reports.get(id);
    if (!report) throw new Error(`no report from ${id}`);
    return report;
  }

  /** What a page said, by event name. */
  const events = (report: Report, name: string) => report.said.filter((s) => s.event === name).map((s) => s.data);

  beforeAll(async () => {
    const root = tempDir("egb-sandbox-");
    const bundle = (id: string, files: Record<string, string | Buffer>, waits = false) => {
      const hash = `0x${createHash("sha256").update(id).digest("hex")}`;
      const dir = path.join(root, hash);
      for (const [name, content] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        writeFileSync(path.join(dir, name), content);
      }
      bundles.set(hash, { dir, files: new Set(Object.keys(files)) });
      scenarios.push({ id, hash, waits });
      return dir;
    };

    const here = HERE ?? "";
    const outside = http.createServer((req, res) => {
      outsideRequests.push(req.url ?? "");
      res.writeHead(200, { "access-control-allow-origin": "*" }).end("leaked");
    });
    outside.on("connection", () => outsideConnections++);
    outside.on("upgrade", (req, socket) => {
      outsideRequests.push(`upgrade ${req.url ?? ""}`);
      socket.destroy();
    });
    const OUT = `http://${here}:${await listen(outside, here)}`;
    const udp = dgram.createSocket("udp4");
    udp.on("message", () => udpPackets++);
    await new Promise<void>((resolve) => udp.bind(0, here, resolve));
    const STUN = `${here}:${udp.address().port}`;
    const local = http.createServer((req, res) => {
      localRequests.push(req.url ?? "");
      res.end("heard");
    });
    const LOCAL = `http://127.0.0.1:${await listen(local, "127.0.0.1")}`;
    const turn = net.createServer((socket) => {
      localConnections++;
      socket.destroy();
    });
    const TURN = `127.0.0.1:${await listen(turn, "127.0.0.1")}`;

    const globals = inline(`const OUT = ${JSON.stringify(OUT)}, STUN = ${JSON.stringify(STUN)};${HARNESS}`);
    const gameDir = bundle("game", {
      "index.html": page(`${globals}${inline(GAME)}<link rel="stylesheet" href="own.css"><script src="own.js"></script><script type="module" src="own-module.js"></script>`),
      "own.css": "body { color: rgb(1, 2, 3); }",
      "own.js": "window.ownClassic = true;",
      "own-module.js": "window.ownModule = true;",
      "own.png": PNG,
      "art/own-art.png": PNG,
      "own.woff2": "",
      "own.mp3": "",
    });
    copyFileSync(file("../../../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2"), path.join(gameDir, "own.woff2"));
    copyFileSync(file("../../screen/sound/digital-dividend.mp3"), path.join(gameDir, "own.mp3"));
    bundle("walls", {
      "index.html": page(`<link rel="dns-prefetch" href="//canary-dns.example"><link rel="preconnect" href="https://canary-preconnect.example">${globals}${inline(WALLS)}`),
      "own.js": "1",
    });
    bundle("forgeries", { "index.html": page(inline(FORGERIES)) });
    bundle("crushers", { "index.html": page(inline(CRUSHERS)) });
    bundle("buffers", { "index.html": page(inline(BUFFERS)) });
    bundle("comment first", { "index.html": `<!-- Tap Rush -->\n${page(inline(SAYS_ITS_MODE))}` });
    // A page gets one prerender, so each knock is its own bundle.
    bundle("knocks on the API", { "index.html": page(`<link rel="prerender" href="/api/probe">${inline(ENDS_SOON)}`) });
    bundle("knocks on a local port", { "index.html": page(`<link rel="prerender" href="${LOCAL}/knock?secret=NOVA">${inline(`${turnTo(TURN)}${ENDS_SOON}`)}`) });
    bundle("leaves for the outside", { "index.html": leaves(JSON.stringify(`${OUT}/leave`)) });
    bundle("leaves by a meta refresh", { "index.html": page(`<meta http-equiv="refresh" content="1;url=${OUT}/refresh">`) });
    bundle("leaves for a data page", { "index.html": leaves(`"data:text/html,<script>" + ${JSON.stringify(LANDED)} + "<" + "/script>"`) });
    bundle("leaves for the API", { "index.html": leaves(`"/api/state"`) });
    bundle("leaves for its second page", { "index.html": leaves(`"second.html"`), "second.html": page(inline(LANDED)) });
    // The one page that can land in a frame is index.html itself, and a reloaded page is a second load all the same.
    bundle("leaves by reloading", {
      "index.html": page(inline(`if (window.name === "again") setInterval(() => { ${LANDED} }, 100); else window.addEventListener("load", () => { window.name = "again"; setTimeout(() => location.reload()); });`)),
    });
    // The frame's first `load` is then the landing page's, so the channel can't count it. A 404 never says ready.
    bundle("leaves for its second page before it has loaded", { "index.html": page(inline(`location.href = "second.html";`)), "second.html": page(inline(LANDED)) }, true);
    bundle("leaves for a page that answers, before it has loaded", { "index.html": page(inline(`location.href = ${ANSWERS};`)) }, true);
    // A `ready` said ahead of the frame's first `load` proves nothing: that load may be another page's, or never come.
    for (const [id, then] of Object.entries(VOUCHERS)) bundle(id, { "index.html": vouches(then), "second.html": page(inline(LANDED)) }, true);

    const screenDir = path.join(root, "screen");
    mkdirSync(screenDir);
    writeFileSync(path.join(screenDir, "index.html"), `<!doctype html><title>kiosk</title><script type="module" src="/kiosk.js"></script>`);
    await esbuild.build({
      entryPoints: [file("../../screen/frame/sandbox-kiosk.ts")],
      outfile: path.join(screenDir, "kiosk.js"),
      bundle: true,
      format: "esm",
      target: "es2023",
      platform: "browser",
      loader: { ".css": "empty" },
      logLevel: "silent",
    });

    let finished: () => void = () => {};
    const done = new Promise<void>((resolve) => (finished = resolve));
    const handler = createHandler({
      routes: [
        { method: "GET", path: "/api/scenarios", handle: (_req, res) => sendJson(res, scenarios) },
        {
          method: "GET",
          path: "/api/probe",
          handle: (_req, res) => {
            routeRuns++;
            sendJson(res, {});
          },
        },
        {
          method: "POST",
          path: "/api/report",
          handle: async (req, res) => {
            const report = (await readJson(req, 1024 * 1024)) as Report & { done?: true };
            if (report.done) finished();
            else reports.set(report.id, report);
            res.writeHead(204).end();
          },
        },
      ],
      games: createGameRoutes({ built: () => null, bundles: (hash) => bundles.get(hash) ?? null, assets: createFrameAssets(() => {}) }),
      screenDir,
      token: "the-kiosks-own-token",
      log: () => {},
    });
    const box = http.createServer((req, res) => {
      if (!req.url?.startsWith("/api/scenarios") && !req.url?.startsWith("/api/report")) boxRequests.push(req.url ?? "");
      handler(req, res);
    });
    const boxPort = await listen(box, "127.0.0.1");

    const logFile = path.join(root, "net.json");
    const browser = spawn(
      CHROMIUM ?? "",
      [
        ...headlessFlags(path.join(root, "profile")),
        `--log-net-log=${logFile}`,
        `http://127.0.0.1:${boxPort}/`,
      ],
      { stdio: "ignore" },
    );
    chromium = browser;
    const exited = new Promise<void>((resolve) => browser.once("exit", () => resolve()));
    void exited.then(finished);
    await done;
    browser.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    browser.kill("SIGKILL");
    udp.close();
    netLog = readFileSync(logFile, "utf8");
  }, 120_000);

  afterAll(() => {
    chromium?.kill("SIGKILL");
    for (const server of servers) {
      if (server instanceof http.Server) server.closeAllConnections();
      server.close();
    }
  });

  it("gives a game its players on its first line, the host ahead of all it wrote, and all its own files", () => {
    const report = reportOf("game");
    expect(events(report, "first")).toEqual([{ egb: "object", keys: ["buzz", "end", "event", "onTap", "players", "station"], players: ["NOVA", "ORION", null], script: "/bundle-host.js" }]);
    expect(events(report, "page")).toEqual([{ mode: "CSS1Compat", lang: "en", title: "probe", head: "/bundle-host.js" }]);
    expect(events(report, "own")).toEqual([{ classic: true, module: true, color: "rgb(1, 2, 3)", image: "loaded", nested: "loaded", data: "loaded", font: "loaded", sound: "loaded" }]);
    expect(events(report, "violations")).toEqual([[]]);
  });

  it("keeps a page out of quirks mode when a comment comes before its doctype, with the host still its first script", () => {
    expect(events(reportOf("comment first"), "page")).toEqual([{ mode: "CSS1Compat", first: "/bundle-host.js" }]);
  });

  it("carries a tap in, and a game's event, station line, buzz and end out", () => {
    const report = reportOf("game");
    expect(events(report, "got-tap")).toEqual([{ seat: 1, at: 1234, roll: 77 }]);
    expect(report.said).toContainEqual({ station: 1, text: "NICE" });
    expect(report.said).toContainEqual({ buzz: 1 });
    expect(report.end).toBe("game");
  });

  it("stops everything a page tries: nothing reaches the outside, by HTTP, TCP, UDP or DNS", () => {
    const results = Object.assign({}, ...events(reportOf("walls"), "results")) as Record<string, string>;
    expect(Object.keys(results).length).toBeGreaterThan(50);
    // Chromium fires `load` for a frame it blocked, and a nested frame runs under its parent's sandbox and CSP: neither
    // got anywhere, as the outside's own count below says.
    const open = Object.entries(results).filter(([, result]) => result.startsWith("open"));
    expect(open.map(([name]) => name).sort()).toEqual(["iframe out", "nested frame"]);
    expect(outsideRequests).toEqual([]);
    expect(outsideConnections).toBe(0);
    expect(udpPackets).toBe(0);
    // The page's hints are in the browser's log, and none of them became a lookup.
    expect(netLog).toContain("canary-preconnect.example");
    expect(netLog).not.toMatch(/"dns_query_types"[^\n]*canary-/);
  });

  it("gets no file of the Box's but its own, and runs no route", () => {
    const paths = new Set(boxRequests.map((url) => url.replace(/^\/store\/0x[0-9a-f]{64}\//, "/store/<hash>/")));
    const ownFiles = ["index.html", "own.css", "own.js", "own-module.js", "own.png", "art/own-art.png", "own.woff2", "own.mp3", "second.html"].map((name) => `/store/<hash>/${name}`);
    // /api/state is the frame leaving for it, and /api/probe its prerender: the Box hears them and refuses them.
    expect([...paths].sort()).toEqual([...ownFiles, "/", "/kiosk.js", "/favicon.ico", "/bundle-host.js", "/api/state", "/api/probe"].sort());
    expect(routeRuns).toBe(0);
  });

  it("can still knock on this machine's own ports, where the walls stop: one GET it can't read, and a connection", () => {
    expect(localRequests).toEqual(["/knock?secret=NOVA"]);
    expect(localConnections).toBeGreaterThan(0);
  });

  it("makes no tap and no command from anything a page posts, and holds a flood to its rates", () => {
    const report = reportOf("forgeries");
    expect(report.end).toBe("game");
    const words = new Set(report.said.map((s) => s.event ?? Object.keys(s)[0]));
    expect([...words].sort()).toEqual(["buzz", "flood", "station"]);
    const counts = (word: string) => report.said.filter((s) => (s.event ?? Object.keys(s)[0]) === word).length;
    expect(counts("flood")).toBeLessThanOrEqual(FRAME_LIMITS.eventBurst + FLOOD_SECONDS * FRAME_LIMITS.eventRate);
    expect(counts("buzz")).toBeLessThanOrEqual(FRAME_LIMITS.buzzBurst + FLOOD_SECONDS * FRAME_LIMITS.buzzRate);
    expect(counts("station")).toBeLessThanOrEqual(FRAME_LIMITS.stationBurst + FLOOD_SECONDS * FRAME_LIMITS.stationRate);
    expect(report.said.find((s) => "station" in s)?.text).toBe("x".repeat(SMALL_CHARS));
  });

  it("survives a message of any size, and hears the page go on after it", () => {
    const report = reportOf("crushers");
    expect(events(report, "still here")).toEqual([null]);
    expect(report.end).toBe("game");
    expect(report.stall).toBeLessThan(MOST_STALL_MS);
  });

  it("loses a page that keeps sending buffers, with the kiosk's thread still free", () => {
    const report = reportOf("buffers");
    expect(report.end).toBe("lost");
    expect(report.said).toEqual([]);
    expect(report.stall).toBeLessThan(MOST_STALL_MS);
  });

  it("hears nothing from a frame the page opened inside itself", () => {
    expect(events(reportOf("walls"), "nested")).toEqual([]);
  });

  it.each(LEAVERS)("loses a page that %s, and hears nothing more from it", (id) => {
    const report = reportOf(id);
    expect(report.end).toBe("lost");
    expect(report.said.filter((s) => s.event !== "before")).toEqual([]);
  });

  it("hears a page that leaves up to the moment it does", () => {
    expect(events(reportOf("leaves for the API"), "before")).toEqual([null]);
  });
});

describe("the Pi's kiosk", () => {
  it("starts Chromium behind the walls: without them a listed game reaches the network", () => {
    expect(kioskFlags()).toEqual(expect.arrayContaining(KIOSK_WALLS));
  });
});
