import { type AdminCall, type AdminSender, type LeaseView } from "@egb/shared/admin";
import { boxLeaseAbi } from "@egb/shared/names";
import { type Address, type Hex, decodeFunctionData, parseEther } from "viem";
import { describe, expect, it } from "vitest";
import type { Core } from "../core/core.ts";
import { createFakeClock } from "../core/fake-clock.ts";
import { HttpError } from "./http.ts";
import { gatedCore } from "./lease-gate.ts";
import { type LeasePorts, createLeaseWatch, LEASE_POLL_MS } from "./lease.ts";

const ADMIN: Address = "0xB2b6B516Df4B159c0E4Eb1d6D7D65a5f2F04C30E";
const OTHER: Address = "0x000000000000000000000000000000000000dEaD";
const KEY = { qx: `0x${"11".repeat(32)}` as Hex, qy: `0x${"22".repeat(32)}` as Hex };
const NOW = 1_800_000_000;

function leased(end = NOW + 7_200, operator: Address = ADMIN): LeaseView {
  return {
    label: "mumbai-01",
    name: "mumbai-01.gamebox.eth",
    standing: "active",
    expiry: NOW + 30 * 86_400,
    resolver: "0x00000000000000000000000000000000000000E5",
    key: KEY,
    lease: { operator, stake: parseEther("300"), start: NOW - 3_600, end },
    now: NOW,
    ratePerHour: parseEther("100"),
    minHours: 1,
    maxHours: 720,
    staker: { address: ADMIN, gbx: parseEther("1000"), allowance: parseEther("1000") },
  };
}

const suspended = (): LeaseView => ({ ...leased(), standing: "suspended", lease: null });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A watch over reads that answer `chain.view` and a sender that records each batch. */
function rig(first: LeaseView, staker = true) {
  const clock = createFakeClock(0);
  const chain = { view: first };
  const batches: AdminCall[][] = [];
  const sender: AdminSender = {
    async send(calls, onSent) {
      batches.push([...calls]);
      for (const c of calls) onSent?.(c.what, `0x${"ab".repeat(32)}`);
      return [];
    },
  };
  const ports: LeasePorts = {
    label: "mumbai-01",
    reads: { view: async () => chain.view },
    key: async () => KEY,
    staker: staker ? { address: ADMIN, sender } : null,
    clock,
    log: () => {},
  };
  const watch = createLeaseWatch(ports);
  const gates: string[] = [];
  watch.onGate((gate) => gates.push(gate));
  return { watch, chain, batches, clock, gates };
}

const fnOf = (call: AdminCall | undefined) => (call ? decodeFunctionData({ abi: boxLeaseAbi, data: call.data }).functionName : null);

describe("the lease watch", () => {
  it("is checking until the first read, then open while GBX is staked", async () => {
    const { watch, gates } = rig(leased());
    expect(watch.gate()).toBe("checking");
    await flush();
    expect(watch.gate()).toBe("open");
    expect(gates).toEqual(["open"]);
    const reply = watch.reply();
    expect(reply.status).toMatchObject({ name: "mumbai-01.gamebox.eth", stake: "300", endsAt: NOW + 7_200, ratePerHour: "100" });
    expect(reply.staker).toBe(ADMIN);
  });

  it("closes the moment the lease runs out, and closes it on chain once", async () => {
    const { watch, batches, clock, gates } = rig(leased(NOW + 5));
    await flush();
    clock.advance(6_000);
    expect(watch.gate()).toBe("closed");
    expect(gates).toEqual(["open", "closed"]);
    await flush();
    expect(batches.map((b) => fnOf(b[0]))).toEqual(["lapse"]);
    clock.advance(2_000);
    await flush();
    expect(batches).toHaveLength(1);
  });

  it("unstakes from the admin key, and closes when the chain says so", async () => {
    const { watch, chain, batches, clock } = rig(leased());
    await flush();
    const job = await watch.unstake();
    expect(job.what).toBe("unstake mumbai-01.gamebox.eth");
    await flush();
    expect(fnOf(batches[0]?.[0])).toBe("unstake");
    chain.view = suspended();
    clock.advance(LEASE_POLL_MS);
    await flush();
    expect(watch.gate()).toBe("closed");
  });

  it("stakes the Box's own key for the hours asked", async () => {
    const { watch, batches } = rig(suspended());
    await flush();
    expect(watch.gate()).toBe("closed");
    await watch.stake({ hours: 3 });
    await flush();
    expect(decodeFunctionData({ abi: boxLeaseAbi, data: batches[0]![0]!.data }).args).toEqual(["mumbai-01", KEY.qx, KEY.qy, 3n]);
    await expect(watch.stake({ hours: 0 })).rejects.toThrow(HttpError);
    await expect(watch.stake({})).rejects.toThrow(/hours/);
  });

  it("refuses to unstake another operator's lease, or with no admin key", async () => {
    const other = rig(leased(NOW + 7_200, OTHER));
    await flush();
    await expect(other.watch.unstake()).rejects.toThrow(/only they can unstake/);
    const watching = rig(leased(), false);
    await flush();
    await expect(watching.watch.unstake()).rejects.toThrow(/EGB_ADMIN_KEY/);
  });
});

describe("the gated core", () => {
  function fake() {
    const seen: string[] = [];
    const core = {
      tap: (event: { phase: string }) => seen.push(`tap ${event.phase}`),
      send: (command: { type: string }) => seen.push(command.type),
    } as unknown as Core;
    return { core, seen };
  }

  it("lets everything through while the Box hosts", () => {
    const { core, seen } = fake();
    const gated = gatedCore(core, () => true, () => seen.push("refused"));
    gated.tap({ phase: "touch", tap: 1, seat: 0, at: 0, badge: null }, "station");
    gated.send({ type: "play" });
    expect(seen).toEqual(["tap touch", "play"]);
  });

  it("refuses taps with a buzz and drops commands but booted while it doesn't", () => {
    const { core, seen } = fake();
    const gated = gatedCore(core, () => false, (seat) => seen.push(`refused ${seat}`));
    gated.tap({ phase: "touch", tap: 1, seat: 1, at: 0, badge: null }, "station");
    gated.send({ type: "play" });
    gated.send({ type: "booted" });
    expect(seen).toEqual(["refused 1", "booted"]);
  });
});
