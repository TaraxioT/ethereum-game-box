// A passkey's `P256Account`: its address (`accountOf`, known before it exists), whether it exists, what it may do on
// `GameBoxNames`, and the write path. A write is signed first (one passkey prompt, while the click still counts as a
// user gesture), then the account is deployed through `/account/deploy` if it isn't yet, then the signed call goes to
// `/account/execute`.
import type { Address, Hex } from "viem";
import {
  type Call,
  type ExecuteRequest,
  GAME_BOX_ROLES,
  type P256PublicKey,
  executeBatchDigest,
  executeDigest,
  gameBoxNamesAbi,
  p256AccountFactoryAbi,
} from "@egb/shared/names";
import type { TxView } from "@egb/shared/names";

import { client, factory, gameBoxNames } from "./chain.ts";
import { DEADLINE_SECONDS } from "./config.ts";
import { type Passkey, signDigest } from "./passkey.ts";
import { relayer } from "./relayer.ts";
import { relayed } from "./txs.ts";

/** The account of a P-256 key, or null while `P256AccountFactory` isn't in `deployments/sepolia.json`. */
export async function accountOf(key: P256PublicKey): Promise<Address | null> {
  const address = factory();
  if (!address) return null;
  return client.readContract({ address, abi: p256AccountFactoryAbi, functionName: "accountOf", args: [key.qx, key.qy] });
}

export async function isDeployed(account: Address): Promise<boolean> {
  const code = await client.getCode({ address: account, blockTag: "latest" });
  return code !== undefined && code !== "0x";
}

/** Whether the account may issue Box licences: the admin view shows only then. */
export async function isLicensor(account: Address): Promise<boolean> {
  const names = gameBoxNames();
  if (!names) return false;
  return client.readContract({
    address: names.address,
    abi: gameBoxNamesAbi,
    functionName: "hasRole",
    args: [GAME_BOX_ROLES.LICENSOR_ROLE, account],
  });
}

/** One call (`execute`) or several under one signature (`executeBatch`). */
export type Work = { call: Call } | { calls: readonly Call[] };

/** A fresh nonce: `P256Account` takes any unused one once, so a random 64-bit number never collides in practice. */
export function randomNonce(): bigint {
  const [hi, lo] = crypto.getRandomValues(new Uint32Array(2));
  return (BigInt(hi!) << 32n) | BigInt(lo!);
}

/** The digest the key signs for `work`. */
export function workDigest(account: Address, work: Work, nonce: bigint, deadline: bigint): Hex {
  return "call" in work
    ? executeDigest({ ...work.call, nonce, deadline }, account)
    : executeBatchDigest({ calls: work.calls, nonce, deadline }, account);
}

/** The body of `POST /account/execute`. */
export function executeRequest(account: Address, work: Work, nonce: bigint, deadline: bigint, signature: Hex): ExecuteRequest {
  const json = (c: Call) => ({ target: c.target, value: c.value.toString(), data: c.data });
  const base = { account, nonce: nonce.toString(), deadline: deadline.toString(), signature };
  return "call" in work ? { ...base, call: json(work.call) } : { ...base, calls: work.calls.map(json) };
}

/** Deploys the account of `key` through the relayer, unless it exists. Shown on the strip as `kind`. */
export async function ensureDeployed(key: P256PublicKey, account: Address, subject: string): Promise<TxView | null> {
  if (await isDeployed(account)) return null;
  return relayed("DEPLOY", subject, () => relayer.deploy({ qx: key.qx, qy: key.qy }));
}

/** Signs `work` with the passkey and has the relayer run it from the account. Resolves once it is in a block. */
export async function run(passkey: Passkey, account: Address, kind: string, subject: string, work: Work): Promise<TxView> {
  const nonce = randomNonce();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);
  const signature = await signDigest(passkey, workDigest(account, work, nonce, deadline));
  await ensureDeployed(passkey, account, "your account");
  return relayed(kind, subject, () => relayer.execute(executeRequest(account, work, nonce, deadline, signature)));
}
