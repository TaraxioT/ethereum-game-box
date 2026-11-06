// A built game end to end through the real server: the Forge's sim provider builds and installs a game (Lantern Race,
// in its own child process), the library picks it up and Home's rack hears of it, its cartridge and frame are served,
// and a whole match plays by injected taps with its rules in the sandboxed child: join, stake, play, result. A built game
// isn't on chain, so it plays for nothing: no transaction, no balance moves. Then a game whose rules never answer is
// voided at its budget.
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Seat, Transcript } from "@egb/sdk";
import { brief } from "../builder/forge/test-helpers.ts";
import { isFinished } from "../builder/types.ts";
import type { BoxState, ScreenCommand } from "../core/types.ts";
import { openScreen, post, startTestBox, type TestBox, type TestScreen } from "./testing.ts";

const NOVA = `0x${"a1".repeat(20)}`;
const KITE = `0x${"b2".repeat(20)}`;

let tb: TestBox;
let screen: TestScreen;
let built = "";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Real time for the Forge's child, and the rules' child, to answer. */
async function waitFor(check: () => boolean, ms = 120_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out in ${tb.box.core.state().phase}`);
    await pause(10);
  }
}

/** Moves the Box's clock in ticks, with real time between them for the rules' child to answer. */
async function play(check: (state: BoxState) => boolean, limit = 60_000): Promise<void> {
  for (let waited = 0; !check(tb.box.core.state()); waited += 50) {
    if (waited > limit) throw new Error(`still ${tb.box.core.state().phase} after ${limit} ms of Box time`);
    tb.clock.advance(50);
    await pause(2);
  }
}

/** Lets `ms` of Box time pass the same way. */
async function pass(ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= 50) {
    tb.clock.advance(50);
    await pause(2);
  }
}

async function inject(seat: Seat, badge: string): Promise<boolean> {
  const res = await post(tb.box, "/api/taps/inject", { seat, badge });
  expect(res.status).toBe(200);
  return ((await res.json()) as { accepted: boolean }).accepted;
}

async function command(cmd: ScreenCommand, done: (state: BoxState) => boolean): Promise<void> {
  const from = screen.messages.length;
  screen.send(cmd);
  await screen.next((m) => m.t === "event" && done(m.state), from);
}

/** From Home with both badges seated: focus the game, Play, both sign, and wait for the match to open. */
async function toPlaying(game: string): Promise<void> {
  await command({ type: "focus", game }, (s) => s.focus === game);
  await command({ type: "play" }, (s) => s.phase === "stake");
  await inject(0, NOVA);
  await inject(1, KITE);
  await play((s) => s.phase === "playing" || s.phase === "result");
}

function transcripts(): Transcript[] {
  const day = new Date(tb.clock.now()).toISOString().slice(0, 10);
  return readFileSync(join(tb.dir, "data", "sessions", `${day}.jsonl`), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Transcript);
}

/** The last transcript of `game`, once the session log has it: it is written after the end hold, off the tap path. */
async function transcriptOf(game: string): Promise<Transcript | undefined> {
  const of = () => {
    try {
      return transcripts().filter((t) => t.game === game);
    } catch {
      return [];
    }
  };
  await waitFor(() => of().length > 0, 10_000);
  return of().at(-1);
}

beforeAll(async () => {
  tb = await startTestBox();
  screen = await openScreen(tb.box);
  await screen.next(() => true);
  await command({ type: "booted" }, (s) => s.phase === "attract");
  await inject(0, NOVA);
  await inject(0, NOVA);
  await inject(1, KITE);
  await play((s) => s.phase === "home" && s.seats.every((seat) => seat.badge !== null));
}, 30_000);

afterAll(async () => {
  await screen.close();
  await tb.stop();
});

describe("a built game on the Box", () => {
  it("is built by the Forge, installed, and slides into the library", async () => {
    const forge = tb.box.builder()?.forge;
    if (!forge) throw new Error("no builder");
    const from = screen.messages.length;
    const job = forge.submit(brief({ template: "quick-draw", title: "Lantern Race", stakes: [1, 5] }), "sim");
    await waitFor(() => isFinished(forge.get(job.id)?.status ?? "queued"));
    expect(forge.get(job.id)).toMatchObject({ status: "done", error: null });
    built = forge.get(job.id)?.game ?? "";
    // The library rescans on the Forge's word, and the screen hears a `games` event with the new cartridge.
    const heard = await screen.next((m) => m.t === "event" && m.event.type === "games" && m.state.games.some((g) => g.id === built), from, 10_000);
    const info = heard.state.games.find((g) => g.id === built);
    expect(info).toMatchObject({ kind: "built", title: "Lantern Race", ready: true, sealed: null, stakes: [1, 5], icon: expect.stringMatching(new RegExp(`^/games/${built}/icon\\.svg\\?v=`)) });
    expect(info?.manifest).toMatchObject({ taps: "identify", budgetMs: 50 });
    // Its cartridge art and its frame are served.
    for (const file of ["icon.svg", "frame.html", "screen.js"]) expect((await fetch(`${tb.box.url}/games/${built}/${file}`)).status, file).toBe(200);
  }, 150_000);

  it("plays a whole match with its rules in the sandboxed child, for nothing", async () => {
    await toPlaying(built);
    const before = tb.box.core.state().seats.map((s) => s.balance);
    const state = tb.box.core.state();
    expect(state.match).toMatchObject({ game: built, play: { game: "built", id: built }, voided: false, stake: 0 });
    // The stations show the rules' own views.
    expect(state.stations.map((v) => [v.tag, v.big, v.small])).toEqual([["P1", "0/7", "TAP TO LIGHT"], ["P2", "0/7", "TAP TO LIGHT"]]);

    // Player 1 lights seven lanterns, Player 2 one; each tap at least the game's settle time after the last.
    for (let i = 0; i < 7; i++) {
      expect(await inject(0, NOVA)).toBe(true);
      if (i === 2) await inject(1, KITE);
      await pass(200);
    }
    await play((s) => s.match?.outcome !== null);
    expect(tb.box.core.state().match?.outcome).toEqual({ winner: 0 });
    expect(tb.box.core.state().stations.map((v) => v.big)).toEqual(["WIN", "LOSE"]);
    await play((s) => s.phase === "result");
    expect(tb.box.core.state().txs).toEqual([]);
    expect(tb.box.core.state().seats.map((s) => s.balance)).toEqual(before);
    const last = await transcriptOf(built);
    expect(last).toMatchObject({ game: built, result: { winner: 0 }, stake: 0 });
    expect(last?.taps.filter((t) => t.seat === 0)).toHaveLength(7);
  }, 60_000);

  it("voids a match whose rules run over their budget", async () => {
    // A copy of the game whose rules loop forever on a tap.
    const hung = "hung-lanterns";
    const dir = join(tb.dir, "data", "games", hung);
    cpSync(join(tb.dir, "data", "games", built), dir, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(dir, "game.json"), "utf8")) as Record<string, unknown>;
    writeFileSync(join(dir, "game.json"), JSON.stringify({ ...manifest, id: hung, title: "Hung Lanterns" }));
    writeFileSync(
      join(dir, "dist", "rules.js"),
      `const send = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const views = [{ tag: "P1", big: "HUNG", small: "" }, { tag: "P2", big: "HUNG", small: "" }];
send({ t: "ready" });
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { buf += c; for (let i = buf.indexOf("\\n"); i >= 0; i = buf.indexOf("\\n")) { const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
  if (req.t === "step" && req.event.type === "tap") for (;;);
  send({ t: "state", seq: req.seq, state: {}, outcome: null, stations: views, ms: 0 }); } });
process.stdin.on("end", () => process.exit(0));
`,
    );
    await tb.box.library.rescan();
    await command({ type: "home" }, (s) => s.phase === "home" && s.games.some((g) => g.id === hung && g.ready));
    const before = tb.box.core.state().seats.map((s) => s.balance);
    await toPlaying(hung);
    expect(tb.box.core.state().phase).toBe("playing");
    await inject(1, KITE);
    await waitFor(() => tb.box.core.state().match?.voided === true, 5_000);
    expect(tb.box.core.state().stations.map((v) => v.big)).toEqual(["VOID", "VOID"]);
    expect(tb.logs.some((l) => l.includes(`${hung} took over its 50 ms budget`))).toBe(true);
    await play((s) => s.phase === "result");
    // Nobody gained or lost.
    expect(tb.box.core.state().seats.map((s) => s.balance)).toEqual(before);
    expect(await transcriptOf(hung)).toMatchObject({ game: hung, result: "void", counts: false });
  }, 60_000);
});
