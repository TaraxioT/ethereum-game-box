// The ENS reads against a mocked transport playing the Universal Resolver: a name that doesn't resolve reads as null,
// and a name that stops resolving reads as null on the next read, never as its last value.
import {
  type Hex,
  type PublicClient,
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  getAddress,
  stringToHex,
  zeroAddress,
} from "viem";
import { sepolia } from "viem/chains";
import { universalResolverAbi } from "@egb/shared/names";
import { describe, expect, it } from "vitest";

import { readAddress, readText, readTexts } from "./ens.ts";

const BADGE = getAddress("0x8e4f000000000000000000000000000000012ab0");
const RESOLVER = "0x91b2000000000000000000000000000000077c40";

/** viem calls `resolveWithGateways(name, data, gateways)`; this is its ABI. */
const resolveWithGatewaysAbi = [
  {
    type: "function",
    name: "resolveWithGateways",
    stateMutability: "view",
    inputs: [
      { name: "name", type: "bytes" },
      { name: "data", type: "bytes" },
      { name: "gateways", type: "string[]" },
    ],
    outputs: [
      { name: "", type: "bytes" },
      { name: "", type: "address" },
    ],
  },
] as const;

/** A Universal Resolver that knows `live` names (with an addr and a `stats` record) and reverts for every other. */
function mockResolver(live: Set<string>): PublicClient {
  const request = async ({ method, params }: { method: string; params?: unknown }) => {
    if (method === "eth_chainId") return "0xaa36a7";
    if (method !== "eth_call") throw new Error(`unexpected ${method}`);
    const [{ data }] = params as [{ data: Hex }];
    const call = decodeFunctionData({ abi: resolveWithGatewaysAbi, data });
    const dns = call.args[0];
    const name = decodeDns(dns);
    if (!live.has(name)) {
      const revert = encodeErrorResult({ abi: universalResolverAbi, errorName: "ResolverNotFound", args: [dns] });
      throw Object.assign(new Error("execution reverted"), { code: 3, data: revert });
    }
    const inner = call.args[1];
    // addr(bytes32) is 0x3b3b57de; text(bytes32,string) is 0x59d1d43c.
    const answer = inner.startsWith("0x3b3b57de")
      ? encodeAbiParameters([{ type: "address" }], [BADGE])
      : encodeAbiParameters([{ type: "string" }], [inner.startsWith("0x59d1d43c") && inner.includes(stringToHex("stats").slice(2)) ? '{"quickdraw":{"wins":1,"losses":0,"draws":0}}' : ""]);
    return encodeAbiParameters([{ type: "bytes" }, { type: "address" }], [answer, RESOLVER]);
  };
  return createPublicClient({ chain: sepolia, transport: custom({ request }) });
}

function decodeDns(dns: Hex): string {
  const bytes = Buffer.from(dns.slice(2), "hex");
  const labels: string[] = [];
  for (let i = 0; bytes[i]; i += bytes[i]! + 1) labels.push(bytes.subarray(i + 1, i + 1 + bytes[i]!).toString());
  return labels.join(".");
}

describe("ENS reads", () => {
  it("reads a live name's addr and text", async () => {
    const client = mockResolver(new Set(["nova.gamebox.eth"]));
    expect(await readAddress(client, "nova.gamebox.eth")).toBe(BADGE);
    expect(await readText(client, "nova.gamebox.eth", "stats")).toBe('{"quickdraw":{"wins":1,"losses":0,"draws":0}}');
  });

  it("reads a name that doesn't resolve as null, never as zero or an error", async () => {
    const client = mockResolver(new Set());
    expect(await readAddress(client, "popup-gone.gamebox.eth")).toBeNull();
    expect(await readText(client, "popup-gone.gamebox.eth", "status")).toBeNull();
    expect(await readAddress(client, "popup-gone.gamebox.eth")).not.toBe(zeroAddress);
  });

  it("reads null once a name stops resolving, not its last value", async () => {
    const live = new Set(["popup-k3x9.gamebox.eth"]);
    const client = mockResolver(live);
    expect(await readAddress(client, "popup-k3x9.gamebox.eth")).toBe(BADGE);
    live.delete("popup-k3x9.gamebox.eth");
    expect(await readAddress(client, "popup-k3x9.gamebox.eth")).toBeNull();
  });

  it("reads an empty record as null", async () => {
    const client = mockResolver(new Set(["nova.gamebox.eth"]));
    expect(await readTexts(client, "nova.gamebox.eth", ["url", "stats"])).toEqual({
      url: null,
      stats: '{"quickdraw":{"wins":1,"losses":0,"draws":0}}',
    });
  });
});
