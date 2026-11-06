// Records one live player name's role reads and Try `eth_call` results for access.test.ts. It stores the raw chain
// answers only; the test's expectations are written by hand from the design, so the test isn't the decoder grading
// itself.
//   node apps/web/scripts/record-access.ts <player label> [stranger address]
import { writeFileSync } from "node:fs";
import { type Address, type Hex, createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { ROOT_RESOURCE, contractAddress, ensAddress, fullName, permissionedResolverAbi } from "@egb/shared/names";

import { callOutcome, keyResource, writeCall } from "../src/access.ts";

const [label, stranger] = process.argv.slice(2);
if (!label) throw new Error("usage: record-access.ts <player label> [stranger address]");
const client = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com") });
const name = fullName(label);
const block = await client.getBlockNumber();
const universalResolverAddress = ensAddress("UniversalResolver");
const badge = await client.getEnsAddress({ name, universalResolverAddress, blockNumber: block });
const resolver = (await client.getEnsResolver({ name, universalResolverAddress, blockNumber: block })) as Address;
if (!badge) throw new Error(`${name} doesn't resolve`);

const accounts: { account: string; address: Address }[] = [
  { account: "badge", address: badge },
  { account: "PlayerStats", address: contractAddress("PlayerStats") },
  { account: "GameBoxNames", address: contractAddress("GameBoxNames") },
  ...(stranger ? [{ account: "stranger", address: stranger as Address }] : []),
];
const keys = ["addr", "stats", "avatar"];
const at = { address: resolver, abi: permissionedResolverAbi, blockNumber: block } as const;

const roles = [];
const calls = [];
for (const { account, address } of accounts) {
  const root = await client.readContract({ ...at, functionName: "roles", args: [ROOT_RESOURCE, address] });
  const perKey: Record<string, { bitmap: string; has: boolean }> = {};
  for (const key of keys) {
    const { resource, role } = keyResource(key);
    const bitmap = await client.readContract({ ...at, functionName: "roles", args: [resource, address] });
    const has = await client.readContract({ ...at, functionName: "hasRoles", args: [resource, role, address] });
    perKey[key] = { bitmap: `0x${bitmap.toString(16)}`, has };
    const outcome = await callOutcome(client, address, resolver, writeCall(name, key, address));
    calls.push({ account, key, ok: outcome.ok, data: outcome.ok ? null : (outcome.data as Hex | null) });
  }
  roles.push({ account, address, root: `0x${root.toString(16)}`, keys: perKey });
}

const out = { name, resolver, block: Number(block), roles, calls };
writeFileSync(new URL("../src/access.recorded.json", import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
console.log(`recorded ${name} at block ${block}: ${roles.length} accounts, ${calls.length} calls`);
