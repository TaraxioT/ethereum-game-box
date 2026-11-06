// Where the Box meets the relayer. Every other test here stands in a mock relayer that takes any body, so this one puts
// what the real chain port sends, signed by the Box's real signer, through the relayer's real routes and checks.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOX, BOX_ACCOUNT, NOW, STORE_POT, STORE_USDC, World } from "@egb/relayer/test/world";
import { fakeUsdcAbi, P256_VECTOR_KEY, storePotAbi, usdc } from "@egb/shared/names";
import { decodeFunctionData, type Abi, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { createFakeClock } from "../core/fake-clock.ts";
import type { ChainTxUpdate } from "../core/ports.ts";
import { softwareSigner } from "../signer/software.ts";
import { createSepoliaChain } from "./port.ts";
import { relayerAt } from "./relayer.ts";
import { roundsFile } from "./rounds.ts";
import { memoryReads, mockVerifier } from "./testing.ts";

const A: Address = "0x1000000000000000000000000000000000000001";
const B: Address = "0x2000000000000000000000000000000000000002";
const BUNDLE = `0x${"ab".repeat(32)}` as const;
const ZERO = `0x${"00".repeat(32)}` as const;

/** The relayer's world, with the Box's key on `GameBoxNames`, and the real port talking to its routes over `relayerAt`. */
function rig() {
  const world = new World();
  const box = world.boxes.get(BOX);
  if (!box) throw new Error("the world has no Box");
  world.boxes.set(BOX, { ...box, qx: P256_VECTOR_KEY.qx, qy: P256_VECTOR_KEY.qy });
  world.addAccount(BOX_ACCOUNT, P256_VECTOR_KEY);
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    const reply = init?.method === "POST" ? await world.post(path, JSON.parse(String(init.body))) : await world.get(path);
    return Response.json(reply.body, { status: reply.status });
  };
  const { store } = createSepoliaChain({
    box: BOX,
    signer: softwareSigner(P256_VECTOR_KEY.privateKey),
    relayer: relayerAt("https://relayer.test", fetcher),
    reads: memoryReads(),
    rounds: roundsFile(join(mkdtempSync(join(tmpdir(), "egb-relayer-")), "rounds.json")),
    clock: createFakeClock(NOW * 1000),
    log: () => {},
    contracts: { duelPot: `0x${"11".repeat(20)}`, boxResults: `0x${"22".repeat(20)}`, boxSeats: `0x${"33".repeat(20)}` },
    store: { storePot: STORE_POT, verifier: mockVerifier() },
  });
  if (!store) throw new Error("no store port");
  const steps: ChainTxUpdate[] = [];
  return { world, store, steps, watch: (step: ChainTxUpdate) => void steps.push(step) };
}

/** What reached the chain, once it has. */
async function sent(world: World, abi: Abi) {
  await vi.waitFor(() => expect(world.chain.sent).toHaveLength(1));
  const tx = world.chain.sent[0];
  if (!tx?.data) throw new Error("no calldata");
  return { to: tx.to, ...decodeFunctionData({ abi, data: tx.data }) };
}

describe("what the Box sends the relayer for a store game", () => {
  it("opens a pot: its signed Stake passes every check, and the chain gets the same stake", async () => {
    const { world, store, steps, watch } = rig();
    world.listed.add(BUNDLE);
    world.storeUsdc.set(A.toLowerCase(), usdc(100)).set(B.toLowerCase(), usdc(100));

    store.open({ round: 1, bundle: BUNDLE, badges: [A, B], amount: 10 }, watch);

    const { to, functionName, args } = await sent(world, storePotAbi as Abi);
    expect({ to, functionName }).toEqual({ to: STORE_POT, functionName: "open" });
    expect(args?.[0]).toMatchObject({ box: BOX, bundle: BUNDLE, round: 1n, players: [A, B], amount: usdc(10), deadline: BigInt(NOW + 600) });
    await vi.waitFor(() => expect(steps.at(-1)?.step).toBe("sent"));
  });

  it("is refused a bundle the team never listed, and nothing reaches the chain", async () => {
    const { world, store, steps, watch } = rig();
    world.storeUsdc.set(A.toLowerCase(), usdc(100)).set(B.toLowerCase(), usdc(100));

    store.open({ round: 1, bundle: BUNDLE, badges: [A, B], amount: 10 }, watch);

    await vi.waitFor(() => expect(steps.at(-1)).toMatchObject({ step: "failed", error: expect.stringContaining("is not listed") }));
    expect(world.chain.sent).toHaveLength(0);
  });

  it("refunds a pot past its delay", async () => {
    const { world, store, watch } = rig();
    world.storePots.set(`${BOX}:1`, { players: [A, B], amount: usdc(10), opened: BigInt(NOW - 3700), state: 1, bundle: BUNDLE, record: ZERO });

    store.refund(1, watch);

    const { to, functionName, args } = await sent(world, storePotAbi as Abi);
    expect({ to, functionName, args }).toEqual({ to: STORE_POT, functionName: "refund", args: [BOX, 1n] });
  });

  it("tops a badge up in Store USDC, not the Box's USDC", async () => {
    const { world, store, watch } = rig();

    store.topup(A, watch);

    const { to, functionName, args } = await sent(world, fakeUsdcAbi as Abi);
    expect({ to, functionName, args }).toEqual({ to: STORE_USDC, functionName: "mint", args: [A, usdc(100)] });
  });
});
