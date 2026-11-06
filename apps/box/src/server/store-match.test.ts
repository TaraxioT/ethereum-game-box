// A whole store match on the Box server, on the real chain port over a mocked relayer and verifier, against a stand-in
// store serving the real Tap Rush bundle: the rack lists it, Join fetches it, the pot opens by its hash, the frame's words
// reach the log over the link, the log goes to the verifier, and Result shows the split. Then the ways it can go wrong:
// the index gone, a changed zip, a zip that never arrives, and a Box with no chain for store games. Last, Tap Rush in a
// real browser on the built screen, which is the only place the kiosk's frame and the core really meet. That one is
// skipped without a Chromium.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { logProblems, logTextProblems, type MatchLog, type Seat } from "@egb/sdk";
import { packBundle, readBundle } from "@egb/sdk/bundle";
import { P256_VECTOR_KEY } from "@egb/shared/names";
import type { Address } from "viem";
import { build } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { END_HOLD_MS, JOIN_SETTLE_MS } from "../core/core.ts";
import { createSepoliaChain } from "../chain/port.ts";
import { POLL_MS } from "../chain/requests.ts";
import { roundsFile } from "../chain/rounds.ts";
import { JUDGE_POLL_MS } from "../chain/store.ts";
import { memoryReads, mockRelayer, mockVerifier } from "../chain/testing.ts";
import { fallbackIcon } from "../builder/forge/icon.ts";
import { softwareSigner } from "../signer/software.ts";
import { CHROMIUM, headlessFlags } from "./games/chromium.ts";
import { BUNDLE_HOST } from "./games/page.ts";
import { FALLBACK_ICON } from "./games/routes.ts";
import { STORE_INDEX_MS } from "./library/store-index.ts";
import { flush, openScreen, post, startTestBox, type TestBox } from "./testing.ts";

const NOVA = `0x${"a1".repeat(20)}` as Address;
const KITE = `0x${"b2".repeat(20)}` as Address;
const JUNO = `0x${"c3".repeat(20)}` as Address;
const TX = `0x${"cd".repeat(32)}` as const;
const SAMPLE = fileURLToPath(new URL("../../../store/sample/tap-rush/", import.meta.url));

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const clean of cleanups.splice(0).reverse()) await clean();
});

interface StandInStore {
  readonly hash: `0x${string}`;
  /** What `/bundles/<hash>.zip` serves; null: it answers 500. */
  zip: Uint8Array | null;
  up: boolean;
  readonly fetch: typeof fetch;
}

/** The sample as the store serves it, and a store that can go wrong. */
async function standInStore(): Promise<StandInStore> {
  const zip = packBundle(new Map(["index.html", "manifest.json"].map((name) => [name, new Uint8Array(readFileSync(join(SAMPLE, name)))])));
  const opened = await readBundle(zip);
  const { id, title, blurb, players, stakes } = opened.manifest;
  const listing = { id, title, blurb, players, stakes, icon: null, hash: opened.hash, size: zip.length };
  const store: StandInStore = {
    hash: opened.hash,
    zip,
    up: true,
    async fetch(url) {
      if (!store.up) throw new Error("the store is down");
      const { pathname } = new URL(String(url));
      if (pathname === "/index.json") return Response.json({ listings: [listing] });
      if (pathname !== `/bundles/${opened.hash}.zip`) return new Response("{}", { status: 404 });
      return store.zip ? new Response(new Uint8Array(store.zip)) : new Response("{}", { status: 500 });
    },
  };
  return store;
}

async function rig(stations?: readonly string[]) {
  const relayer = mockRelayer();
  const reads = memoryReads();
  const verifier = mockVerifier();
  reads.storeBalances.set(NOVA, 100).set(KITE, 100).set(JUNO, 100);
  reads.names.set(NOVA, "nova.gamebox.eth").set(KITE, "kite.gamebox.eth").set(JUNO, "juno.gamebox.eth");
  const rounds = roundsFile(join(mkdtempSync(join(tmpdir(), "egb-rounds-")), "rounds.json"));
  const store = await standInStore();
  const tb = await startTestBox({
    ...(stations ? { stations } : {}),
    chain: (clock) =>
      createSepoliaChain({
        box: "mumbai-01",
        signer: softwareSigner(P256_VECTOR_KEY.privateKey),
        relayer,
        reads,
        rounds,
        clock,
        log: () => {},
        contracts: { duelPot: `0x${"11".repeat(20)}`, boxResults: `0x${"22".repeat(20)}`, boxSeats: `0x${"33".repeat(20)}` },
        store: { storePot: `0x${"44".repeat(20)}`, verifier },
      }),
    store: { storeUrl: "https://store.example", verifierUrl: "https://verifier.example" },
    storeFetch: store.fetch,
  });
  cleanups.push(() => tb.stop());
  await vi.waitFor(() => expect(racked(tb)).toContain("tap-rush"));
  return { tb, relayer, reads, verifier, rounds, store };
}

const racked = (tb: TestBox): string[] => tb.box.core.state().games.map((g) => g.id);
const tapRush = (tb: TestBox) => tb.box.core.state().games.find((g) => g.id === "tap-rush");
const judged = (tb: TestBox) => {
  const play = tb.box.core.state().match?.play;
  return play?.game === "store" ? play.judged?.step : undefined;
};

async function inject(tb: TestBox, seat: Seat, badge: Address): Promise<void> {
  const res = await post(tb.box, "/api/taps/inject", { seat, badge });
  expect(res.status).toBe(200);
  await flush();
}

/** Both players sit down, and Play starts the bundle's fetch. */
async function seatAndPlay(tb: TestBox): Promise<void> {
  const { core } = tb.box;
  core.send({ type: "booted" });
  await inject(tb, 0, NOVA);
  await inject(tb, 0, NOVA);
  await inject(tb, 1, KITE);
  core.send({ type: "focus", game: "tap-rush" });
  core.send({ type: "play" });
  expect(core.state()).toMatchObject({ phase: "join", fetching: true });
}

describe("a store game on the Box", () => {
  it("is listed, fetched, staked, played, judged and paid", async () => {
    const { tb, relayer, reads, verifier, rounds, store } = await rig();
    const { core } = tb.box;
    expect(core.state().games.at(-1)).toMatchObject({ id: "tap-rush", kind: "store", title: "Tap Rush", tier: "judged", players: 2, stakes: [5, 10, 25], ready: true, sealed: null, icon: FALLBACK_ICON, bundle: store.hash });
    const icon = await fetch(`${tb.box.url}${FALLBACK_ICON}`);
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toBe("image/svg+xml");
    expect(icon.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await icon.text()).toBe(fallbackIcon());
    expect((await fetch(`${tb.box.url}/games/no-such-thing`)).status).toBe(404);

    await seatAndPlay(tb);
    await vi.waitFor(() => expect(core.state().fetching).toBe(false));
    const folder = tb.box.bundles?.held(store.hash)?.dir ?? "";
    expect(readdirSync(folder).sort()).toEqual(["index.html", "manifest.json"]);
    tb.advance(JOIN_SETTLE_MS);
    expect(core.state().phase).toBe("stake");
    await vi.waitFor(() =>
      expect(core.state().seats.map((s) => [s.ens, s.balance])).toEqual([["nova.gamebox.eth", 100], ["kite.gamebox.eth", 100]]),
    );

    // Both sign: `StorePot` takes the stakes by the bundle's hash, and the match begins once that is confirmed.
    await inject(tb, 0, NOVA);
    await inject(tb, 1, KITE);
    expect(relayer.posted.map((p) => p.path)).toEqual(["/store/open"]);
    expect(relayer.posted[0]?.body.stake).toMatchObject({ box: "mumbai-01", bundle: store.hash, round: "1", players: [NOVA, KITE], amount: "10000000" });
    expect(rounds.open("store").size).toBe(1);
    relayer.advance(relayer.ids()[0]!, "done");
    await tb.settle(() => core.state().phase === "playing", POLL_MS * 2, 100);
    expect(core.state().match?.play).toMatchObject({ game: "store", id: "tap-rush", title: "Tap Rush", bundle: store.hash, taps: "identify" });

    // The frame's page comes from the Box itself, from the folder the fetch checked, with the host ahead of the game.
    const page = await fetch(`${tb.box.url}/store/${store.hash}/index.html`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("connect-src 'none'");
    const html = await page.text();
    expect(html).toContain(BUNDLE_HOST);
    expect(html.indexOf(BUNDLE_HOST)).toBeLessThan(html.indexOf("<title>"));

    // Taps from the stations, and the page's words over the link; only `end` closes it.
    const screen = await openScreen(tb.box);
    cleanups.push(() => screen.close());
    await inject(tb, 0, NOVA);
    await inject(tb, 1, KITE);
    await inject(tb, 0, NOVA);
    screen.send({ type: "frame", word: { t: "event", name: "taps", data: { "0": 2, "1": 1 } } });
    await vi.waitFor(() => expect(core.state().match?.outcome).toBeNull());
    const from = screen.messages.length;
    screen.send({ type: "frame", word: { t: "end", why: "game" } });
    await screen.next((m) => m.t === "event" && m.state.match?.outcome !== null, from);

    tb.advance(END_HOLD_MS);
    await flush();
    expect(core.state().phase).toBe("judging");
    // The match is over, so its bundle is gone, and the Box serves none of it.
    await vi.waitFor(() => expect(existsSync(folder)).toBe(false));
    expect((await fetch(`${tb.box.url}/store/${store.hash}/index.html`)).status).toBe(404);
    await vi.waitFor(() => expect(verifier.requests).toHaveLength(1));

    // What the verifier gets is a log its own check passes, with the game's claims labelled apart.
    const log = JSON.parse(verifier.requests[0]?.log ?? "") as MatchLog;
    expect(logProblems(log)).toEqual([]);
    expect(log.header).toMatchObject({ box: "mumbai-01", round: "1", bundle: store.hash, game: "tap-rush", players: [NOVA, KITE], amount: "10000000" });
    expect(log.entries.map((e) => `${e.src} ${e.t}`)).toEqual(["box tap", "box tap", "box tap", "game event", "box end"]);
    expect(log.entries.at(-1)).toMatchObject({ why: "game" });

    verifier.statuses.set("mumbai-01/1", { state: "judging", payouts: null, tx: null, record: null, reason: null });
    await tb.settle(() => judged(tb) === "judging", JUDGE_POLL_MS * 2, 100);
    reads.storeBalances.set(NOVA, 110).set(KITE, 90);
    verifier.statuses.set("mumbai-01/1", { state: "paid", payouts: ["20000000", "0"], tx: TX, record: TX, reason: null });
    await tb.settle(() => core.state().phase === "result", JUDGE_POLL_MS * 2, 100);
    await flush();
    expect(core.state().match?.play).toMatchObject({ judged: { step: "paid", payouts: [20, 0], hash: TX } });
    expect(core.state().seats.map((s) => s.balance)).toEqual([110, 90]);
    // Paid as the verifier says: the sweep takes the pot off the file once the chain says so too.
    expect(rounds.open("store").size).toBe(1);
    expect(relayer.posted.map((p) => p.path)).toEqual(["/store/open"]);
  });

  it("leaves the rack with the index and comes back with it, and team games never notice", async () => {
    const { tb, store } = await rig();
    const before = tb.box.core.state().games.filter((g) => g.kind === "team");
    store.up = false;
    tb.advance(STORE_INDEX_MS);
    await vi.waitFor(() => expect(racked(tb)).not.toContain("tap-rush"));
    expect(tb.box.core.state().games.filter((g) => g.kind === "team")).toEqual(before);
    expect(tb.logs).toContain("store: no index, so no store games: the store is down");
    store.up = true;
    tb.advance(STORE_INDEX_MS);
    await vi.waitFor(() => expect(racked(tb)).toContain("tap-rush"));
  });

  it("seals the game and stakes nothing when its zip has changed, and keeps it sealed", async () => {
    const { tb, relayer, store } = await rig();
    const changed = new Uint8Array(store.zip as Uint8Array);
    changed[60] = (changed[60] as number) ^ 1;
    store.zip = changed;
    await seatAndPlay(tb);
    await vi.waitFor(() => expect(tb.box.core.state().phase).toBe("home"));
    expect(tapRush(tb)).toMatchObject({ ready: false, sealed: expect.stringMatching(/^its bundle failed: /) });
    expect(relayer.posted).toEqual([]);
    expect(tb.box.bundles?.held(store.hash)).toBeNull();
    expect(tb.logs.some((line) => line.startsWith("library: tap-rush is sealed: its bundle failed"))).toBe(true);
    tb.advance(STORE_INDEX_MS);
    await flush();
    await vi.waitFor(() => expect(tapRush(tb)?.ready).toBe(false));
    tb.box.core.send({ type: "start" });
    tb.box.core.send({ type: "play" });
    expect(tb.box.core.state().phase).toBe("home");
  });

  it("seals the game only until the next read of the index when its zip never arrives", async () => {
    const { tb, relayer, store } = await rig();
    const zip = store.zip;
    store.zip = null;
    await seatAndPlay(tb);
    await vi.waitFor(() => expect(tb.box.core.state().phase).toBe("home"));
    expect(tapRush(tb)).toMatchObject({ ready: false, sealed: "its bundle failed: the store answered 500" });
    expect(relayer.posted).toEqual([]);
    store.zip = zip;
    tb.advance(STORE_INDEX_MS);
    await vi.waitFor(() => expect(tapRush(tb)?.ready).toBe(true));
  });

  it("has no store games where the chain can't stake them, whatever the settings say", async () => {
    const store = await standInStore();
    const tb = await startTestBox({ store: { storeUrl: "https://store.example", verifierUrl: "https://verifier.example" }, storeFetch: store.fetch });
    cleanups.push(() => tb.stop());
    await tb.box.library.scanned;
    expect(tb.box.bundles).toBeNull();
    expect(tb.box.core.state().games.every((g) => g.kind !== "store")).toBe(true);
  });
});

describe.skipIf(!CHROMIUM)("a store game in a real kiosk", () => {
  /** The Box's real screen, in the folder this Box serves. */
  async function buildScreen(tb: TestBox): Promise<void> {
    vi.stubEnv("VITE_EGB_MODE", "box");
    cleanups.push(async () => void vi.unstubAllEnvs());
    await build({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: fileURLToPath(new URL("../../vite.config.ts", import.meta.url)), logLevel: "error", build: { outDir: join(tb.dir, "screen") } });
  }

  function openKiosk(tb: TestBox): void {
    const chromium = spawn(CHROMIUM ?? "", [...headlessFlags(join(tb.dir, "profile")), tb.box.url], { stdio: "ignore" });
    cleanups.push(async () => void chromium.kill("SIGKILL"));
  }

  const SOON = { timeout: 30_000, interval: 100 };

  it("plays Tap Rush: the page hears each tap, and what it says reaches the stations and the log", { timeout: 120_000 }, async () => {
    const { tb, relayer, verifier } = await rig();
    const { core } = tb.box;
    const lines = () => {
      const play = core.state().match?.play;
      return play?.game === "store" ? play.lines : [];
    };
    await buildScreen(tb);

    await seatAndPlay(tb);
    await vi.waitFor(() => expect(core.state().fetching).toBe(false));
    tb.advance(JOIN_SETTLE_MS);
    await inject(tb, 0, NOVA);
    await inject(tb, 1, KITE);
    relayer.advance(relayer.ids()[0]!, "done");
    await tb.settle(() => core.state().phase === "playing", POLL_MS * 2, 100);
    expect(lines()).toEqual(["PLAY", "PLAY"]);

    // The kiosk routes the match to the frame, the Box serves the page, and the page's first words come back up the link.
    openKiosk(tb);
    await vi.waitFor(() => expect(lines()).toEqual(["TAP!", "TAP!"]), SOON);

    // The page only counts what it heard, and a tap before it has answered the kiosk isn't handed on: tap until it hears.
    await vi.waitFor(async () => {
      await inject(tb, 0, NOVA);
      expect(lines()[0]).toMatch(/^[1-9][0-9]*$/);
    }, { ...SOON, interval: 250 });
    await inject(tb, 1, KITE);
    await vi.waitFor(() => expect(lines()[1]).toBe("1"), SOON);
    const heard = Number(lines()[0]);

    // Its ten seconds run from the first tap it heard, and then the game ends the match itself.
    await vi.waitFor(() => expect(core.state().match?.outcome).not.toBeNull(), SOON);
    expect(lines()).toEqual([`TIME ${heard}`, "TIME 1"]);

    tb.advance(END_HOLD_MS);
    await flush();
    await vi.waitFor(() => expect(verifier.requests).toHaveLength(1));
    const text = verifier.requests[0]?.log ?? "";
    expect(logTextProblems(text)).toEqual([]);
    const { entries } = JSON.parse(text) as MatchLog;
    expect(entries.find((entry) => entry.src === "game")).toMatchObject({ t: "event", name: "score", data: { counts: [heard, 1] } });
    expect(entries.filter((entry) => entry.t === "tap" && entry.seat === 0).length).toBeGreaterThanOrEqual(heard);
    expect(entries.at(-1)).toMatchObject({ src: "box", t: "end", why: "game" });
  });

  it("plays Tap Rush with three of four seats: the page counts players, and a seat left empty isn't one", { timeout: 120_000 }, async () => {
    const { tb, relayer, verifier } = await rig(["e4ba70", "df3d88", "df3b9c", "0a0b0c"]);
    const { core } = tb.box;
    const lines = () => {
      const play = core.state().match?.play;
      return play?.game === "store" ? play.lines : [];
    };
    await buildScreen(tb);

    core.send({ type: "booted" });
    await inject(tb, 0, NOVA);
    core.send({ type: "focus", game: "tap-rush" });
    core.send({ type: "play" });
    await vi.waitFor(() => expect(core.state().fetching).toBe(false));
    expect(core.state().seats).toHaveLength(4);
    await inject(tb, 0, NOVA);
    await inject(tb, 2, KITE);
    await inject(tb, 3, JUNO);
    core.send({ type: "begin" });
    await flush();
    await inject(tb, 0, NOVA);
    await inject(tb, 2, KITE);
    await inject(tb, 3, JUNO);
    expect(relayer.posted[0]?.body.stake).toMatchObject({ players: [NOVA, KITE, JUNO] });
    relayer.advance(relayer.ids()[0]!, "done");
    await tb.settle(() => core.state().phase === "playing", POLL_MS * 2, 100);

    openKiosk(tb);
    await vi.waitFor(() => expect(lines()).toEqual(["TAP!", "TAP!", "TAP!"]), SOON);
    await vi.waitFor(async () => {
      await inject(tb, 3, JUNO);
      expect(lines()[2]).toMatch(/^[1-9][0-9]*$/);
    }, { ...SOON, interval: 250 });
    await inject(tb, 2, KITE);
    await vi.waitFor(() => expect(lines()[1]).toBe("1"), SOON);
    const heard = Number(lines()[2]);
    // The station of the Box's fourth seat shows the page's third player.
    expect(core.state().stations.map((v) => v.big)).toEqual(["TAP!", "NEXT", "1", String(heard)]);

    await vi.waitFor(() => expect(core.state().match?.outcome).not.toBeNull(), SOON);
    tb.advance(END_HOLD_MS);
    await flush();
    await vi.waitFor(() => expect(verifier.requests).toHaveLength(1));
    const text = verifier.requests[0]?.log ?? "";
    expect(logTextProblems(text)).toEqual([]);
    const { header, entries } = JSON.parse(text) as MatchLog;
    expect(header.players).toEqual([NOVA, KITE, JUNO]);
    expect(entries.find((entry) => entry.src === "game")).toMatchObject({ t: "event", name: "score", data: { counts: [0, 1, heard] } });
  });
});
