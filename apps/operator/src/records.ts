// The operator's four records on a Box name (`commission`, `location`, `description`, `games`): the form's rules,
// what changed, and the `setText` calls that write it, one per changed key, run as one `executeBatch`.
import { type Address, encodeFunctionData } from "viem";
import { BOX_OPERATOR_KEYS, type Call, labelProblem, permissionedResolverAbi } from "@egb/shared/names";

import { dnsName } from "./boxes.ts";

export type OperatorKey = (typeof BOX_OPERATOR_KEYS)[number];
export type OperatorRecords = Record<OperatorKey, string>;

export const LOCATION_MAX = 80;
export const DESCRIPTION_MAX = 280;
/** The operator's share of the Box's half, in basis points: between 10% and 90% (`plan/README.md`). */
export const COMMISSION_MIN_BPS = 1_000;
export const COMMISSION_MAX_BPS = 9_000;

export interface Checked {
  /** The values to write, tidied: trimmed, and `games` as `a,b` with no spaces. */
  values: OperatorRecords;
  /** Why each bad field is bad. Empty when the form is good. */
  problems: Partial<Record<OperatorKey, string>>;
}

// Control characters, which a record shouldn't carry.
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Checks the form. `games` must be known game labels when `knownGames` is given (the games on chain). */
export function checkRecords(input: OperatorRecords, knownGames?: readonly string[]): Checked {
  const problems: Checked["problems"] = {};

  const commission = input.commission.trim();
  if (commission !== "") {
    if (!/^\d+$/.test(commission)) problems.commission = "a whole number of basis points";
    else if (Number(commission) < COMMISSION_MIN_BPS || Number(commission) > COMMISSION_MAX_BPS) {
      problems.commission = `between ${COMMISSION_MIN_BPS} and ${COMMISSION_MAX_BPS} bps (10% to 90%)`;
    }
  }

  const location = input.location.trim();
  if (location.length > LOCATION_MAX) problems.location = `at most ${LOCATION_MAX} characters`;
  else if (CONTROL.test(location)) problems.location = "no line breaks or control characters";

  const description = input.description.trim();
  if (description.length > DESCRIPTION_MAX) problems.description = `at most ${DESCRIPTION_MAX} characters`;
  else if (CONTROL.test(description)) problems.description = "no line breaks or control characters";

  const games = input.games
    .split(",")
    .map((game) => game.trim())
    .filter((game) => game !== "");
  for (const game of games) {
    const problem = labelProblem(game);
    if (problem) {
      problems.games = `"${game}": ${problem}`;
      break;
    }
    if (knownGames && !knownGames.includes(game)) {
      problems.games = `"${game}" isn't a Game Box game (${knownGames.join(", ")})`;
      break;
    }
  }
  if (!problems.games && new Set(games).size !== games.length) problems.games = "each game once";

  return {
    values: { commission: commission === "" ? "" : String(Number(commission)), location, description, games: games.join(",") },
    problems,
  };
}

/** The keys whose value differs from what the chain holds. */
export function changedKeys(values: OperatorRecords, current: OperatorRecords): OperatorKey[] {
  return BOX_OPERATOR_KEYS.filter((key) => values[key] !== current[key]);
}

/** One `setText` per changed key on the Box's resolver. */
export function recordCalls(resolver: Address, label: string, values: OperatorRecords, keys: readonly OperatorKey[]): Call[] {
  return keys.map((key) => ({
    target: resolver,
    value: 0n,
    data: encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setText", args: [dnsName(label), key, values[key]] }),
  }));
}
