// The directory folds `GameBoxNames`' events: a pop-up is listed with the Box it links to, and a Box's key rotation
// moves its account.
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";

import { apply, emptyDirectory } from "./directory.ts";

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
