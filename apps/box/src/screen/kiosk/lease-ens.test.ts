import { describe, expect, it } from "vitest";
import type { AdminJob } from "../../server/admin-wire.ts";
import type { LeaseReply, LeaseStatus } from "../../server/lease-wire.ts";
import { ensCards, ensVerdict, pendingWrites } from "./lease-ens.ts";

const NOW = 1_000_000;
const status: LeaseStatus = {
  label: "mumbai-01",
  name: "mumbai-01.gamebox.eth",
  standing: "active",
  expiry: NOW + 30 * 86_400,
  startedAt: NOW - 3_600,
  endsAt: NOW + 7_200,
  stake: "3000",
  operator: "0x0000000000000000000000000000000000000001",
  ratePerHour: "1000",
  minHours: 1,
  maxHours: 720,
  gbx: "10000",
  ens: { lease: "0x01", names: "0x02", registry: "0x03", resolver: "0x04" },
};
const job = (what: string): AdminJob => ({ id: 1, what, status: "running", steps: [], error: null, at: 0 });
const reply = (gate: LeaseReply["gate"], s: Partial<LeaseStatus> | null, jobs: AdminJob[] = []): LeaseReply => ({
  gate,
  now: NOW,
  status: s && { ...status, ...s },
  staker: null,
  error: null,
  jobs,
});
const states = (r: LeaseReply): string => Object.values(ensCards(r, NOW)).map((c) => c.state).join();

describe("the lease's ENS map", () => {
  it("shows every record holding while leased", () => {
    const cards = ensCards(reply("open", {}), NOW);
    expect(states(reply("open", {}))).toBe("pass,pass,pass,pass");
    expect(cards.resolver.value).toBe('"active"');
    expect(cards.registry.note).toBe("TTL 30D");
    expect(ensVerdict(reply("open", {}), NOW).online).toBe(true);
  });

  it("says which record keeps the Box offline", () => {
    const unstaked = reply("closed", { standing: "suspended", startedAt: null, endsAt: null });
    expect(states(unstaked)).toBe("fail,pass,pass,fail");
    expect(ensCards(unstaked, NOW).resolver.value).toBe('"suspended"');
    expect(ensVerdict(unstaked, NOW).words).toBe('OFFLINE · RESOLVER STATUS "SUSPENDED"');
    expect(ensVerdict(reply("closed", { standing: "none", endsAt: null }), NOW).words).toBe("OFFLINE · NO NAME ON GAMEBOX.ETH");
    expect(ensVerdict(reply("closed", { endsAt: NOW - 1 }), NOW).words).toBe("OFFLINE · NO GBX STAKED");
    expect(ensVerdict(reply("checking", null), NOW).words).toBe("READING SEPOLIA…");
  });

  it("knows which records a running stake or unstake writes", () => {
    expect([...pendingWrites(reply("open", {}, [job("unstake mumbai-01.gamebox.eth")]))]).toEqual(["lease", "names", "resolver"]);
    expect([...pendingWrites(reply("closed", { standing: "suspended" }, [job("stake 3h on mumbai-01.gamebox.eth")]))]).toEqual([
      "lease",
      "names",
      "registry",
      "resolver",
    ]);
    expect([...pendingWrites(reply("open", {}, [job("stake 3h on mumbai-01.gamebox.eth")]))]).toEqual(["lease", "names", "registry"]);
    expect(pendingWrites(reply("open", {})).size).toBe(0);
  });
});
