// The directory folds `GameBoxNames`' and `Championships`' events: a pop-up is listed with the Box it links to, a Box's
// key rotation moves its account, and a championship is open until it closes.
import { getAddress, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";

import { apply, closedCups, emptyDirectory, hasWinner, openCups } from "./directory.ts";

const OPERATOR = getAddress("0xef4a00000000000000000000000000000000020f");
const OLD = getAddress("0x3dfbc6d78b0d28134178a03041468d0e9a18d082");
const NEW = getAddress("0x5e1d000000000000000000000000000000000a11");
const RESOLVER = getAddress("0x91b2000000000000000000000000000000077c40");
const ZERO32 = `0x${"00".repeat(32)}` as const;

// Only the fields `apply` reads; the rest of a viem log doesn't matter here.
const log = (eventName: string, args: Record<string, unknown>, blockNumber = 10n) =>
  ({ eventName, args, blockNumber, transactionHash: ZERO32 }) as unknown as Parameters<typeof apply>[1];

describe("the directory", () => {
  it("lists a pop-up apart from the Boxes, with the Box it is linked to and its expiry", () => {
    const dir = emptyDirectory(1n);
    apply(dir, log("BoxRegistered", { label: "mumbai-01", operator: OPERATOR, account: OLD, resolver: RESOLVER, qx: ZERO32, qy: ZERO32, expiry: 9n }));
    apply(dir, log("PopupRegistered", { label: "popup-k3x9", ofBox: "mumbai-01", operator: OPERATOR, expiry: 600n }, 12n));
    expect([...dir.boxes.keys()]).toEqual(["mumbai-01"]);
    expect(dir.popups.get("popup-k3x9")).toEqual({ label: "popup-k3x9", ofBox: "mumbai-01", operator: OPERATOR, expiry: 600n, block: 12n });
  });

  it("moves a Box's account when its key is rotated", () => {
    const dir = emptyDirectory(1n);
    apply(dir, log("BoxRegistered", { label: "mumbai-01", operator: OPERATOR, account: OLD, resolver: RESOLVER, qx: ZERO32, qy: ZERO32, expiry: 9n }));
    apply(dir, log("BoxKeyChanged", { label: "mumbai-01", account: NEW, qx: ZERO32, qy: ZERO32 }));
    expect(dir.boxes.get("mumbai-01")?.account).toBe(NEW);
  });
});

describe("championships in the directory", () => {
  const WINNER = getAddress("0x7a11000000000000000000000000000000000b0b");
  const opened = (id: bigint, label: string, block: bigint) =>
    log("CupOpened", { id, game: "stockduel", label, resolver: RESOLVER, ends: 1_800n, prize: 100_000_000n, opener: OPERATOR }, block);

  it("lists a championship by id under its full name, open until CupClosed", () => {
    const dir = emptyDirectory(1n);
    apply(dir, opened(1n, "mumbai-cup", 20n));
    expect(dir.cups.get(1n)).toMatchObject({ name: "mumbai-cup.stockduel.gamebox.eth", ends: 1_800n, prize: 100_000_000n, closed: null });
    expect(openCups(dir).map((c) => c.id)).toEqual([1n]);
    apply(dir, log("CupClosed", { id: 1n, game: "stockduel", label: "mumbai-cup", winner: WINNER, prize: 100_000_000n }, 30n));
    expect(openCups(dir)).toEqual([]);
    expect(dir.cups.get(1n)?.closed).toEqual({ winner: WINNER, prize: 100_000_000n, block: 30n, hash: ZERO32 });
    expect(hasWinner(dir.cups.get(1n)!)).toBe(true);
  });

  it("lists the latest close first, and a championship nobody played has no winner", () => {
    const dir = emptyDirectory(1n);
    apply(dir, opened(1n, "mumbai-cup", 20n));
    apply(dir, log("CupClosed", { id: 1n, game: "stockduel", label: "mumbai-cup", winner: WINNER, prize: 1n }, 30n));
    apply(dir, opened(2n, "empty-cup", 40n));
    apply(dir, log("CupClosed", { id: 2n, game: "stockduel", label: "empty-cup", winner: zeroAddress, prize: 1n }, 50n));
    expect(closedCups(dir).map((c) => c.id)).toEqual([2n, 1n]);
    expect(closedCups(dir).find(hasWinner)?.label).toBe("mumbai-cup");
  });
});
