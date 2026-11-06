// game.json: what the Box needs to know about a game before it loads any of its code.

/** What a game's taps ask of the badge: `identify` (who, by UID) or `random` (a verified roll from key 2). */
export type TapNeed = "identify" | "random";

export interface GameManifest {
  /** Lower-case words joined by `-`, at most 40 characters; the folder's name. */
  readonly id: string;
  /** Printed on the cartridge, at most 24 characters. */
  readonly title: string;
  /** One sentence for Home, at most 120 characters. */
  readonly blurb: string;
  readonly players: 2;
  /** A typical match, in minutes. */
  readonly minutes: number;
  /** The stakes the Box offers, in EGB, ascending. */
  readonly stakes: readonly number[];
  /** Every game in this pass is refereed: only the Box saw the taps. */
  readonly tier: "refereed";
  readonly taps: TapNeed;
  /** `team`: shipped with the Box, rules in-process. `built`: made by the game builder, rules in a sandboxed child. */
  readonly kind: "team" | "built";
  /** The longest a rules step may take before the match is void, in ms. */
  readonly budgetMs: number;
  /** Present on games the builder may start from. */
  readonly forge?: { readonly template: true; readonly label: string; readonly default?: true };
}

export const MANIFEST_LIMITS = { id: 40, title: 24, blurb: 120, budgetMs: 200 } as const;

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Problems with a parsed game.json, in plain words; empty when it is good. */
export function manifestProblems(value: unknown): string[] {
  const problems: string[] = [];
  if (typeof value !== "object" || value === null) return ["game.json is not an object"];
  const m = value as Record<string, unknown>;
  const text = (key: string, max: number) => {
    const v = m[key];
    if (typeof v !== "string" || v.trim() === "") problems.push(`${key} must be a non-empty string`);
    else if (v.length > max) problems.push(`${key} is longer than ${max} characters`);
  };
  text("id", MANIFEST_LIMITS.id);
  if (typeof m.id === "string" && !ID.test(m.id)) problems.push("id must be lower-case words joined by -");
  text("title", MANIFEST_LIMITS.title);
  text("blurb", MANIFEST_LIMITS.blurb);
  if (m.players !== 2) problems.push("players must be 2");
  if (typeof m.minutes !== "number" || !(m.minutes > 0 && m.minutes <= 30)) problems.push("minutes must be 1–30");
  const stakes = m.stakes;
  if (!Array.isArray(stakes) || stakes.length === 0 || stakes.length > 4) problems.push("stakes must list 1–4 amounts");
  else if (!stakes.every((s, i) => Number.isInteger(s) && s > 0 && (i === 0 || s > (stakes[i - 1] as number))))
    problems.push("stakes must be whole EGB, ascending");
  if (m.tier !== "refereed") problems.push("tier must be refereed");
  if (m.taps !== "identify" && m.taps !== "random") problems.push("taps must be identify or random");
  if (m.kind !== "team" && m.kind !== "built") problems.push("kind must be team or built");
  if (typeof m.budgetMs !== "number" || !(m.budgetMs > 0 && m.budgetMs <= MANIFEST_LIMITS.budgetMs))
    problems.push(`budgetMs must be 1–${MANIFEST_LIMITS.budgetMs}`);
  return problems;
}
