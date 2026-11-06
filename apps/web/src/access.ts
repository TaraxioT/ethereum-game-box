// Enhanced Access Control, read live: the role table (which keys each account may write on a resolver, read with
// `roles` and `hasRoles` and decoded with ENSv2's role names) and the Try grid (each account tries each key with an
// `eth_call` from that account, so the chain itself answers allowed or the revert, at no gas).
import { type Address, type Hex, type PublicClient, encodeFunctionData, toBytes, toHex } from "viem";
import {
  COIN_TYPE_ETH,
  RESOLVER_ROLES,
  ROOT_RESOURCE,
  addressResource,
  permissionedResolverAbi,
  roleNames,
  textResource,
} from "@egb/shared/names";

import { decodeRevert, revertData } from "./errors.ts";
import type { AccountKind } from "./kinds.ts";

/** An account the site knows, as a row of the table. */
export interface Account {
  /** What a person calls it: `nova`, `PlayerStats`, `relayer`. */
  label: string;
  /** What it is to this name: `badge`, `registrar`, `Box`. */
  role: string;
  address: Address;
  /** `P256Account`, `EOA` or `contract`, once read (`kinds.ts`). */
  kind?: AccountKind;
}

/** The `addr` column: the ETH address record. Every other column is a text key. */
export const ADDR = "addr";

/** The resolver resource holding a key's roles, and the role that writes it. */
export function keyResource(key: string): { resource: bigint; role: bigint } {
  return key === ADDR
    ? { resource: addressResource(COIN_TYPE_ETH), role: RESOLVER_ROLES.SET_ADDRESS }
    : { resource: textResource(key), role: RESOLVER_ROLES.SET_TEXT };
}

/** A name in DNS wire format, as `PermissionedResolver`'s setters take it. */
export function dnsEncode(name: string): Hex {
  const parts = name.split(".").flatMap((label) => {
    const bytes = toBytes(label);
    return [bytes.length, ...bytes];
  });
  return toHex(new Uint8Array([...parts, 0]));
}

// ---------------------------------------------------------------------------------------------------------------------
// The role table

/** One account's roles on a resolver: at the root, and on each key's own resource. */
export interface RoleRow {
  account: Account;
  /** Role names held on the root resource (they apply to every key). */
  root: string[];
  /** Per key: role names held on that key's own resource, and whether the account may write it at all. */
  keys: Record<string, { roles: string[]; mayWrite: boolean }>;
}

/** The raw reads a row decodes from. */
export interface RoleReads {
  root: bigint;
  /** Per key: `roles(resource, account)` and `hasRoles(resource, role, account)`. */
  keys: Record<string, { bitmap: bigint; has: boolean }>;
}

const names = (bitmap: bigint): string[] => roleNames(bitmap, RESOLVER_ROLES).map(String);

/** Decodes one account's bitmaps with the role names from the source. */
export function decodeRoleRow(account: Account, reads: RoleReads): RoleRow {
  const keys: RoleRow["keys"] = {};
  for (const [key, read] of Object.entries(reads.keys)) keys[key] = { roles: names(read.bitmap), mayWrite: read.has };
  return { account, root: names(reads.root), keys };
}

/** Reads the role table of `resolver` for `accounts` and `keys`. */
export async function readRoleTable(
  client: PublicClient,
  resolver: Address,
  accounts: readonly Account[],
  keys: readonly string[],
): Promise<RoleRow[]> {
  const at = { address: resolver, abi: permissionedResolverAbi } as const;
  return Promise.all(
    accounts.map(async (account) => {
      const root = client.readContract({ ...at, functionName: "roles", args: [ROOT_RESOURCE, account.address] });
      const perKey = keys.map(async (key) => {
        const { resource, role } = keyResource(key);
        const [bitmap, has] = await Promise.all([
          client.readContract({ ...at, functionName: "roles", args: [resource, account.address] }),
          client.readContract({ ...at, functionName: "hasRoles", args: [resource, role, account.address] }),
        ]);
        return [key, { bitmap, has }] as const;
      });
      const reads: RoleReads = { root: await root, keys: Object.fromEntries(await Promise.all(perKey)) };
      return decodeRoleRow(account, reads);
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// The Try grid

/** A Try cell: the chain's answer to one account writing one key. */
export type TryCell = { allowed: true } | { allowed: false; error: string; args: readonly unknown[] };

/** What an `eth_call` came back with: success, or the revert data (or no data at all). */
export type CallOutcome = { ok: true } | { ok: false; data: Hex | null; message: string };

/** Decodes an `eth_call` outcome into a cell. */
export function tryCell(outcome: CallOutcome): TryCell {
  if (outcome.ok) return { allowed: true };
  const revert = outcome.data ? decodeRevert(outcome.data) : null;
  return revert
    ? { allowed: false, error: revert.name, args: revert.args }
    : { allowed: false, error: outcome.message, args: [] };
}

/** The call that writes `key` on `name`: `setText`, or `setAddress` for `addr`. The value is what the account
 * would write; the call is only ever simulated. */
export function writeCall(name: string, key: string, from: Address): Hex {
  const dns = dnsEncode(name);
  return key === ADDR
    ? encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setAddress", args: [dns, COIN_TYPE_ETH, from] })
    : encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setText", args: [dns, key, "try"] });
}

/** Runs any `eth_call` and returns its outcome, never throwing. */
export async function callOutcome(client: PublicClient, from: Address, to: Address, data: Hex): Promise<CallOutcome> {
  try {
    await client.call({ account: from, to, data });
    return { ok: true };
  } catch (err) {
    return { ok: false, data: revertData(err), message: err instanceof Error ? err.message.split("\n")[0] ?? "" : String(err) };
  }
}

/** Every account tries every key on `name`'s resolver. Rows follow `accounts`, columns follow `keys`. */
export async function tryAll(
  client: PublicClient,
  name: string,
  resolver: Address,
  accounts: readonly Account[],
  keys: readonly string[],
): Promise<TryCell[][]> {
  return Promise.all(
    accounts.map((account) =>
      Promise.all(
        keys.map(async (key) => tryCell(await callOutcome(client, account.address, resolver, writeCall(name, key, account.address)))),
      ),
    ),
  );
}
