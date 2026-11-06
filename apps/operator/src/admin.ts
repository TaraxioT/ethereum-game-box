// The admin's four Box licence actions on `GameBoxNames` (each needs `LICENSOR_ROLE`): register, renew, set the status
// of, and rotate the key of a Box. Each is one `execute` from the admin's account. The forms' rules live here too.
import { type Address, encodeFunctionData, getAddress, isAddress } from "viem";
import { BOX_STATUS, type BoxStatus, type Call, type P256PublicKey, gameBoxNamesAbi, labelProblem } from "@egb/shared/names";

import { parseBoxKey } from "./p256.ts";

export const DAY = 86_400;
export const LICENCE_MAX_DAYS = 3_650;

/** A licence term in whole days, or the reason it isn't one. */
export function checkDays(text: string): { days: number } | { problem: string } {
  const value = text.trim();
  if (!/^\d+$/.test(value)) return { problem: "a whole number of days" };
  const days = Number(value);
  if (days < 1 || days > LICENCE_MAX_DAYS) return { problem: `between 1 and ${LICENCE_MAX_DAYS} days` };
  return { days };
}

export interface LicenceForm {
  label: string;
  operator: string;
  boxKey: string;
  days: string;
}

export interface Licence {
  label: string;
  operator: Address;
  key: P256PublicKey;
  /** Unix seconds. */
  expiry: bigint;
}

/** Checks the register form. `now` is unix seconds. */
export function checkLicence(form: LicenceForm, now: number): { licence: Licence | null; problems: Partial<Record<keyof LicenceForm, string>> } {
  const problems: Partial<Record<keyof LicenceForm, string>> = {};
  const label = form.label.trim();
  const labelIssue = labelProblem(label);
  if (labelIssue) problems.label = labelIssue;
  else if (label.startsWith("popup-")) problems.label = "popup- names are for pop-up Boxes";
  const operator = form.operator.trim();
  if (!isAddress(operator, { strict: false })) problems.operator = "an address (0x and 40 hex digits)";
  const key = parseBoxKey(form.boxKey);
  if (!key) problems.boxKey = "a P-256 public key: 0x04 + x + y (65 bytes of hex)";
  const days = checkDays(form.days);
  if ("problem" in days) problems.days = days.problem;
  const ok = Object.keys(problems).length === 0 && key && "days" in days;
  return {
    licence: ok ? { label, operator: getAddress(operator), key, expiry: BigInt(now + days.days * DAY) } : null,
    problems,
  };
}

/** A renewal's new expiry: `days` past the later of now and the current expiry (`renew` never shortens one). */
export function renewedExpiry(current: number, now: number, days: number): bigint {
  return BigInt(Math.max(current, now) + days * DAY);
}

/** `GameBoxNames.BoxStatus` of a status word. */
export function statusIndex(status: BoxStatus): number {
  return BOX_STATUS.indexOf(status) + 1;
}

const call = (names: Address, data: `0x${string}`): Call => ({ target: names, value: 0n, data });

export function registerCall(names: Address, licence: Licence, account: Address): Call {
  const { label, operator, key, expiry } = licence;
  return call(
    names,
    encodeFunctionData({ abi: gameBoxNamesAbi, functionName: "registerBox", args: [label, operator, account, key.qx, key.qy, expiry] }),
  );
}

export function renewCall(names: Address, label: string, expiry: bigint): Call {
  return call(names, encodeFunctionData({ abi: gameBoxNamesAbi, functionName: "renewBox", args: [label, expiry] }));
}

export function statusCall(names: Address, label: string, status: BoxStatus): Call {
  return call(names, encodeFunctionData({ abi: gameBoxNamesAbi, functionName: "setBoxStatus", args: [label, statusIndex(status)] }));
}

export function rotateCall(names: Address, label: string, key: P256PublicKey, account: Address): Call {
  return call(names, encodeFunctionData({ abi: gameBoxNamesAbi, functionName: "setBoxKey", args: [label, key.qx, key.qy, account] }));
}
