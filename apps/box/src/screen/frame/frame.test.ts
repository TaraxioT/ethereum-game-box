// The frame's refusals and its channel, both ends: the iframe's sandbox, what the kiosk accepts back, the frame
// runtime's handling of the game's screen, and what the kiosk tells the frame.
import { describe, expect, it, vi } from "vitest";
import type { FromFrame, GameManifest, ToFrame } from "@egb/sdk";
import type { BoxEvent, BoxState } from "../../core/types.ts";
import { frameAttributes, openFrameChannel, parseFromFrame, type FrameElement, type Incoming, type MessageHost } from "./channel.ts";
import { frameEvent, frameInit, frameUpdate, type FrameMatch } from "./feed.ts";
import { createFrameRuntime, MAX_ERRORS } from "./runtime.ts";

const MANIFEST: GameManifest = { id: "tap-three", title: "Tap Three", blurb: "Tap.", players: 2, minutes: 1, stakes: [1], tier: "refereed", taps: "identify", kind: "built", budgetMs: 50 };

describe("the frame's iframe", () => {
  it("runs scripts and nothing else: no same-origin, no features, no referrer; the sandbox is set before the src", () => {
    const attrs = frameAttributes("tap-three", "Tap Three");
    expect(attrs.sandbox).toBe("allow-scripts");
    expect(Object.values(attrs).join(" ")).not.toMatch(/allow-same-origin|allow-top-navigation|allow-popups|allow-forms|allow-modals/);
    expect(attrs).toMatchObject({ allow: "", referrerpolicy: "no-referrer", src: "/games/tap-three/frame.html" });
    expect(Object.keys(attrs)[0]).toBe("sandbox");
    expect(Object.keys(attrs).at(-1)).toBe("src");
    expect(frameAttributes("../api", "x").src).toBe("/games/..%2Fapi/frame.html");
  });
});

describe("the kiosk's end of the channel", () => {
  it("accepts only ready and error, with a short message", () => {
    expect(parseFromFrame({ t: "ready" })).toEqual({ t: "ready" });
    expect(parseFromFrame({ t: "error", message: "x".repeat(500) })).toEqual({ t: "error", message: "x".repeat(300) });
    for (const bad of [null, "ready", { t: "ready", extra: 1 }, { t: "error" }, { t: "error", message: 3 }, { t: "command", command: { type: "play" } }, { t: "init" }, []]) {
      expect(parseFromFrame(bad)).toBeNull();
    }
  });

  function harness() {
    let listener: ((event: Incoming) => void) | null = null;
    const host: MessageHost = {
      addEventListener: (_type, fn) => void (listener = fn),
      removeEventListener: (_type, fn) => void (listener === fn && (listener = null)),
    };
    const frameWindow = { postMessage: vi.fn() } as unknown as Window;
    let onLoad: (() => void) | null = null;
    const frame: FrameElement = {
      contentWindow: frameWindow,
      addEventListener: (_type, fn) => void (onLoad = fn),
      removeEventListener: (_type, fn) => void (onLoad === fn && (onLoad = null)),
    };
    const received: FromFrame[] = [];
    let left = 0;
    const channel = openFrameChannel(host, frame, { message: (m) => received.push(m), left: () => left++ });
    const deliver = (data: unknown, source: unknown = frameWindow, origin = "null") => listener?.({ data, source: source as MessageEventSource, origin });
    return { channel, frameWindow, received, deliver, load: () => onLoad?.(), left: () => left, listening: () => listener !== null || onLoad !== null };
  }

  it("hears only its own frame, from an opaque origin", () => {
    const h = harness();
    h.deliver({ t: "ready" });
    h.deliver({ t: "ready" }, {}); // another window
    h.deliver({ t: "ready" }, h.frameWindow, "http://127.0.0.1:8790"); // a frame that has its origin back
    h.deliver({ t: "ready" }, null, "null");
    h.deliver({ t: "command", command: { type: "play" } });
    h.deliver({ t: "error", message: "TypeError: x is undefined" });
    expect(h.received).toEqual([{ t: "ready" }, { t: "error", message: "TypeError: x is undefined" }]);
  });

  it("posts with targetOrigin * (no origin names an opaque frame) and stops listening when disposed", () => {
    const h = harness();
    const update: ToFrame = { t: "update", state: { n: 1 }, event: { type: "step" }, now: 5 };
    h.channel.post(update);
    expect(h.frameWindow.postMessage).toHaveBeenCalledWith(update, "*");
    h.channel.dispose();
    expect(h.listening()).toBe(false);
    h.channel.post(update);
    expect(h.frameWindow.postMessage).toHaveBeenCalledTimes(1);
  });

  it("closes for good when the frame loads a second page: nothing more goes out or comes in", () => {
    const h = harness();
    h.load(); // the frame's own page
    h.deliver({ t: "ready" });
    const update: ToFrame = { t: "update", state: { n: 1 }, event: { type: "step" }, now: 5 };
    h.channel.post(update);
    expect(h.left()).toBe(0);
    h.load(); // the frame navigated itself
    expect(h.left()).toBe(1);
    expect(h.listening()).toBe(false);
    h.channel.post(update);
    h.deliver({ t: "ready" });
    expect(h.frameWindow.postMessage).toHaveBeenCalledTimes(1);
    expect(h.received).toEqual([{ t: "ready" }]);
  });
});

describe("the frame runtime", () => {
  const INIT: ToFrame = { t: "init", manifest: MANIFEST, seats: [{ name: "NOVA" }, { name: null }], state: { n: 0 }, now: 1, calm: false };
  const UPDATE: ToFrame = { t: "update", state: { n: 1 }, event: { type: "tap", seat: 0 }, now: 2 };

  function frame(screen: unknown) {
    const posted: FromFrame[] = [];
    const root = { replaceChildren: vi.fn() } as unknown as HTMLElement;
    const runtime = createFrameRuntime({ root, post: (m) => posted.push(m), load: async () => ({ default: screen }) });
    return { runtime, posted, root };
  }

  it("says ready once screen.js has loaded, mounts on init and hands each update to the game", async () => {
    const updates: unknown[] = [];
    const mount = vi.fn(() => ({ update: (m: unknown) => updates.push(m) }));
    const { runtime, posted, root } = frame({ mount });
    runtime.receive(INIT); // before ready: the screen isn't loaded, nothing happens
    expect(mount).not.toHaveBeenCalled();
    await runtime.start();
    expect(posted).toEqual([{ t: "ready" }]);
    runtime.receive(UPDATE); // before init: nothing mounted yet
    runtime.receive(INIT);
    expect(mount).toHaveBeenCalledWith(root, INIT);
    runtime.receive(UPDATE);
    runtime.receive({ t: "update" }); // not a ToFrame
    runtime.receive({ t: "eval", code: "1" });
    expect(updates).toEqual([UPDATE]);
    runtime.receive(INIT); // the kiosk's view came back: draw from scratch
    expect(root.replaceChildren).toHaveBeenCalledTimes(2);
    expect(mount).toHaveBeenCalledTimes(2);
  });

  it("reports a screen that won't load or throws, as errors only, and at most MAX_ERRORS of them", async () => {
    const missing = frame({ draw() {} });
    await missing.runtime.start();
    expect(missing.posted).toEqual([{ t: "error", message: "Error: screen.js must default-export a GameScreen { mount }" }]);

    const throwing = frame({
      mount: () => ({
        update: () => {
          throw new TypeError("state.board is undefined");
        },
      }),
    });
    await throwing.runtime.start();
    throwing.runtime.receive(INIT);
    for (let i = 0; i < 20; i++) throwing.runtime.receive(UPDATE);
    expect(throwing.posted[0]).toEqual({ t: "ready" });
    expect(throwing.posted.slice(1)).toHaveLength(MAX_ERRORS);
    expect(throwing.posted[1]).toEqual({ t: "error", message: "TypeError: state.board is undefined" });
    expect(new Set(throwing.posted.map((m) => m.t))).toEqual(new Set(["ready", "error"]));
  });
});

describe("what the kiosk tells the frame", () => {
  const state = { seats: [{ badge: { name: "nova.gamebox.eth", address: "0x1" } }, { badge: null }] } as unknown as BoxState;
  const match = (s: unknown, over = false): FrameMatch => ({ id: "tap-three", manifest: MANIFEST, state: s, over });
  const tick: BoxEvent = { type: "block", block: 3 };

  it("starts the frame with the manifest, the seats' names, the state and the Box's clock", () => {
    expect(frameInit(match({ n: 0 }), state, 42, true)).toEqual({ t: "init", manifest: MANIFEST, seats: [{ name: "NOVA" }, { name: null }], state: { n: 0 }, now: 42, calm: true });
  });

  it("names the moment: the end, an accepted tap, a new state; nothing for the Box's own business", () => {
    const a = match({ n: 0 });
    const b = match({ n: 1 });
    expect(frameEvent(a, match({ n: 1 }, true), tick)).toEqual({ type: "over" });
    expect(frameEvent(a, b, { type: "tap", seat: 1, accepted: true })).toEqual({ type: "tap", seat: 1 });
    expect(frameEvent(a, b, { type: "tap", seat: 1, accepted: false })).toEqual({ type: "step" });
    expect(frameEvent(a, b, { type: "game" })).toEqual({ type: "step" });
    expect(frameEvent(a, a, tick)).toBeNull();
    expect(frameUpdate(a, a, { type: "gas", gwei: 2 }, 9)).toBeNull();
    expect(frameUpdate(a, b, { type: "game" }, 9)).toEqual({ t: "update", state: { n: 1 }, event: { type: "step" }, now: 9 });
  });
});
