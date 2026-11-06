// A whole store match with three and four players on the fake stations: simulated badges on simulated readers, through
// the real server, the taps library, the core and the chain port, over a mocked relayer and verifier, against a stand-in
// store serving the real Tap Rush. Four seats move on by themselves, three of four wait for START, and a seat left empty
// closes up: the pot, the log, the page and the split count players.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { logProblems, type MatchLog } from "@egb/sdk";
import { packBundle, readBundle } from "@egb/sdk/bundle";
import { P256_VECTOR_KEY } from "@egb/shared/names";
import type { Address } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { END_HOLD_MS, JOIN_SETTLE_MS } from "../core/core.ts";
import { createSepoliaChain } from "../chain/port.ts";
import { POLL_MS } from "../chain/requests.ts";
import { roundsFile } from "../chain/rounds.ts";
import { JUDGE_POLL_MS } from "../chain/store.ts";
import { memoryReads, mockRelayer, mockVerifier } from "../chain/testing.ts";
import { softwareSigner } from "../signer/software.ts";
import { fakeTap, flush, openScreen, startTestBox, type TestBox } from "./testing.ts";

const STATIONS = ["e4ba70", "df3d88", "df3b9c", "0a0b0c"] as const;
const [ONE, TWO, THREE, FOUR] = STATIONS;
const BADGES = ["ada", "bo", "cy", "di"] as const;
const TX = `0x${"cd".repeat(32)}` as const;
const SAMPLE = fileURLToPath(new URL("../../../store/sample/tap-rush/", import.meta.url));

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const clean of cleanups.splice(0).reverse()) await clean();
});

/** The sample as the store serves it. */
async function standInStore() {
  const zip = packBundle(new Map(["index.html", "manifest.json"].map((name) => [name, new Uint8Array(readFileSync(join(SAMPLE, name)))])));
  const opened = await readBundle(zip);
  const { id, title, blurb, players, stakes } = opened.manifest;
  const listing = { id, title, blurb, players, stakes, icon: null, hash: opened.hash, size: zip.length };
  const fetcher: typeof fetch = async (url) => (new URL(String(url)).pathname === "/index.json" ? Response.json({ listings: [listing] }) : new Response(new Uint8Array(zip)));
  return { hash: opened.hash, fetcher };
}

async function rig(stations: readonly string[] = STATIONS) {
  const relayer = mockRelayer();
  const reads = memoryReads();
  const verifier = mockVerifier();
  const rounds = roundsFile(join(mkdtempSync(join(tmpdir(), "egb-rounds-")), "rounds.json"));
  const store = await standInStore();
  const tb = await startTestBox({
    receiver: { kind: "fake" },
    stations,
    fake: { timeScale: 0 },
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
    storeFetch: store.fetcher,
  });
  cleanups.push(() => tb.stop());
  const taps = tb.box.taps();
  const fake = taps?.fake;
  if (!taps || !fake) throw new Error("no fake receiver");
  await tb.settle(() => taps.status().receiver.open && taps.status().stations.filter((s) => s.seat !== null).length === stations.length);
  await vi.waitFor(() => expect(tb.box.core.state().games.map((g) => g.id)).toContain("tap-rush"));
  const addresses = Object.fromEntries(BADGES.map((name) => [name, fake.badge(name).identity as Address])) as Record<(typeof BADGES)[number], Address>;
  for (const [name, address] of Object.entries(addresses)) {
    reads.storeBalances.set(address, 100);
    reads.names.set(address, `${name}.gamebox.eth`);
  }
  return { tb, relayer, reads, verifier, store, addresses };
}

type Rig = Awaited<ReturnType<typeof rig>>;

/** Wakes the Box on ada's tap and goes to Join on Tap Rush. */
async function toJoin({ tb }: Rig): Promise<void> {
  const { core } = tb.box;
  core.send({ type: "booted" });
  await fakeTap(tb, "ada", ONE);
  expect(core.state().phase).toBe("home");
  core.send({ type: "focus", game: "tap-rush" });
  core.send({ type: "play" });
  expect(core.state().phase).toBe("join");
  await vi.waitFor(() => expect(core.state().fetching).toBe(false));
  await flush();
}

/** Every player signs at their station, and the pot opens. */
async function signAndOpen({ tb, relayer }: Rig, seated: readonly (readonly [string, string])[]): Promise<void> {
  const { core } = tb.box;
  for (const [badge, st] of seated) await fakeTap(tb, badge, st);
  expect(relayer.posted.map((p) => p.path)).toEqual(["/store/open"]);
  relayer.advance(relayer.ids()[0] ?? "", "done");
  await tb.settle(() => core.state().phase === "playing", POLL_MS * 2, 100);
}

/** The page ends the match, and the log goes to the verifier after the end hold. */
async function endAndJudge({ tb, verifier }: Rig): Promise<MatchLog> {
  const { core } = tb.box;
  const screen = await openScreen(tb.box);
  cleanups.push(() => screen.close());
  const from = screen.messages.length;
  screen.send({ type: "frame", word: { t: "end", why: "game" } });
  await screen.next((m) => m.t === "event" && m.state.match?.outcome !== null, from);
  tb.advance(END_HOLD_MS);
  await flush();
  expect(core.state().phase).toBe("judging");
  await vi.waitFor(() => expect(verifier.requests).toHaveLength(1));
  return JSON.parse(verifier.requests[0]?.log ?? "") as MatchLog;
}

const seatedNames = (tb: TestBox) => tb.box.core.state().seats.map((s) => s.badge?.address ?? null);

describe("a store match on the fake stations", () => {
  it("seats four, moves on by itself, stakes all four, and pays a four-way split", async () => {
    const r = await rig();
    const { tb, relayer, reads, verifier, store, addresses } = r;
    const { core } = tb.box;
    const { ada, bo, cy, di } = addresses;
    expect(core.state().games.at(-1)).toMatchObject({ id: "tap-rush", players: 4, minPlayers: 2 });
    await toJoin(r);
    expect(core.state()).toMatchObject({ phase: "join", fewest: 2 });
    expect(core.state().seats).toHaveLength(4);

    const seated = [["ada", ONE], ["bo", TWO], ["cy", THREE], ["di", FOUR]] as const;
    for (const [badge, st] of seated) await fakeTap(tb, badge, st);
    await tb.settle(() => core.state().phase === "stake", JOIN_SETTLE_MS * 2, 50);
    await flush();
    expect(seatedNames(tb)).toEqual([ada, bo, cy, di]);
    expect(core.state().seats.map((s) => s.balance)).toEqual([100, 100, 100, 100]);
    const views = core.state().stations.map((v) => [v.tag, v.big]);
    expect(views).toEqual([["P1", "SIGN"], ["P2", "SIGN"], ["P3", "SIGN"], ["P4", "SIGN"]]);

    await signAndOpen(r, seated);
    expect(relayer.posted[0]?.body.stake).toMatchObject({ bundle: store.hash, players: [ada, bo, cy, di], amount: "10000000" });

    // Each station's tap goes in the log by its player's place; the page speaks to the fourth by theirs.
    for (const [badge, st] of [...seated].reverse()) await fakeTap(tb, badge, st);
    tb.box.core.send({ type: "frame", word: { t: "station", seat: 3, text: "LAST" } });
    expect(core.state().stations[3]?.big).toBe("LAST");

    const log = await endAndJudge(r);
    expect(logProblems(log)).toEqual([]);
    expect(log.header).toMatchObject({ players: [ada, bo, cy, di], amount: "10000000" });
    expect(log.entries.flatMap((e) => (e.t === "tap" ? [e.seat] : []))).toEqual([3, 2, 1, 0]);

    reads.storeBalances.set(ada, 115).set(bo, 95).set(cy, 95).set(di, 95);
    verifier.statuses.set("mumbai-01/1", { state: "paid", payouts: ["25000000", "5000000", "5000000", "5000000"], tx: TX, record: TX, reason: null });
    await tb.settle(() => core.state().phase === "result", JUDGE_POLL_MS * 2, 100);
    await flush();
    expect(core.state().match?.play).toMatchObject({ judged: { step: "paid", payouts: [25, 5, 5, 5], hash: TX } });
    expect(core.state().seats.map((s) => s.balance)).toEqual([115, 95, 95, 95]);
    expect(core.state().stations.map((v) => v.big)).toEqual(["+25 USDC", "+5 USDC", "+5 USDC", "+5 USDC"]);
  });

  it("takes three of four on START, with the seat left empty closed up in the pot, the log and the split", async () => {
    const r = await rig();
    const { tb, relayer, reads, verifier, addresses } = r;
    const { core } = tb.box;
    const { ada, bo, cy } = addresses;
    await toJoin(r);
    // Two stations apart: Player 2's seat stays empty.
    const seated = [["ada", ONE], ["bo", THREE], ["cy", FOUR]] as const;
    for (const [badge, st] of seated) await fakeTap(tb, badge, st);
    tb.advance(JOIN_SETTLE_MS * 2);
    await flush();
    expect(core.state().phase).toBe("join");
    core.send({ type: "begin" });
    expect(core.state().phase).toBe("stake");
    await flush();
    expect(seatedNames(tb)).toEqual([ada, null, bo, cy]);
    expect(core.state().stations[1]).toMatchObject({ big: "NEXT", mode: "shut" });

    await signAndOpen(r, seated);
    expect(relayer.posted[0]?.body.stake).toMatchObject({ players: [ada, bo, cy] });

    // A chip on the empty seat's station means nothing, and Player 3's tap is the second player's in the log.
    await fakeTap(tb, "di", TWO);
    await fakeTap(tb, "bo", THREE);
    await fakeTap(tb, "cy", FOUR);
    const log = await endAndJudge(r);
    expect(logProblems(log)).toEqual([]);
    expect(log.header.players).toEqual([ada, bo, cy]);
    expect(log.entries.flatMap((e) => (e.t === "tap" ? [e.seat] : []))).toEqual([1, 2]);

    reads.storeBalances.set(ada, 90).set(bo, 120).set(cy, 90);
    verifier.statuses.set("mumbai-01/1", { state: "paid", payouts: ["0", "30000000", "0"], tx: TX, record: TX, reason: null });
    await tb.settle(() => core.state().phase === "result", JUDGE_POLL_MS * 2, 100);
    await flush();
    expect(core.state().stations.map((v) => v.big)).toEqual(["+0 USDC", "NEXT", "+30 USDC", "+0 USDC"]);
  });

  it("refunds three when the verifier gives up, each stake back", async () => {
    const r = await rig(STATIONS.slice(0, 3));
    const { tb, verifier } = r;
    const { core } = tb.box;
    await toJoin(r);
    expect(core.state().games.at(-1)).toMatchObject({ players: 3, minPlayers: 2 });
    const seated = [["ada", ONE], ["bo", TWO], ["cy", THREE]] as const;
    for (const [badge, st] of seated) await fakeTap(tb, badge, st);
    await tb.settle(() => core.state().phase === "stake", JOIN_SETTLE_MS * 2, 50);
    await signAndOpen(r, seated);
    await endAndJudge(r);
    verifier.statuses.set("mumbai-01/1", { state: "refunded", payouts: null, tx: TX, record: TX, reason: "cannot_judge" });
    await tb.settle(() => core.state().phase === "result", JUDGE_POLL_MS * 2, 100);
    expect(core.state().stations.map((v) => [v.big, v.small])).toEqual([["REFUNDED", "+10 USDC"], ["REFUNDED", "+10 USDC"], ["REFUNDED", "+10 USDC"]]);
  });

  it("keeps a team game to two, whatever the Box has", async () => {
    const { tb, addresses } = await rig();
    const { core } = tb.box;
    core.send({ type: "booted" });
    await fakeTap(tb, "ada", ONE);
    await fakeTap(tb, "ada", ONE);
    await fakeTap(tb, "cy", THREE);
    expect(core.state().seats.map((s) => s.badge?.address ?? null)).toEqual([addresses.ada, null]);
    expect(core.state().stations.slice(2).map((v) => [v.big, v.small, v.mode])).toEqual([["NEXT", "this game seats 2", "shut"], ["NEXT", "this game seats 2", "shut"]]);
  });
});
