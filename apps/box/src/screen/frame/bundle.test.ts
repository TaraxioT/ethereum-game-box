// A store bundle's frame, both ends: what the kiosk's gate lets a page say and how much of it, the host's `window.egb`,
// and the kiosk's view of the match. server/games/sandbox.test.ts proves the walls in a real browser.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FRAME_LIMITS, LOG_LIMITS, SMALL_CHARS, type FromBundle } from "@egb/sdk";
import type { BoxEvent, BoxState } from "../../core/types.ts";
import type { Layout } from "../shell/layout.ts";
import type { ViewContext } from "../views/view.ts";
import { createBundleGate, parseFromBundle } from "./bundle-gate.ts";
import { createBundleRuntime } from "./bundle-runtime.ts";
import { bundleFrameView, type BundlePowers, type BundleSource } from "./bundle-view.ts";
import { bundleFrameAttributes, parseFromFrame } from "./channel.ts";
import { MAX_ERRORS } from "./runtime.ts";
import { READY_TIMEOUT_MS } from "./view.ts";

const HASH = `0x${"ab".repeat(32)}`;
const PLAYERS = [{ name: "NOVA" }, { name: "ORION" }, { name: null }];

describe("a bundle's iframe", () => {
  it("is as sandboxed as a built game's, on its own page, with the players in its name", () => {
    const attrs = bundleFrameAttributes(HASH, "Tap Rush", PLAYERS);
    expect(attrs.sandbox).toBe("allow-scripts");
    expect(Object.values(attrs).join(" ")).not.toMatch(/allow-same-origin|allow-top-navigation|allow-popups|allow-forms|allow-modals/);
    expect(attrs).toMatchObject({ allow: "", referrerpolicy: "no-referrer", title: "Tap Rush", src: `/store/${HASH}/index.html` });
    expect(JSON.parse(attrs.name ?? "")).toEqual(PLAYERS);
    expect(Object.keys(attrs)[0]).toBe("sandbox");
    expect(Object.keys(attrs).at(-1)).toBe("src");
  });
});

describe("what a bundle's page may say", () => {
  const parse = (data: unknown) => parseFromBundle(data, 3);

  it("takes ready, error, event, station, buzz and end, and only those", () => {
    expect(parse({ t: "ready" })).toEqual({ t: "ready" });
    expect(parse({ t: "error", message: "x".repeat(500) })).toEqual({ t: "error", message: "x".repeat(300) });
    expect(parse({ t: "event", name: "score", data: { p: [1, 2] } })).toEqual({ t: "event", name: "score", data: { p: [1, 2] } });
    expect(parse({ t: "event", name: "start", data: null })).toEqual({ t: "event", name: "start", data: null });
    expect(parse({ t: "station", seat: 2, text: "GO" })).toEqual({ t: "station", seat: 2, text: "GO" });
    expect(parse({ t: "buzz", seat: 0 })).toEqual({ t: "buzz", seat: 0 });
    expect(parse({ t: "end" })).toEqual({ t: "end" });
  });

  it("has no word for a tap, a badge, the network or money", () => {
    for (const t of ["tap", "touch", "badge", "read", "sign", "stake", "pay", "settle", "refund", "fetch", "command", "bundle-init", "init", "update"]) {
      expect(parse({ t })).toBeNull();
      expect(parse({ t, seat: 0, at: 1, roll: null })).toBeNull();
    }
    for (const bad of [null, "end", 3, [], {}, [{ t: "end" }]]) expect(parse(bad)).toBeNull();
  });

  it("refuses extra fields, seats that aren't the match's, and events past the log's caps", () => {
    const name = "n".repeat(LOG_LIMITS.eventName);
    const fits = "d".repeat(LOG_LIMITS.eventDataBytes - 2); // a JSON string's two quotes
    for (const bad of [
      { t: "end", why: "game" },
      { t: "ready", at: 1 },
      { t: "buzz" },
      { t: "buzz", seat: 3 },
      { t: "buzz", seat: -1 },
      { t: "buzz", seat: 1.5 },
      { t: "buzz", seat: "0" },
      { t: "buzz", seat: 0, strength: 9 },
      { t: "station", seat: 3, text: "x" },
      { t: "station", seat: 0, text: 5 },
      { t: "station", seat: 0, text: "x", big: "y" },
      { t: "event", name: "", data: null },
      { t: "event", name: 1, data: null },
      { t: "event", name: `${name}n`, data: null },
      { t: "event", name: "new\nline", data: null },
      { t: "event", name: "naïve", data: null },
      { t: "event", name: "x" },
      { t: "event", name: "x", data: undefined },
      { t: "event", name: "x", data: 1n },
      { t: "event", name: "x", data: `${fits}d` },
      { t: "event", name: "x", data: `${fits.slice(1)}é` }, // one character over in bytes, not in length
      { t: "event", name: "x", data: null, at: 1 },
    ]) {
      expect(parse(bad), JSON.stringify(bad, (_k, v: unknown) => (typeof v === "bigint" ? "bigint" : v))).toBeNull();
    }
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(parse({ t: "event", name: "x", data: cycle })).toBeNull();
    expect(parse({ t: "event", name, data: fits })).toEqual({ t: "event", name, data: fits });
  });

  it("hands on plain JSON only, and a station's text as a station can draw it", () => {
    const when = new Date(0);
    expect(parse({ t: "event", name: "x", data: { when, nothing: undefined, map: new Map([[1, 2]]) } })).toEqual({ t: "event", name: "x", data: { when: when.toISOString(), map: {} } });
    expect(parse({ t: "station", seat: 0, text: "é".repeat(50) })).toEqual({ t: "station", seat: 0, text: "?".repeat(SMALL_CHARS) });
  });

  it("gives a built game's frame none of it", () => {
    for (const message of [{ t: "event", name: "x", data: null }, { t: "station", seat: 0, text: "x" }, { t: "buzz", seat: 0 }, { t: "end" }]) {
      expect(parseFromFrame(message)).toBeNull();
    }
  });
});

describe("the kiosk's gate", () => {
  function gate(seats = 2) {
    let ms = 0;
    const admit = createBundleGate(seats, () => ms);
    const count = (message: unknown, times: number) => Array.from({ length: times }, () => admit(message)).filter(Boolean).length;
    return { admit, count, pass: (more: number) => void (ms += more) };
  }

  it("holds each page to its rates, and refills them with time", () => {
    const g = gate();
    const event = { t: "event", name: "x", data: null };
    expect(g.count(event, 100)).toBe(FRAME_LIMITS.eventBurst);
    g.pass(1000);
    expect(g.count(event, 100)).toBe(FRAME_LIMITS.eventRate);
    expect(g.count({ t: "buzz", seat: 0 }, 10)).toBe(FRAME_LIMITS.buzzBurst);
    expect(g.count({ t: "station", seat: 0, text: "x" }, 10)).toBe(FRAME_LIMITS.stationBurst);
    g.pass(1000);
    expect(g.count({ t: "buzz", seat: 0 }, 10)).toBe(FRAME_LIMITS.buzzRate);
  });

  it("counts stations and buzzes per seat", () => {
    const g = gate();
    expect(g.count({ t: "buzz", seat: 0 }, 10)).toBe(FRAME_LIMITS.buzzBurst);
    expect(g.count({ t: "buzz", seat: 1 }, 10)).toBe(FRAME_LIMITS.buzzBurst);
    expect(g.count({ t: "station", seat: 1, text: "x" }, 10)).toBe(FRAME_LIMITS.stationBurst);
  });

  it("charges a flood of bad events to the same rate", () => {
    const g = gate();
    expect(g.count({ t: "event", name: "", data: null }, FRAME_LIMITS.eventBurst)).toBe(0);
    expect(g.admit({ t: "event", name: "x", data: null })).toBeNull();
  });

  it("stops game events at their share of the log, by entries and by bytes", () => {
    const small = gate();
    let passed = 0;
    for (let s = 0; s < 400; s++) {
      passed += small.count({ t: "event", name: "x", data: null }, FRAME_LIMITS.eventRate);
      small.pass(1000);
    }
    expect(passed).toBe(FRAME_LIMITS.eventEntries);

    const large = gate();
    let bytes = 0;
    const data = "d".repeat(LOG_LIMITS.eventDataBytes - 2);
    for (let s = 0; s < 100; s++) {
      bytes += large.count({ t: "event", name: "x", data }, FRAME_LIMITS.eventRate) * LOG_LIMITS.eventDataBytes;
      large.pass(1000);
    }
    expect(bytes).toBeLessThanOrEqual(FRAME_LIMITS.eventBytes);
    expect(bytes).toBeGreaterThan(FRAME_LIMITS.eventBytes * 0.9);
  });

  it("takes one ready and at most MAX_ERRORS errors", () => {
    const g = gate();
    expect(g.count({ t: "ready" }, 5)).toBe(1);
    expect(g.count({ t: "error", message: "x" }, 50)).toBe(MAX_ERRORS);
  });

  it("hears nothing after the game's end", () => {
    const g = gate();
    expect(g.admit({ t: "end" })).toEqual({ t: "end" });
    for (const message of [{ t: "end" }, { t: "event", name: "x", data: null }, { t: "buzz", seat: 0 }, { t: "error", message: "x" }, { t: "ready" }]) {
      expect(g.admit(message)).toBeNull();
    }
  });
});

describe("window.egb", () => {
  function page(name = JSON.stringify(PLAYERS)) {
    const posted: FromBundle[] = [];
    return { runtime: createBundleRuntime({ post: (m) => posted.push(m), name }), posted };
  }

  it("has the players from the first line, and takes the kiosk's newer names in the same array", () => {
    const { runtime } = page();
    const { players } = runtime.egb;
    expect(players).toEqual(PLAYERS);
    runtime.receive({ t: "bundle-init", players: [{ name: "nova.eth" }, { name: "ORION" }] });
    expect(players).toEqual([{ name: "nova.eth" }, { name: "ORION" }]);
  });

  it("starts with no players when the frame's name isn't theirs", () => {
    expect(page("").runtime.egb.players).toEqual([]);
    expect(page("{}").runtime.egb.players).toEqual([]);
  });

  it("works when its functions are taken off it, and says what the game does", () => {
    const { runtime, posted } = page();
    const { event, station, buzz, end } = runtime.egb;
    event("score", { n: 1 });
    event("start");
    station(1, "GO");
    buzz(0);
    end();
    runtime.ready();
    expect(posted).toEqual([{ t: "event", name: "score", data: { n: 1 } }, { t: "event", name: "start", data: null }, { t: "station", seat: 1, text: "GO" }, { t: "buzz", seat: 0 }, { t: "end" }, { t: "ready" }]);
  });

  it("hands each tap to every listener, with only its seat, time and roll", () => {
    const { runtime } = page();
    const first = vi.fn();
    const second = vi.fn();
    runtime.egb.onTap(first);
    runtime.egb.onTap(second);
    runtime.receive({ t: "tap", seat: 1, at: 5, roll: 77 });
    expect(first).toHaveBeenCalledWith({ seat: 1, at: 5, roll: 77 });
    expect(second).toHaveBeenCalledWith({ seat: 1, at: 5, roll: 77 });
  });

  it("ignores anything else the kiosk's window could say", () => {
    const { runtime } = page();
    const listener = vi.fn();
    runtime.egb.onTap(listener);
    for (const stray of [null, "tap", { t: "tap" }, { t: "tap", seat: "1", at: 1 }, { t: "bundle-init" }, { t: "init" }, { t: "update" }]) runtime.receive(stray);
    expect(listener).not.toHaveBeenCalled();
    expect(runtime.egb.players).toEqual(PLAYERS);
  });

  it("reports a listener that throws, keeps calling the others, and stops at MAX_ERRORS", () => {
    const { runtime, posted } = page();
    const after = vi.fn();
    runtime.egb.onTap(() => {
      throw new TypeError("no score");
    });
    runtime.egb.onTap(after);
    for (let i = 0; i < 20; i++) runtime.receive({ t: "tap", seat: 0, at: i, roll: null });
    expect(after).toHaveBeenCalledTimes(20);
    expect(posted).toHaveLength(MAX_ERRORS);
    expect(posted[0]).toEqual({ t: "error", message: "TypeError: no score" });
  });
});

describe("the kiosk's view of a store match", () => {
  const LAYOUT = { orientation: "landscape", width: 1280, height: 800 } as unknown as Layout;
  const FRAME_WINDOW = { postMessage: vi.fn() };
  const state = {} as BoxState;
  const TAP: BoxEvent = { type: "tap", seat: 1, accepted: true, meaning: "play" };

  /** Just enough DOM for `frameGlass`: the iframe keeps its attributes and its `load` listener. */
  function stage() {
    const attributes: Record<string, string> = {};
    let onMessage: ((event: unknown) => void) | null = null;
    let onLoad: (() => void) | null = null;
    const frame = {
      contentWindow: FRAME_WINDOW,
      setAttribute: (name: string, value: string) => void (attributes[name] = value),
      addEventListener: (_type: string, fn: () => void) => void (onLoad = fn),
      removeEventListener: () => void (onLoad = null),
      remove: vi.fn(),
    };
    const box = { style: {}, append: vi.fn() };
    vi.stubGlobal("document", { createElement: (tag: string) => (tag === "iframe" ? frame : box) });
    vi.stubGlobal("window", {
      addEventListener: (_type: string, fn: (event: unknown) => void) => void (onMessage = fn),
      removeEventListener: () => void (onMessage = null),
    });
    return {
      attributes,
      frame,
      box,
      load: () => onLoad?.(),
      say: (data: unknown) => onMessage?.({ data, source: FRAME_WINDOW, origin: "null" }),
    };
  }

  function play(source: Partial<BundleSource> = {}) {
    const s = stage();
    const powers: BundlePowers = { event: vi.fn(), station: vi.fn(), buzz: vi.fn(), end: vi.fn() };
    const fullSource: BundleSource = { match: () => ({ hash: HASH, title: "Tap Rush", players: PLAYERS }), tap: () => ({ seat: 1, at: 7, roll: null }), ...source };
    const ctx = { layout: LAYOUT, link: { state: () => state } } as unknown as ViewContext;
    return { ...s, powers, view: bundleFrameView(fullSource, () => powers)(ctx) };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    FRAME_WINDOW.postMessage.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads the bundle's page sandboxed, sends bundle-init on ready, and then each tap", () => {
    const m = play();
    expect(m.attributes).toMatchObject({ sandbox: "allow-scripts", src: `/store/${HASH}/index.html` });
    m.view.update(state, TAP); // before ready: the page can't hear it yet
    expect(FRAME_WINDOW.postMessage).not.toHaveBeenCalled();
    m.say({ t: "ready" });
    expect(FRAME_WINDOW.postMessage).toHaveBeenCalledWith({ t: "bundle-init", players: PLAYERS }, "*");
    m.view.update(state, TAP);
    expect(FRAME_WINDOW.postMessage).toHaveBeenLastCalledWith({ t: "tap", seat: 1, at: 7, roll: null }, "*");
    expect(FRAME_WINDOW.postMessage).toHaveBeenCalledTimes(2);
  });

  it("tells the page nothing for the Box's other moments", () => {
    const m = play({ tap: () => null });
    m.say({ t: "ready" });
    m.view.update(state, { type: "gas", gwei: 2 });
    expect(FRAME_WINDOW.postMessage).toHaveBeenCalledTimes(1);
  });

  it("passes on only what the gate lets through", () => {
    const m = play();
    m.say({ t: "ready" });
    m.say({ t: "event", name: "score", data: { n: 1 } });
    m.say({ t: "station", seat: 2, text: "GO" });
    m.say({ t: "buzz", seat: 1 });
    m.say({ t: "buzz", seat: 9 });
    m.say({ t: "tap", seat: 0, at: 1, roll: null });
    expect(m.powers.event).toHaveBeenCalledWith("score", { n: 1 });
    expect(m.powers.station).toHaveBeenCalledWith(2, "GO");
    expect(m.powers.buzz).toHaveBeenCalledTimes(1);
    expect(m.powers.buzz).toHaveBeenCalledWith(1);
  });

  it("ends the match once when the game says so", () => {
    const m = play();
    m.say({ t: "ready" });
    m.say({ t: "end" });
    m.say({ t: "end" });
    expect(m.powers.end).toHaveBeenCalledTimes(1);
    expect(m.powers.end).toHaveBeenCalledWith("game");
    m.load();
    m.load(); // the game left after its end: the frame goes, but the match already ended
    expect(m.powers.end).toHaveBeenCalledTimes(1);
    expect(m.frame.remove).toHaveBeenCalled();
  });

  it("plays on past a stray error: the plate shows, the taps still count", () => {
    const m = play();
    m.say({ t: "ready" });
    m.say({ t: "error", message: "TypeError: x" });
    expect(m.box.append).toHaveBeenCalledTimes(2); // the frame, then the plate
    expect(m.powers.end).not.toHaveBeenCalled();
    m.view.update(state, TAP);
    expect(FRAME_WINDOW.postMessage).toHaveBeenLastCalledWith({ t: "tap", seat: 1, at: 7, roll: null }, "*");
  });

  it("loses a page that never says ready, and hears nothing from it after", () => {
    const m = play();
    vi.advanceTimersByTime(READY_TIMEOUT_MS - 1);
    expect(m.powers.end).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(m.powers.end).toHaveBeenCalledWith("lost");
    expect(m.frame.remove).toHaveBeenCalled();
    m.say({ t: "ready" });
    expect(FRAME_WINDOW.postMessage).not.toHaveBeenCalled();
  });

  it("loses a page that navigates: the second load closes the channel for good", () => {
    const m = play();
    m.load();
    m.say({ t: "ready" });
    m.load();
    expect(m.powers.end).toHaveBeenCalledWith("lost");
    expect(m.frame.remove).toHaveBeenCalled();
    m.say({ t: "event", name: "score", data: 1 });
    m.view.update(state, TAP);
    expect(m.powers.event).not.toHaveBeenCalled();
    expect(FRAME_WINDOW.postMessage).toHaveBeenCalledTimes(1);
  });

  it("doesn't lose a match when the view leaves", () => {
    const m = play();
    m.view.dispose?.();
    vi.advanceTimersByTime(READY_TIMEOUT_MS);
    expect(m.powers.end).not.toHaveBeenCalled();
    expect(m.frame.remove).toHaveBeenCalled();
  });

  it("does nothing when no store match plays", () => {
    const m = play({ match: () => null });
    expect(m.attributes).toEqual({});
    vi.advanceTimersByTime(READY_TIMEOUT_MS);
    expect(m.powers.end).not.toHaveBeenCalled();
  });
});
