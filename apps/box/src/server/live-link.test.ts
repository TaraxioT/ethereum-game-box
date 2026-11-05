// The screen's LiveLink against a real Box server, over Node's own WebSocket (the browser's API).
import { afterEach, describe, expect, it } from "vitest";
import type { BoxEvent, BoxState } from "../core/types.ts";
import { LINK_PATH } from "../core/wire.ts";
import { connectLive, type LiveLink } from "../screen/link/live.ts";
import { post, startTestBox, type TestBox } from "./testing.ts";

const NOVA = { address: `0x${"a1".repeat(20)}`, name: "NOVA" };

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const clean of cleanups.splice(0).reverse()) await clean();
});

async function wait(check: () => boolean, ms = 3_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function live(tb: TestBox): Promise<{ link: LiveLink; heard: [BoxState, BoxEvent][] }> {
  const link = await connectLive({ url: `ws://127.0.0.1:${tb.box.port}${LINK_PATH}` });
  cleanups.push(() => link.close());
  const heard: [BoxState, BoxEvent][] = [];
  link.subscribe((state, event) => heard.push([state, event]));
  return { link, heard };
}

describe("LiveLink", () => {
  it("starts from the Box's whole state, and reads the Box's clock through the link's offset", async () => {
    const tb = await startTestBox();
    cleanups.push(() => tb.stop());
    const { link } = await live(tb);
    expect(link.state()).toEqual(tb.box.core.state());
    expect(link.connected()).toBe(true);
    // The Box's clock is days away from this machine's, and the screen still reads it to within the socket's delay.
    expect(Math.abs(link.now() - tb.box.core.now())).toBeLessThan(100);
  });

  it("hears every event in order, sends commands, and keeps unchanged parts of the state as they were", async () => {
    const tb = await startTestBox();
    cleanups.push(() => tb.stop());
    const { link, heard } = await live(tb);
    const games = link.state().games;
    const sent: BoxEvent[] = [];
    tb.box.core.subscribe((_, event) => sent.push(event));
    link.send({ type: "booted" });
    await wait(() => tb.box.core.state().phase === "attract");
    await post(tb.box, "/api/taps/inject", { seat: 0, badge: NOVA.address });
    tb.advance(15_000);
    await wait(() => heard.length >= sent.length);
    expect(heard.map(([, event]) => event)).toEqual(sent);
    expect(link.state()).toEqual(tb.box.core.state());
    expect(link.state().games).toBe(games);
    expect(heard.at(-1)?.[0]).toBe(link.state());
  });

  it("reconnects to a restarted Box and starts again from its whole state", async () => {
    const first = await startTestBox();
    const port = first.box.port;
    const { link, heard } = await live(first);
    link.send({ type: "booted" });
    await wait(() => link.state().phase === "attract");
    await first.stop();
    await wait(() => !link.connected());
    link.send({ type: "start" });

    const second = await startTestBox({ port });
    cleanups.push(() => second.stop());
    await wait(() => link.connected(), 5_000);
    const restarted = heard.at(-1);
    expect(restarted?.[1]).toEqual({ type: "init" });
    expect(restarted?.[0].phase).toBe("boot");
    expect(link.state()).toEqual(second.box.core.state());
    // The command sent while the link was down went nowhere.
    expect(second.box.core.state().phase).toBe("boot");
  });
});
