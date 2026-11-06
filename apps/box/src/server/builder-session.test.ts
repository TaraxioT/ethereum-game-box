// A whole design by voice, over the HTTP API alone, as the kiosk's screen drives it: mock voice hears the scripted
// player for each question (push-to-talk with no microphone), its last line ("yes, build it") starts the build, and
// the sim provider builds and installs a real game while the event stream carries every step to the screen.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { DesignerState } from "../builder/types.ts";
import { BUILDER, type MockTurn, type TranscribeReply } from "./builder-wire.ts";
import { callJson, openStream, startBuilderBox, type TestStream } from "./builder-testing.ts";
import type { TestBox } from "./testing.ts";

let tb: TestBox | null = null;
let events: TestStream | null = null;
afterEach(async () => {
  events?.close();
  await tb?.stop();
  tb = null;
});

it("mock voice drives a Designer session to a sim build, installed, with the build streamed to the screen", async () => {
  tb = await startBuilderBox();
  const { box } = tb;
  events = await openStream(box);
  await events.next("hello");

  // The screen opens the builder from Home's NEW GAME.
  box.core.send({ type: "booted" });
  box.core.send({ type: "start" });
  box.core.send({ type: "build" });
  expect(box.core.state().phase).toBe("build");

  let state = await callJson<DesignerState>(box, "POST", BUILDER.start, {});
  const script = await callJson<MockTurn[]>(box, "GET", BUILDER.turns);
  expect(script.length).toBeGreaterThan(3);
  expect(script.at(-1)?.hear).toMatch(/build it/i);

  // Each push-to-talk: the Designer's line, then the scripted player's answer heard and read.
  for (const [i, turn] of script.entries()) {
    expect(turn.say).toBe(state.question);
    const heard = await callJson<TranscribeReply>(box, "POST", `${BUILDER.transcribe}?session=${state.session}`, new Uint8Array(0));
    expect(heard.text).toBe(turn.hear);
    state = heard.state;
    if (i < script.length - 1) expect(state.locked).toBe(false);
  }
  expect(state).toMatchObject({ step: "confirm", locked: true });
  expect(state.brief).toMatchObject({ template: "tap-three", theme: "A Wild West showdown", voice: "A pirate" });

  // The build runs: the screen sees it start, its tool calls and compile steps, and its result.
  const queued = await events.next("forge", (e) => e.type === "status" && e.status === "queued");
  const result = await events.next("forge", (e) => e.type === "result" && e.job === queued.job, 0, 90_000);
  expect(result).toMatchObject({ ok: true, error: null, game: expect.any(String) });
  const kinds = new Set(events.events.filter((e) => e.event === "forge").map((e) => (e.data as { type: string }).type));
  expect([...kinds]).toEqual(expect.arrayContaining(["status", "say", "tool", "tool_done", "compile", "result"]));
  const game = (result as { game: string }).game;
  expect(existsSync(join(tb.dir, "data", "games", game, "game.json"))).toBe(true);

  // The design unlocks, and Home is a tap away.
  await events.next("designer", (s) => !s.locked && s.session === state.session);
  box.core.send({ type: "home" });
  expect(box.core.state().phase).toBe("home");
}, 120_000);
