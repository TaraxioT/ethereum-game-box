// A store game's money and judge on the Sepolia port, against a mocked relayer and verifier, with a software key standing
// in for the HYP2003: the `Stake` and `Judge` the Box signs match the shared vectors byte for byte, every route has its
// shape, the verifier is followed to paid, refunded or failed, and the rounds file and the sweep keep the pot till then.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logProblems, type LogEntry } from "@egb/sdk";
import { P256_VECTOR_KEY, verifyP256 } from "@egb/shared/names";
import { JUDGE_VECTOR, STORE_STAKE_VECTOR, STORE_VECTOR, jsonTextHash, judgeDigest, storeStakeDigest, type JudgeStatus } from "@egb/shared/store";
import { hexToBytes, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { createFakeClock } from "../core/fake-clock.ts";
import type { ChainTxUpdate, JudgeOrder } from "../core/ports.ts";
import type { Judged } from "../core/types.ts";
import type { BoxSigner } from "../signer/signer.ts";
import { softwareSigner } from "../signer/software.ts";
import { createSepoliaChain, REFUND_AFTER_MS } from "./port.ts";
import { GIVE_UP_MS, POLL_MS } from "./requests.ts";
import { roundsFile } from "./rounds.ts";
import { JUDGE_GIVE_UP_MS, JUDGE_POLL_MS, matchLogOf, storeStakeOf } from "./store.ts";
import { memoryReads, mockRelayer, mockVerifier } from "./testing.ts";
import { parseStatus, verifierAt } from "./verifier.ts";

const BOX = "mumbai-01";
const DEADLINE = STORE_STAKE_VECTOR.message.deadline;
/** The vectors' deadline is 600 s (the port's) after this. */
const NOW = (Number(DEADLINE) - 600) * 1000;
const KEY = { qx: P256_VECTOR_KEY.qx, qy: P256_VECTOR_KEY.qy };
const { bundle, players } = STORE_STAKE_VECTOR.message;
const [A, B] = players as [Address, Address];
const TX = `0x${"cd".repeat(32)}` as const;
const ENTRIES: readonly LogEntry[] = [
  { src: "box", t: "tap", seat: 0, at: NOW + 40, roll: null },
  { src: "game", t: "event", at: NOW + 41, name: "score", data: { "señal": 1 } },
  { src: "box", t: "end", at: NOW + 50, why: "game" },
];
const ORDER: JudgeOrder = { round: 3, bundle, game: "tap-rush", badges: [A, B], amount: 10, startedAt: NOW, entries: ENTRIES };
const status = (state: JudgeStatus["state"], over: Partial<JudgeStatus> = {}): JudgeStatus => ({ state, payouts: null, tx: null, record: null, reason: null, ...over });

const flush = async (rounds = 8): Promise<void> => {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

function rig(signer: BoxSigner = softwareSigner(P256_VECTOR_KEY.privateKey)) {
  const clock = createFakeClock(NOW);
  const relayer = mockRelayer();
  const reads = memoryReads();
  const verifier = mockVerifier();
  const file = join(mkdtempSync(join(tmpdir(), "egb-store-")), "rounds.json");
  const rounds = roundsFile(file);
  const chain = createSepoliaChain({
    box: BOX,
    signer,
    relayer,
    reads,
    rounds,
    clock,
    log: () => {},
    contracts: { duelPot: `0x${"11".repeat(20)}`, boxResults: `0x${"22".repeat(20)}`, boxSeats: `0x${"33".repeat(20)}` },
    store: { storePot: STORE_VECTOR.storePot, verifier },
  });
  const store = chain.store;
  if (!store) throw new Error("no store");
  const steps: ChainTxUpdate[] = [];
  const said: Judged[] = [];
  /** Moves the clock on, letting answers land. */
  const tick = async (ms: number) => {
    clock.advance(ms);
    await flush();
  };
  return { clock, relayer, reads, verifier, file, rounds, chain, store, steps, watch: (update: ChainTxUpdate) => void steps.push(update), said, hear: (update: Judged) => void said.push(update), tick };
}

describe("the messages the Box signs for a store game", () => {
  it("are the shared vectors' Stake and Judge, digest for digest", () => {
    const stake = storeStakeOf(BOX, { round: 7, bundle, badges: players, amount: 10 }, DEADLINE);
    expect({ ...stake, round: 0n }).toEqual({ ...STORE_STAKE_VECTOR.message, round: 0n });
    const vector = { ...stake, round: STORE_STAKE_VECTOR.message.round };
    expect(storeStakeDigest(vector, STORE_VECTOR.storePot, STORE_VECTOR.chainId)).toBe(STORE_STAKE_VECTOR.digest);
    expect(jsonTextHash(JUDGE_VECTOR.logText)).toBe(JUDGE_VECTOR.message.log);
    expect(judgeDigest(JUDGE_VECTOR.message, STORE_VECTOR.storePot, STORE_VECTOR.chainId)).toBe(JUDGE_VECTOR.digest);
  });

  it("write a log the verifier's own check passes", () => {
    const log = matchLogOf(BOX, ORDER);
    expect(log.header).toEqual({ v: 1, box: BOX, round: "3", bundle, game: "tap-rush", players: [A, B], amount: "10000000", startedAt: NOW });
    expect(logProblems(JSON.parse(JSON.stringify(log)))).toEqual([]);
  });
});

describe("a store pot on the Sepolia port", () => {
  it("opens with a Box-signed Stake naming the bundle, and keeps the pot in the rounds file", async () => {
    const r = rig();
    r.store.open({ round: Number(STORE_STAKE_VECTOR.message.round), bundle, badges: players, amount: 10 }, r.watch);
    await flush();
    const [open] = r.relayer.posted;
    expect(open?.path).toBe("/store/open");
    const { message } = STORE_STAKE_VECTOR;
    expect(open?.body.stake).toEqual({ box: BOX, bundle, round: String(message.round), players, amount: "10000000", deadline: String(DEADLINE) });
    expect(verifyP256(KEY, BigInt(open?.body.r as Hex), BigInt(open?.body.s as Hex), hexToBytes(STORE_STAKE_VECTOR.digest))).toBe(true);
    expect(r.steps.map((u) => u.step)).toEqual(["sent"]);
    expect([...r.rounds.open("store").keys()]).toEqual([Number(message.round)]);
    expect(r.rounds.open().size).toBe(0);
    r.relayer.advance(r.relayer.ids()[0]!, "done");
    await r.tick(POLL_MS);
    expect(r.steps.map((u) => u.step)).toEqual(["sent", "paid"]);
    // Open and paid: the pot stays on the file until the verifier or the sweep has ended it.
    expect(r.rounds.open("store").size).toBe(1);
  });

  it("forgets a pot whose open was refused", async () => {
    const r = rig();
    r.relayer.refuseNext(409, "BundleNotListed");
    r.store.open({ round: 3, bundle, badges: [A, B], amount: 5 }, r.watch);
    await flush();
    expect(r.steps.map((u) => [u.step, u.error])).toEqual([["failed", "BundleNotListed"]]);
    expect(r.rounds.open("store").size).toBe(0);
    expect(JSON.parse(readFileSync(r.file, "utf8"))).toEqual({ next: 1, pots: {} });
  });

  describe("whose open may have landed", () => {
    const open = (r: ReturnType<typeof rig>) => r.store.open({ round: 3, bundle, badges: [A, B], amount: 5 }, r.watch);
    const ways: [string, (r: ReturnType<typeof rig>) => Promise<void>][] = [
      ["the POST's answer was lost", async (r) => {
        r.relayer.reachable = false;
        open(r);
        await flush();
        r.relayer.reachable = true;
      }],
      ["the relayer answered 5xx", async (r) => {
        r.relayer.refuseNext(502, "upstream: timed out");
        open(r);
        await flush();
      }],
      ["the relayer went quiet after taking it", async (r) => {
        open(r);
        await flush();
        r.relayer.reachable = false;
        await r.tick(GIVE_UP_MS + POLL_MS);
        r.relayer.reachable = true;
      }],
      ["its transaction failed", async (r) => {
        open(r);
        await flush();
        r.relayer.advance(r.relayer.ids()[0]!, "failed", { error: "reverted" });
        await r.tick(POLL_MS);
      }],
    ];

    it.each(ways)("stays for the sweep, which refunds it, when %s", async (_, lose) => {
      const r = rig();
      await lose(r);
      expect(r.steps.at(-1)?.step).toBe("failed");
      expect([...r.rounds.open("store").keys()]).toEqual([3]);
      r.relayer.posted.length = 0;
      r.reads.openStorePots.add(3);
      r.clock.advance(REFUND_AFTER_MS);
      await r.chain.sweep();
      await flush();
      expect(r.relayer.posted).toEqual([{ path: "/store/refund", body: { box: BOX, round: "3" } }]);
    });

    it.each(ways)("stays for the sweep, which drops it unrefunded if the chain has no pot, when %s", async (_, lose) => {
      const r = rig();
      await lose(r);
      r.relayer.posted.length = 0;
      r.clock.advance(REFUND_AFTER_MS);
      await r.chain.sweep();
      await flush();
      expect(r.relayer.posted).toEqual([]);
      expect(r.rounds.open("store").size).toBe(0);
    });
  });

  it("forgets a pot the Box's key couldn't sign for: nothing left the Box", async () => {
    const r = rig({ sign: () => Promise.reject(new Error("the token is out")), publicKey: () => Promise.reject(new Error("no")), stop: () => {} });
    r.store.open({ round: 3, bundle, badges: [A, B], amount: 5 }, r.watch);
    await flush();
    expect(r.steps.map((u) => [u.step, u.error])).toEqual([["failed", "the token is out"]]);
    expect(r.relayer.posted).toEqual([]);
    expect(r.rounds.open("store").size).toBe(0);
  });

  it("reads Store USDC apart from USDC, and tops it up through its own route", async () => {
    const r = rig();
    r.reads.balances.set(A, 7);
    r.reads.storeBalances.set(A, 90);
    expect(await r.store.balance(A)).toBe(90);
    expect(await r.chain.balance(A)).toBe(7);
    r.store.topup(A, r.watch);
    await flush();
    expect(r.relayer.posted).toEqual([{ path: "/store/topup", body: { player: A } }]);
  });

  it("refunds through its own route, and closes the round once paid", async () => {
    const r = rig();
    r.rounds.opened(8, NOW, "store");
    r.store.refund(8, r.watch);
    await flush();
    expect(r.relayer.posted).toEqual([{ path: "/store/refund", body: { box: BOX, round: "8" } }]);
    r.relayer.advance(r.relayer.ids()[0]!, "done");
    await r.tick(POLL_MS);
    expect(r.rounds.open("store").size).toBe(0);
  });

  it("is swept past its delay through /store/refund, and dropped once the chain has ended it", async () => {
    const r = rig();
    r.rounds.opened(8, NOW, "store");
    r.rounds.opened(9, NOW, "store");
    r.rounds.opened(10, NOW + REFUND_AFTER_MS, "store");
    r.rounds.opened(11, NOW);
    r.reads.openStorePots.add(8);
    r.reads.openPots.add(11);
    r.clock.advance(REFUND_AFTER_MS);
    await r.chain.sweep();
    await flush();
    expect(r.relayer.posted).toEqual([
      { path: "/duel/refund", body: { box: BOX, round: "11" } },
      { path: "/store/refund", body: { box: BOX, round: "8" } },
    ]);
    expect([...r.rounds.open("store").keys()].sort()).toEqual([10, 8]);
    r.relayer.advance(r.relayer.ids()[1]!, "done");
    await r.tick(POLL_MS);
    expect([...r.rounds.open("store").keys()]).toEqual([10]);
  });

  it("keeps its pots across a restart, and reads a file from before them", () => {
    const r = rig();
    r.rounds.opened(8, NOW, "store");
    r.rounds.opened(9, NOW);
    const again = roundsFile(r.file);
    expect([...again.open("store")]).toEqual([[8, NOW]]);
    expect([...again.open()]).toEqual([[9, NOW]]);
    writeFileSync(r.file, JSON.stringify({ next: 4, pots: { "2": 5 } }));
    const old = roundsFile(r.file);
    expect(old.open("store").size).toBe(0);
    expect(old.take()).toBe(4);
  });
});

describe("the judge on the Sepolia port", () => {
  it("sends the exact text it signed, and follows the verifier to paid", async () => {
    const r = rig();
    r.rounds.opened(3, NOW, "store");
    r.store.judge(ORDER, r.hear);
    await flush();

    const [request] = r.verifier.requests;
    const text = request?.log ?? "";
    expect(JSON.parse(text)).toEqual(matchLogOf(BOX, ORDER));
    expect(request?.deadline).toBe(String(DEADLINE));
    const digest = judgeDigest({ box: BOX, round: 3n, log: jsonTextHash(text), deadline: DEADLINE }, STORE_VECTOR.storePot);
    expect(verifyP256(KEY, BigInt(request?.r as Hex), BigInt(request?.s as Hex), hexToBytes(digest))).toBe(true);

    r.verifier.statuses.set(`${BOX}/3`, status("judging"));
    await r.tick(JUDGE_POLL_MS);
    expect(r.said.map((u) => u.step)).toEqual(["judging"]);
    // Asked again with nothing new, it says nothing new.
    await r.tick(JUDGE_POLL_MS);
    expect(r.said).toHaveLength(1);

    r.verifier.statuses.set(`${BOX}/3`, status("paying", { payouts: ["15500000", "4500000"] }));
    await r.tick(JUDGE_POLL_MS);
    r.verifier.statuses.set(`${BOX}/3`, status("paying", { payouts: ["15500000", "4500000"], tx: TX }));
    await r.tick(JUDGE_POLL_MS);
    r.verifier.statuses.set(`${BOX}/3`, status("paid", { payouts: ["15500000", "4500000"], tx: TX }));
    await r.tick(JUDGE_POLL_MS);
    expect(r.said.map((u) => [u.step, u.hash])).toEqual([["judging", null], ["paying", null], ["paying", TX], ["paid", TX]]);
    expect(r.said.at(-1)).toEqual({ step: "paid", payouts: [15.5, 4.5], hash: TX, etherscan: `https://sepolia.etherscan.io/tx/${TX}`, reason: null });
    await r.tick(JUDGE_POLL_MS * 3);
    expect(r.said).toHaveLength(4);
  });

  it("says a refund, with why", async () => {
    const r = rig();
    r.store.judge(ORDER, r.hear);
    await flush();
    r.verifier.statuses.set(`${BOX}/3`, status("refunded", { tx: TX, reason: "the agent couldn't judge" }));
    await r.tick(JUDGE_POLL_MS);
    expect(r.said).toMatchObject([{ step: "refunded", payouts: null, reason: "the agent couldn't judge" }]);
  });

  describe("takes no word of the verifier's as the end of a pot", () => {
    const told = async (state: "paid" | "refunded") => {
      const r = rig();
      r.rounds.opened(3, NOW, "store");
      r.store.judge(ORDER, r.hear);
      await flush();
      r.verifier.statuses.set(`${BOX}/3`, status(state, { tx: TX }));
      await r.tick(JUDGE_POLL_MS);
      expect(r.said.map((u) => u.step)).toEqual([state]);
      expect([...r.rounds.open("store").keys()]).toEqual([3]);
      return r;
    };

    it.each(["paid", "refunded"] as const)("refunds a pot still open on chain after a false %s", async (state) => {
      const r = await told(state);
      r.reads.openStorePots.add(3);
      r.clock.advance(REFUND_AFTER_MS);
      await r.chain.sweep();
      await flush();
      expect(r.relayer.posted).toEqual([{ path: "/store/refund", body: { box: BOX, round: "3" } }]);
    });

    it.each(["paid", "refunded"] as const)("forgets the pot once the chain agrees it is %s", async (state) => {
      const r = await told(state);
      r.clock.advance(REFUND_AFTER_MS);
      await r.chain.sweep();
      await flush();
      expect(r.relayer.posted).toEqual([]);
      expect(r.rounds.open("store").size).toBe(0);
    });
  });

  it("leaves a failed pot for the sweep", async () => {
    const r = rig();
    r.rounds.opened(3, NOW, "store");
    r.store.judge(ORDER, r.hear);
    await flush();
    r.verifier.statuses.set(`${BOX}/3`, status("failed", { reason: "the relayer refused the void" }));
    await r.tick(JUDGE_POLL_MS);
    expect(r.said.map((u) => u.step)).toEqual(["failed"]);
    expect(r.rounds.open("store").size).toBe(1);
  });

  it("fails at once on a refusal, with the verifier's own words", async () => {
    const r = rig();
    r.verifier.reply = { taken: false, again: false, error: "the pot isn't open" };
    r.store.judge(ORDER, r.hear);
    await flush();
    expect(r.said).toMatchObject([{ step: "failed", reason: "the pot isn't open" }]);
    await r.tick(JUDGE_POLL_MS * 2);
    expect(r.verifier.requests).toHaveLength(1);
  });

  it("sends the same request again while the verifier is down", async () => {
    const r = rig();
    r.verifier.reply = { taken: false, again: true, error: "the verifier answered 503" };
    r.store.judge(ORDER, r.hear);
    await flush();
    await r.tick(JUDGE_POLL_MS);
    r.verifier.reply = { taken: true };
    await r.tick(JUDGE_POLL_MS);
    expect(r.verifier.requests).toHaveLength(3);
    expect(new Set(r.verifier.requests.map((request) => JSON.stringify(request))).size).toBe(1);
    expect(r.said).toEqual([]);
  });

  it("gives up on a verifier that never answers, and the pot stays for the sweep", async () => {
    const r = rig();
    r.rounds.opened(3, NOW, "store");
    r.store.judge(ORDER, r.hear);
    await flush();
    for (let waited = 0; waited <= JUDGE_GIVE_UP_MS + JUDGE_POLL_MS; waited += JUDGE_POLL_MS) await r.tick(JUDGE_POLL_MS);
    expect(r.said).toMatchObject([{ step: "failed", reason: "no answer from the verifier" }]);
    expect(r.rounds.open("store").size).toBe(1);
  });

  it("fails when the Box's key can't sign", async () => {
    const r = rig({ sign: () => Promise.reject(new Error("the token is out")), publicKey: () => Promise.reject(new Error("no")), stop: () => {} });
    r.store.judge(ORDER, r.hear);
    await flush();
    expect(r.said).toMatchObject([{ step: "failed", reason: "the token is out" }]);
    expect(r.verifier.requests).toEqual([]);
  });

  it("stops asking when the port stops", async () => {
    const r = rig();
    r.store.judge(ORDER, r.hear);
    await flush();
    r.chain.stop();
    r.verifier.statuses.set(`${BOX}/3`, status("paid", { payouts: ["1", "2"], tx: TX }));
    await r.tick(JUDGE_POLL_MS * 2);
    expect(r.said).toEqual([]);
  });
});

describe("the verifier's HTTP API", () => {
  const reply = (body: unknown, code = 200) => new Response(JSON.stringify(body), { status: code });
  const request = { log: "{}", deadline: "1", r: "0x01", s: "0x02" } as const;

  it("posts a log, and tells a refusal from an outage", async () => {
    const seen: [string, RequestInit | undefined][] = [];
    const answers = [reply({ state: "judging" }, 202), reply({ error: "bad signature" }, 401), reply({}, 503), reply({ error: "rate limit" }, 429)];
    const verifier = verifierAt("https://verifier.example", async (url, init) => {
      seen.push([String(url), init]);
      return answers.shift() as Response;
    });
    expect(await verifier.judge(request)).toEqual({ taken: true });
    expect(await verifier.judge(request)).toEqual({ taken: false, again: false, error: "bad signature" });
    expect(await verifier.judge(request)).toEqual({ taken: false, again: true, error: "the verifier answered 503" });
    expect(await verifier.judge(request)).toEqual({ taken: false, again: true, error: "rate limit" });
    expect(seen[0]?.[0]).toBe("https://verifier.example/judge");
    expect(seen[0]?.[1]?.method).toBe("POST");
    expect(JSON.parse(seen[0]?.[1]?.body as string)).toEqual(request);
    const down = verifierAt("https://verifier.example", () => Promise.reject(new Error("refused")));
    expect(await down.judge(request)).toEqual({ taken: false, again: true, error: "the verifier can't be reached: refused" });
  });

  it("reads a status, and treats anything else as no answer yet", async () => {
    const good = status("paid", { payouts: ["1"], tx: TX, record: TX });
    let answer = reply(good);
    let asked = "";
    const verifier = verifierAt("https://verifier.example", async (url) => {
      asked = String(url);
      return answer;
    });
    expect(await verifier.status(BOX, 3)).toEqual(good);
    expect(asked).toBe("https://verifier.example/judge/mumbai-01/3");
    answer = reply({ error: "no such match" }, 404);
    expect(await verifier.status(BOX, 3)).toBeNull();
    answer = new Response("not json");
    expect(await verifier.status(BOX, 3)).toBeNull();
    const down = verifierAt("https://verifier.example", () => Promise.reject(new Error("refused")));
    expect(await down.status(BOX, 3)).toBeNull();
  });

  it("refuses a status that isn't one", () => {
    const good = status("paying", { payouts: ["1", "0"] });
    expect(parseStatus(good)).toEqual(good);
    for (const bad of [null, "paid", { ...good, state: "won" }, { ...good, payouts: [1] }, { ...good, payouts: ["-1"] }, { ...good, tx: "0x12" }, { ...good, record: 5 }, { ...good, reason: 5 }]) {
      expect(parseStatus(bad)).toBeNull();
    }
  });
});
