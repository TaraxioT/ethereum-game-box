// Each account's kind: an EOA (no code, or an EIP-7702 delegation), a P256Account (its factory gives its own address
// back for its key), or another contract.
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";

import { accountKind } from "./kinds.ts";

const ACCOUNT = getAddress("0x3dfbc6d78b0d28134178a03041468d0e9a18d082");
const OTHER = getAddress("0x22609bb56f41ea3a995560536d249e5b46c12830");

describe("account kinds", () => {
  it("no code is an EOA", () => {
    expect(accountKind(ACCOUNT, { code: undefined, factoryAccount: null })).toBe("EOA");
    expect(accountKind(ACCOUNT, { code: "0x", factoryAccount: null })).toBe("EOA");
  });

  it("an EIP-7702 delegation is still an EOA", () => {
    expect(accountKind(ACCOUNT, { code: `0xef0100${"ab".repeat(20)}`, factoryAccount: null })).toBe("EOA");
  });

  it("code whose key the factory maps back to it is a P256Account", () => {
    expect(accountKind(ACCOUNT, { code: "0x6080", factoryAccount: ACCOUNT.toLowerCase() as `0x${string}` })).toBe("P256Account");
  });

  it("a key the factory maps elsewhere, or no key at all, is just a contract", () => {
    expect(accountKind(ACCOUNT, { code: "0x6080", factoryAccount: OTHER })).toBe("contract");
    expect(accountKind(ACCOUNT, { code: "0x6080", factoryAccount: null })).toBe("contract");
  });
});
