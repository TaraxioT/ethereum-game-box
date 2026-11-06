import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { BoxEvent, BoxLink, BoxState, ScreenCommand } from "../core/types.ts";
import type { LinkDown } from "../core/wire.ts";
import { LINK_COALESCE_MS } from "../core/wire.ts";
import { attachLink, parseCommand } from "./link.ts";
import { openScreen, post, startTestBox, type TestBox, type TestScreen } from "./testing.ts";

const NOVA = { address: `0x${"ab".repeat(20)}`, name: "NOVA" };

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const clean of cleanups.splice(0).reverse()) await clean();
});

async function boxWithScreen(): Promise<{ tb: TestBox; screen: TestScreen }> {
  const tb = await startTestBox();
  cleanups.push(() => tb.stop());
  const screen = await openScreen(tb.box);
  cleanups.push(() => screen.close());
  return { tb, screen };
}

const events = (messages: readonly LinkDown[]): BoxEvent[] => messages.flatMap((m) => (m.t === "event" ? [m.event] : []));

describe("the screen's link", () => {
  it("sends a newcomer the whole state first, with the Box's clock", async () => {
    const { tb, screen } = await boxWithScreen();
    const first = await screen.next(() => true);
    expect(first).toEqual({ t: "state", now: tb.box.core.now(), state: tb.box.core.state() });
  });

  it("sends every event in order, each with the state after it", async () => {
    const { tb, screen } = await boxWithScreen();
    await screen.next(() => true);
    const heard: BoxEvent[] = [];
    tb.box.core.subscribe((_, event) => heard.push(event));
    screen.send({ type: "booted" });
    await screen.next((m) => m.t === "event" && m.event.type === "phase");
    expect((await post(tb.box, "/api/taps/inject", { seat: 0, badge: NOVA.address })).status).toBe(200);
    tb.advance(13_000);
    await screen.next(() => events(screen.messages).length >= heard.length);
    expect(events(screen.messages)).toEqual(heard);
    expect(screen.messages.at(-1)?.state).toEqual(tb.box.core.state());
    expect(events(screen.messages).map((e) => e.type)).toEqual(expect.arrayContaining(["phase", "tap", "buzz", "block"]));
  });

  it("takes the screen's commands to the core, and ignores anything that isn't one", async () => {
    const { tb, screen } = await boxWithScreen();
    await screen.next(() => true);
    screen.send({ type: "explode" } as unknown as ScreenCommand);
    screen.send({ type: "booted" });
    await screen.next((m) => m.t === "event" && m.event.type === "phase");
    expect(tb.box.core.state().phase).toBe("attract");
  });

  it("carries every command the screen can send", () => {
    // Keyed by type: a new ScreenCommand that isn't listed here fails the typecheck, and one the link drops fails here.
    const every: { readonly [K in ScreenCommand["type"]]: Extract<ScreenCommand, { type: K }> } = {
      booted: { type: "booted" },
      start: { type: "start" },
      focus: { type: "focus", game: "stock-duel" },
      play: { type: "play" },
      stake: { type: "stake", amount: 10 },
      back: { type: "back" },
      rematch: { type: "rematch" },
      home: { type: "home" },
      refund: { type: "refund" },
      build: { type: "build" },
      lobby: { type: "lobby" },
      topup: { type: "topup" },
      propose: { type: "propose" },
      claim: { type: "claim" },
    };
    for (const command of Object.values(every)) expect(parseCommand(JSON.stringify({ t: "command", command }))).toEqual(command);
  });

  it("reads commands strictly", () => {
    expect(parseCommand(JSON.stringify({ t: "command", command: { type: "focus", game: "quick-draw" } }))).toEqual({ type: "focus", game: "quick-draw" });
    expect(parseCommand(JSON.stringify({ t: "command", command: { type: "stake", amount: 25, extra: 1 } }))).toEqual({ type: "stake", amount: 25 });
    expect(parseCommand(JSON.stringify({ t: "command", command: { type: "stake", amount: "25" } }))).toBeNull();
    expect(parseCommand(JSON.stringify({ t: "command", command: { type: "focus" } }))).toBeNull();
    expect(parseCommand(JSON.stringify({ t: "nope", command: { type: "play" } }))).toBeNull();
    expect(parseCommand("not json")).toBeNull();
  });

  it("coalesces state-only changes at 100 ms, and never holds back an event", async () => {
    // A Box whose changes the test makes by hand.
    let state = { phase: "home", n: 0 } as unknown as BoxState;
    const listeners = new Set<(state: BoxState, event: BoxEvent) => void>();
    const box: BoxLink = {
      state: () => state,
      now: () => 42,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      send() {},
    };
    const change = (event: BoxEvent): void => {
      state = { ...state, n: (state as unknown as { n: number }).n + 1 } as unknown as BoxState;
      for (const listener of listeners) listener(state, event);
    };
    const server = http.createServer();
    const link = attachLink(server, box, () => {});
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(async () => {
      link.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const address = server.address() as { port: number };
    const screen = await openScreen({ url: `http://127.0.0.1:${address.port}` } as Parameters<typeof openScreen>[0]);
    cleanups.push(() => screen.close());
    await screen.next(() => true);

    const started = Date.now();
    for (let i = 0; i < 50; i++) change({ type: "stations" });
    const n = (m: LinkDown) => (m.state as unknown as { n: number }).n;
    await screen.next((m) => m.t === "state" && n(m) === 50, 1);
    await new Promise((resolve) => setTimeout(resolve, LINK_COALESCE_MS * 2));
    const states = screen.messages.slice(1).filter((m) => m.t === "state");
    expect(states.length).toBeLessThanOrEqual(2);
    expect(Date.now() - started).toBeLessThan(1_000);

    // A state-only change waiting to go out is folded into the next event, which goes out at once.
    const from = screen.messages.length;
    change({ type: "stations" });
    change({ type: "gas", gwei: 2 });
    for (let i = 0; i < 5; i++) change({ type: "cue", cue: "step", seat: 0 });
    await screen.next((m) => n(m) === 57, from);
    await new Promise((resolve) => setTimeout(resolve, LINK_COALESCE_MS * 2));
    expect(screen.messages.slice(from).map((m) => [m.t, n(m)])).toEqual([
      ["event", 52],
      ["event", 53],
      ["event", 54],
      ["event", 55],
      ["event", 56],
      ["event", 57],
    ]);
    expect(screen.messages.every((m) => m.now === 42)).toBe(true);
  });
});
