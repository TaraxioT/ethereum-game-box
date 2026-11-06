import { type AdminCall, type AdminSender, type AdminView, AdminRefused } from "@egb/shared/admin";
import { championshipsAbi, contractAddress, fakeUsdcAbi, usdc } from "@egb/shared/names";
import { type Address, type Hex, decodeFunctionData } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { type AdminPorts, createAdmin } from "./admin.ts";
import { ADMIN, type AdminJob, type AdminReply } from "./admin-wire.ts";
import { call } from "./builder-testing.ts";
import { HttpError } from "./http.ts";
import { startTestBox, type TestBox } from "./testing.ts";

const ADDRESS: Address = "0xB2b6B516Df4B159c0E4Eb1d6D7D65a5f2F04C30E";
const NOW_MS = 1_800_000_000_000;

const VIEW: AdminView = {
  admin: ADDRESS,
  block: 12_080_000n,
  now: NOW_MS / 1000,
  eth: 4_700_000_000_000_000_000n,
  usdc: 0n,
  roles: { games: true, cups: true, minter: true },
  games: [
    {
      label: "quickdraw",
      name: "quickdraw.gamebox.eth",
      titleTerm: 900,
      title: { name: "champion.quickdraw.gamebox.eth", holder: null, holderName: null, streak: 0, expiry: 0, live: false },
      openCup: 3n,
    },
  ],
  cups: [{ id: 3n, game: "quickdraw", label: "demo-cup", name: "demo-cup.quickdraw.gamebox.eth", ends: NOW_MS / 1000 + 60, prize: usdc(5), closed: false, winner: null, winnerName: null, leader: null }],
};

/** Ports in memory: reads that count, and a sender that records each batch and answers from `outcome`. */
function rig(outcome: (calls: readonly AdminCall[]) => Promise<void> = async () => undefined) {
  const batches: AdminCall[][] = [];
  const logs: string[] = [];
  let reads = 0;
  let now = NOW_MS;
  const sender: AdminSender = {
    async send(calls, onSent) {
      batches.push([...calls]);
      for (const [i, c] of calls.entries()) onSent?.(c.what, `0x${String(i + 1).padStart(64, "0")}` as Hex);
      await outcome(calls);
      return [];
    },
  };
  const ports: AdminPorts = {
    address: ADDRESS,
    reads: { view: async () => (reads++, VIEW) },
    sender,
    funds: async () => ({ balance: usdc(2), allowance: 0n }),
    now: () => now,
    log: (text) => logs.push(text),
  };
  return { admin: createAdmin(ports), batches, logs, reads: () => reads, tick: (ms: number) => (now += ms) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the admin", () => {
  it("answers the chain's view with amounts as strings, read again only once it is 3 s old", async () => {
    const r = rig();
    const reply = (await r.admin.reply()) as Extract<AdminReply, { enabled: true }>;
    expect(reply.view).toMatchObject({ block: "12080000", eth: "4.7", usdc: "0", games: [{ openCup: "3" }], cups: [{ id: "3", prize: "5" }] });
    await r.admin.reply();
    expect(r.reads()).toBe(1);
    r.tick(3_001);
    await r.admin.reply();
    expect(r.reads()).toBe(2);
  });

  it("adds a game as a job, its transactions followed to done", async () => {
    const r = rig();
    const job = r.admin.addGame({ label: " TapWar ", titleTerm: 120 });
    expect(job).toMatchObject({ id: 1, status: "running", what: "add game tapwar.gamebox.eth (title term 2m)" });
    await settle();
    const reply = (await r.admin.reply()) as Extract<AdminReply, { enabled: true }>;
    expect(reply.jobs[0]).toMatchObject({ status: "done", steps: [{ etherscan: expect.stringMatching(/^https:\/\/sepolia\.etherscan\.io\/tx\/0x0+1$/) }] });
    expect(r.logs).toContain("admin: job 1 done");
  });

  it("refuses bad input with a 400 before any job starts", () => {
    const r = rig();
    const status = (run: () => unknown): number | null => {
      try {
        run();
        return null;
      } catch (error) {
        return error instanceof HttpError ? error.status : -1;
      }
    };
    expect(status(() => r.admin.addGame({ label: "x", titleTerm: 120 }))).toBe(400);
    expect(status(() => r.admin.addGame({ label: "tapwar", titleTerm: "2m" }))).toBe(400);
    expect(status(() => r.admin.addGame([]))).toBe(400);
    expect(status(() => r.admin.closeCup({ game: "" }))).toBe(400);
    expect(r.batches).toEqual([]);
  });

  it("opens a championship with its prize minted short and approved first", async () => {
    const r = rig();
    const job = await r.admin.openCup({ game: "quickdraw", label: "demo-cup", runSeconds: 300, prize: "5" });
    expect(job.what).toBe("open demo-cup.quickdraw.gamebox.eth for 5m, prize 5 USDC");
    const [batch = []] = r.batches;
    expect(batch.map((c) => decodeFunctionData({ abi: [...fakeUsdcAbi, ...championshipsAbi], data: c.data }))).toEqual([
      { functionName: "mint", args: [ADDRESS, usdc(3)] },
      { functionName: "approve", args: [contractAddress("Championships"), usdc(5)] },
      { functionName: "open", args: ["quickdraw", "demo-cup", BigInt(NOW_MS / 1000 + 300), usdc(5)] },
    ]);
    await expect(r.admin.openCup({ game: "quickdraw", label: "demo-cup", runSeconds: 300, prize: "five" })).rejects.toThrow(/prize must be USDC/);
  });

  it("fails a refused job with the contract's error, and never shows an RPC URL", async () => {
    let n = 0;
    const r = rig(async () => {
      if (n++ === 0) throw new AdminRefused("close quickdraw's championship", "NotOver");
      throw new Error("HTTP request failed. URL: https://rpc.example/v2/secret-key");
    });
    r.admin.closeCup({ game: "quickdraw" });
    r.admin.closeCup({ game: "quickdraw" });
    await settle();
    const { jobs } = (await r.admin.reply()) as Extract<AdminReply, { enabled: true }>;
    expect(jobs.map((j: AdminJob) => [j.status, j.error])).toEqual([
      ["failed", "HTTP request failed. URL: <rpc>"],
      ["failed", "close quickdraw's championship: NotOver"],
    ]);
    expect(r.logs.join("\n")).not.toContain("secret-key");
  });
});

describe("the admin routes", () => {
  let t: TestBox | null = null;
  afterEach(async () => {
    await t?.stop();
    t = null;
  });

  it("need the launcher token, and say when the Box has no admin key", async () => {
    t = await startTestBox();
    expect((await call(t.box, "GET", ADMIN.status, undefined, { "x-egb-launcher": "wrong" })).status).toBe(403);
    expect(await (await call(t.box, "GET", ADMIN.status)).json()).toEqual({ enabled: false });
    const res = await call(t.box, "POST", ADMIN.game, { label: "tapwar", titleTerm: 120 });
    expect(res.status).toBe(409);
    expect(await res.text()).toMatch(/EGB_ADMIN_KEY/);
  });
});
