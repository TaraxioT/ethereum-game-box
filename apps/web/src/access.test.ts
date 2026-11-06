// The role table and the Try grid's decoding, against recorded resolver reads and `eth_call` results.
import { encodeErrorResult, getAddress } from "viem";
import { RESOLVER_ROLES, permissionedResolverAbi, textResource } from "@egb/shared/names";
import { describe, expect, it } from "vitest";

import { decodeRoleRow, dnsEncode, keyResource, tryCell } from "./access.ts";

const badge = { label: "nova", role: "badge", address: getAddress("0x8e4f000000000000000000000000000000012ab0") };
const stats = { label: "PlayerStats", role: "stats writer", address: getAddress("0x2b7d000000000000000000000000000000009e10") };

describe("the role table", () => {
  it("decodes a badge's root bitmap into role names, admins included", () => {
    const row = decodeRoleRow(badge, {
      root: RESOLVER_ROLES.SET_TEXT | RESOLVER_ROLES.SET_ADDRESS | RESOLVER_ROLES.SET_TEXT_ADMIN,
      keys: { stats: { bitmap: 0n, has: true } },
    });
    expect(row.root).toEqual(["SET_ADDRESS", "SET_TEXT", "SET_TEXT_ADMIN"]);
    expect(row.keys.stats).toEqual({ roles: [], mayWrite: true });
  });

  it("decodes PlayerStats: SET_TEXT on stats alone", () => {
    const row = decodeRoleRow(stats, {
      root: 0n,
      keys: { stats: { bitmap: RESOLVER_ROLES.SET_TEXT, has: true }, avatar: { bitmap: 0n, has: false } },
    });
    expect(row.root).toEqual([]);
    expect(row.keys).toEqual({ stats: { roles: ["SET_TEXT"], mayWrite: true }, avatar: { roles: [], mayWrite: false } });
  });

  it("finds a text key's resource and the addr record's", () => {
    expect(keyResource("stats")).toEqual({ resource: textResource("stats"), role: RESOLVER_ROLES.SET_TEXT });
    expect(keyResource("addr").role).toBe(RESOLVER_ROLES.SET_ADDRESS);
  });

  it("encodes a name in DNS wire format", () => {
    expect(dnsEncode("nova.gamebox.eth")).toBe("0x046e6f76610767616d65626f780365746800");
  });
});

describe("the Try grid", () => {
  it("reads a successful eth_call as allowed", () => {
    expect(tryCell({ ok: true })).toEqual({ allowed: true });
  });

  it("decodes a refusal to its error name and arguments", () => {
    const data = encodeErrorResult({
      abi: permissionedResolverAbi,
      errorName: "EACUnauthorizedAccountRoles",
      args: [textResource("avatar"), RESOLVER_ROLES.SET_TEXT, stats.address],
    });
    const cell = tryCell({ ok: false, data, message: "execution reverted" });
    expect(cell).toEqual({ allowed: false, error: "EACUnauthorizedAccountRoles", args: [textResource("avatar"), RESOLVER_ROLES.SET_TEXT, stats.address] });
  });

  it("falls back to the node's message when a revert carries no data", () => {
    expect(tryCell({ ok: false, data: null, message: "out of gas" })).toEqual({ allowed: false, error: "out of gas", args: [] });
  });
});
