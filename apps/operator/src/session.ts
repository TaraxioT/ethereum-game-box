// Who is signed in: the passkey, its account, whether that account exists yet, and whether it may issue licences.
import type { Address } from "viem";

import { accountOf, isDeployed, isLicensor } from "./account.ts";
import { type Passkey, forgetPasskey, rememberPasskey, storedPasskey } from "./passkey.ts";

export interface Session {
  passkey: Passkey;
  /** Null while `P256AccountFactory` isn't deployed. */
  account: Address | null;
  deployed: boolean;
  licensor: boolean;
}

let session: Session | null = null;
/** `who`: someone signed in or out, so every view changes. `account`: the same account changed (it was deployed). */
type Change = "who" | "account";
const listeners = new Set<(change: Change) => void>();

export function current(): Session | null {
  return session;
}

export function onSession(fn: (change: Change) => void): void {
  listeners.add(fn);
}

function emit(change: Change): void {
  for (const fn of listeners) fn(change);
}

/** Signs in as `passkey`: keeps its public key and id, and reads its account. */
export async function open(passkey: Passkey): Promise<Session> {
  rememberPasskey(passkey);
  const account = await accountOf(passkey);
  const [deployed, licensor] = account ? await Promise.all([isDeployed(account), isLicensor(account)]) : [false, false];
  session = { passkey, account, deployed, licensor };
  emit("who");
  return session;
}

/** Notes that the signed-in account now exists (its first write deployed it). */
export function deployed(): void {
  if (!session || session.deployed) return;
  session.deployed = true;
  emit("account");
}

export function close(): void {
  forgetPasskey();
  session = null;
  emit("who");
}

/** Signs in again as the passkey this browser kept, if any. */
export async function resume(): Promise<void> {
  const passkey = storedPasskey();
  if (passkey) await open(passkey);
}
