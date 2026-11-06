// The calls only `gamebox.eth`'s admin may make, built and checked before anything is sent: add a game (its name and its
// champion title), open a championship (with its prize in test USDC: minted to the admin and approved first when it
// is short) and close one. The Box's admin panel and any site holding the admin key build their calls here.

import { type Address, type Hex, encodeFunctionData } from 'viem';

import { championshipsAbi, fakeUsdcAbi, gameBoxNamesAbi } from '../names/abis.ts';
import { contractAddress } from '../names/deployments.ts';
import { CREATES_STORAGE_GAS } from '../names/gas.ts';
import { championshipLabelProblem, championshipName, fullName, labelProblem } from '../names/labels.ts';
import { formatUsdc } from '../names/usdc.ts';

/** One transaction the admin sends. `gas` is fixed for a call that creates storage; otherwise it is estimated. */
export interface AdminCall {
  to: Address;
  data: Hex;
  gas?: bigint;
  /** What it does, for people: `add game stockduel (title term 7d)`. */
  what: string;
}

/** A request the admin's calls refuse before anything is sent (a bad label, a term out of range). */
export class AdminInputError extends Error {
  override name = 'AdminInputError';
}

/** A title lasts from a minute (a quick demo) to a year after the holder's last win. */
export const TITLE_TERM_MIN = 60;
export const TITLE_TERM_MAX = 365 * 24 * 60 * 60;
/** A championship runs from a minute to 90 days. */
export const CUP_RUN_MIN = 60;
export const CUP_RUN_MAX = 90 * 24 * 60 * 60;

/** `90s`, `15m`, `7d`, `1d 2h`. */
export function formatSeconds(seconds: number): string {
  const parts: string[] = [];
  let left = Math.round(seconds);
  for (const [unit, size] of [['d', 86_400], ['h', 3_600], ['m', 60]] as const) {
    if (left >= size) {
      parts.push(`${Math.floor(left / size)}${unit}`);
      left %= size;
    }
  }
  if (left > 0 || parts.length === 0) parts.push(`${left}s`);
  return parts.join(' ');
}

function refuseIf(problem: string | null, what: string): void {
  if (problem) throw new AdminInputError(`${what}: ${problem}`);
}

function wholeSeconds(seconds: number, min: number, max: number, what: string): void {
  if (!Number.isInteger(seconds) || seconds < min || seconds > max) {
    throw new AdminInputError(`${what} must be ${formatSeconds(min)} to ${formatSeconds(max)} in whole seconds`);
  }
}

/** `GameBoxNames.addGame`: `<label>.gamebox.eth` and its title `champion.<label>.gamebox.eth`, which lasts
 *  `titleTerm` seconds after the holder's last win. A game can't be removed once added. */
export function addGameCall(label: string, titleTerm: number): AdminCall {
  refuseIf(labelProblem(label), `game "${label}"`);
  wholeSeconds(titleTerm, TITLE_TERM_MIN, TITLE_TERM_MAX, 'the title term');
  return {
    to: contractAddress('GameBoxNames'),
    data: encodeFunctionData({ abi: gameBoxNamesAbi, functionName: 'addGame', args: [label, BigInt(titleTerm)] }),
    gas: CREATES_STORAGE_GAS,
    what: `add game ${fullName(label)} (title term ${formatSeconds(titleTerm)})`,
  };
}

export interface OpenCup {
  game: string;
  label: string;
  /** When scoring stops (unix seconds). */
  ends: number;
  /** USDC base units; zero for none. */
  prize: bigint;
}

/** `Championships.open`: one open championship per game, scored by every result until `ends`. It can't be cancelled:
 *  run it short and close it. */
export function openCupCall(cup: OpenCup, now: number): AdminCall {
  refuseIf(labelProblem(cup.game), `game "${cup.game}"`);
  refuseIf(championshipLabelProblem(cup.label), `cup "${cup.label}"`);
  wholeSeconds(cup.ends - now, CUP_RUN_MIN, CUP_RUN_MAX, 'a cup');
  if (cup.prize < 0n) throw new AdminInputError('the prize must not be negative');
  return {
    to: contractAddress('Championships'),
    data: encodeFunctionData({
      abi: championshipsAbi,
      functionName: 'open',
      args: [cup.game, cup.label, BigInt(cup.ends), cup.prize],
    }),
    gas: CREATES_STORAGE_GAS,
    what: `open ${championshipName(cup.label, cup.game)} for ${formatSeconds(cup.ends - now)}, prize ${formatUsdc(cup.prize)} USDC`,
  };
}

/** `Championships.close`, once its `ends` has passed: the prize and the name to the winner, the records frozen. */
export function closeCupCall(game: string): AdminCall {
  refuseIf(labelProblem(game), `game "${game}"`);
  return {
    to: contractAddress('Championships'),
    data: encodeFunctionData({ abi: championshipsAbi, functionName: 'close', args: [game] }),
    gas: CREATES_STORAGE_GAS,
    what: `close ${game}'s cup`,
  };
}

/** `FakeUSDC.mint` (the admin is its minter). */
export function mintUsdcCall(to: Address, amount: bigint): AdminCall {
  return {
    to: contractAddress('FakeUSDC'),
    data: encodeFunctionData({ abi: fakeUsdcAbi, functionName: 'mint', args: [to, amount] }),
    what: `mint ${formatUsdc(amount)} USDC to the admin`,
  };
}

/** `FakeUSDC.approve` of `Championships` for the prize. */
export function approveCupsCall(amount: bigint): AdminCall {
  return {
    to: contractAddress('FakeUSDC'),
    data: encodeFunctionData({ abi: fakeUsdcAbi, functionName: 'approve', args: [contractAddress('Championships'), amount] }),
    what: `approve ${formatUsdc(amount)} USDC for the prize`,
  };
}

/** The admin's USDC, read just before a championship opens. */
export interface AdminFunds {
  balance: bigint;
  /** What `Championships` may already take. */
  allowance: bigint;
}

/** Every call that opens `cup`, in order: the prize's shortfall minted, `Championships` approved for it, the open. */
export function openCupCalls(cup: OpenCup, now: number, admin: Address, funds: AdminFunds): AdminCall[] {
  const open = openCupCall(cup, now);
  const calls: AdminCall[] = [];
  if (funds.balance < cup.prize) calls.push(mintUsdcCall(admin, cup.prize - funds.balance));
  if (funds.allowance < cup.prize) calls.push(approveCupsCall(cup.prize));
  calls.push(open);
  return calls;
}
