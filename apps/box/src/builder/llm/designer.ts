// The Designer's one model call: a typed or spoken answer → the brief fields it settles. The model sees the shelf, the
// keys, the brief so far and the question the player answered, and must fill every field of the schema (null when
// the answer didn't say it). Its reply is validated here field by field; anything malformed rejects the whole reply,
// and the Designer's keyword reader answers instead.
import type { DesignerStep, GameBrief } from "../types.ts";
import type { JsonSchema } from "./model.ts";

const CHANGEABLE = ["template", "mechanic", "theme", "twist", "stakes", "voice", "title"] as const;

export interface DesignerModelContext {
  readonly step: DesignerStep;
  readonly question: string;
  readonly brief: GameBrief;
  readonly templates: readonly { readonly id: string; readonly label: string }[];
  /** The keys of the current step, as labels. */
  readonly keys: readonly string[];
}

/** The model's reading. Null: the answer didn't say it. */
export interface DesignerModelAnswer {
  readonly template: string | null;
  readonly mechanic: string | null;
  readonly theme: string | null;
  readonly twist: string | null;
  readonly stakes: readonly number[] | null;
  readonly voice: string | null;
  readonly title: string | null;
  /** The player agreed to build it (confirm step). */
  readonly build: boolean;
  /** The player wants to change this part. */
  readonly change: (typeof CHANGEABLE)[number] | null;
}

const nullable = (schema: Record<string, unknown>, description: string) => ({ anyOf: [schema, { type: "null" }], description });

export function designerSchema(ctx: DesignerModelContext): JsonSchema {
  const ids = ctx.templates.map((t) => t.id);
  return {
    type: "object",
    properties: {
      template: nullable({ type: "string", ...(ids.length ? { enum: ids } : {}) }, "the id of the template game they named"),
      mechanic: nullable({ type: "string" }, "how a tap scores, one sentence"),
      theme: nullable({ type: "string" }, "where it is set, a few words"),
      twist: nullable({ type: "string" }, "what makes it theirs, one short line"),
      stakes: nullable({ type: "array", items: { type: "integer", minimum: 1 }, maxItems: 4 }, "USDC a seat, ascending, 1 to 4 amounts"),
      voice: nullable({ type: "string" }, "who calls the game: a commentator, a robot, a pirate"),
      title: nullable({ type: "string" }, "the game's name, at most 24 characters"),
      build: { type: "boolean", description: "true only when they agree to build the game now" },
      change: nullable({ type: "string", enum: [...CHANGEABLE] }, "the part of the design they want to change"),
    },
    required: ["template", "mechanic", "theme", "twist", "stakes", "voice", "title", "build", "change"],
    additionalProperties: false,
  };
}

export function designerSystem(ctx: DesignerModelContext): string {
  return [
    "You read one answer in a short game-design interview on the Ethereum Game Box, a two-player party console played by tapping NFC badges on two tap stations.",
    "Fill only the fields the answer settles; everything else is null (build: false). Keep the player's words, tidied and short.",
    "An answer may settle more than the question asked (\"pirates, for 5 or 10 USDC\" settles the theme and the stakes).",
    "Templates (id: label):",
    ...ctx.templates.map((t) => `- ${t.id}: ${t.label}`),
  ].join("\n");
}

export function designerPrompt(text: string, ctx: DesignerModelContext): string {
  return [
    `The design so far: ${JSON.stringify(ctx.brief)}`,
    `The question (step "${ctx.step}"): ${ctx.question}`,
    ...(ctx.keys.length ? [`The keys on screen: ${ctx.keys.join(" | ")}`] : []),
    `The player answered: ${text}`,
  ].join("\n");
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string | null => v === null || typeof v === "string";

/** The reply checked: every field present and of its type, ids from the shelf. Null rejects it. */
export function parseDesignerAnswer(v: unknown, ctx: DesignerModelContext): DesignerModelAnswer | null {
  if (!isObject(v)) return null;
  const { template, mechanic, theme, twist, stakes, voice, title, build, change } = v;
  if (![template, mechanic, theme, twist, voice, title].every(str)) return null;
  if (template !== null && !ctx.templates.some((t) => t.id === template)) return null;
  if (stakes !== null && !(Array.isArray(stakes) && stakes.every((n) => Number.isInteger(n) && n > 0))) return null;
  if (typeof build !== "boolean") return null;
  if (change !== null && !CHANGEABLE.includes(change as (typeof CHANGEABLE)[number])) return null;
  return {
    template: template as string | null,
    mechanic: mechanic as string | null,
    theme: theme as string | null,
    twist: twist as string | null,
    stakes: stakes as number[] | null,
    voice: voice as string | null,
    title: title as string | null,
    build,
    change: change as DesignerModelAnswer["change"],
  };
}
