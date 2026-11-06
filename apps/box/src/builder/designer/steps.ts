// The Designer's step graph, pure: which question comes next, how it is asked, the keys that answer it, and how an
// answer changes the brief. The service (service.ts) owns the session, the lock and the I/O.
//
//   template → mechanic → theme → twist → stakes → voice → title → confirm
//
// A step is skipped once it is settled, however that happened: a template that fixes the mechanic settles it, a
// shelf of one template settles the template, and one free answer may settle several steps at once.
import { MANIFEST_LIMITS } from "@egb/sdk";
import type { DesignerChoice, DesignerStep, GameBrief } from "../types.ts";
import { MECHANICS, NO_TWIST, STAKE_SETS, stakeId, stakeLabel, THEMES, TWISTS, VOICES, type Option } from "./options.ts";
import { defaultTemplate, ordered, type ShelfTemplate } from "./shelf.ts";

/** The steps that settle a field of the brief (all but confirm); each is named after its field. */
export type Field = Exclude<DesignerStep, "confirm">;
export const FIELDS: readonly Field[] = ["template", "mechanic", "theme", "twist", "stakes", "voice", "title"];

/** Who settled a step: the player (back() may reopen it), or the shelf (a fixed mechanic, the only template). */
export type Settler = "player" | "shelf";

export interface Draft {
  readonly brief: GameBrief;
  readonly settled: Readonly<Partial<Record<Field, Settler>>>;
}

/** Fields an answer sets. Strings are checked and tidied; stakes are USDC a seat. */
export interface BriefPatch {
  readonly template?: string;
  readonly mechanic?: string;
  readonly theme?: string;
  readonly twist?: string;
  readonly stakes?: readonly number[];
  readonly voice?: string;
  readonly title?: string;
}

export const MAX_LINE = 160;
export const MAX_TITLE = MANIFEST_LIMITS.title;
/** game.json allows 1 to 4 stake amounts. */
export const MAX_STAKES = 4;
/** No single stake above this many USDC. */
export const MAX_STAKE = 1000;

export function emptyDraft(shelf: readonly ShelfTemplate[]): Draft {
  const brief: GameBrief = {
    template: defaultTemplate(shelf),
    mechanic: null,
    theme: null,
    twist: null,
    stakes: null,
    voice: null,
    title: null,
  };
  const draft: Draft = { brief, settled: shelf.length === 1 ? { template: "shelf" } : {} };
  return withTemplateMechanic(draft, shelf);
}

export const templateOf = (brief: GameBrief, shelf: readonly ShelfTemplate[]): ShelfTemplate | null =>
  shelf.find((t) => t.id === brief.template) ?? null;

export const isSettled = (field: Field, draft: Draft): boolean => draft.settled[field] !== undefined;

/** The step the next answer goes to: the first one not settled, or confirm. */
export function currentStep(draft: Draft): DesignerStep {
  return FIELDS.find((f) => !isSettled(f, draft)) ?? "confirm";
}

// ---- words ----------------------------------------------------------------------------------------------------------

const strip = (s: string) => s.trim().replace(/[.!?]+$/, "");
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const titleCase = (s: string) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase());
const list = (items: readonly string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;

const TITLE_STOP = new Set(["a", "an", "the", "of", "at", "on", "in", "to", "with", "and", "ship", "deep"]);

/** Up to three names from the theme and the template: "West Draw", "Quick Draw: Wild West". */
export function titleSuggestions(brief: GameBrief, shelf: readonly ShelfTemplate[]): string[] {
  const label = templateOf(brief, shelf)?.label ?? "Quick Draw";
  const last = label.split(/\s+/).at(-1) ?? label;
  const words = (brief.theme ?? "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2 && !TITLE_STOP.has(w));
  const out: string[] = [];
  const add = (s: string) => {
    const v = titleCase(s.trim());
    if (v && v.length <= MAX_TITLE && !out.includes(v)) out.push(v);
  };
  if (words[0]) add(`${words[0]} ${last}`);
  if (words.length > 1) add(`${words[words.length - 1]} ${last}`);
  if (words.length) add(`${label}: ${words.join(" ")}`);
  if (words[0]) add(`${words[0]} ${label}`);
  add(`New ${label}`);
  return out.slice(0, 3);
}

const optionLabel = (options: readonly Option[], value: string | null) => options.find((o) => o.value === value)?.label ?? null;

/** The brief read back: the confirm step's question. */
export function readBack(draft: Draft, shelf: readonly ShelfTemplate[]): string {
  const b = draft.brief;
  const tpl = templateOf(b, shelf)?.label ?? b.template;
  const where = b.theme ? ` set in ${lower(strip(b.theme))}` : "";
  const twist = b.twist && b.twist !== NO_TWIST ? `, and ${lower(strip(b.twist))}` : "";
  const how = b.mechanic ? ` ${optionLabel(MECHANICS, b.mechanic) ?? strip(b.mechanic)}.` : "";
  const stakes = b.stakes ? `${list(b.stakes.map(String))} USDC a seat` : "No stakes yet";
  const voice = b.voice ? `, called by ${lower(strip(b.voice))}` : "";
  return `“${b.title ?? tpl}”: ${tpl}${where}${twist}.${how} ${stakes}${voice}. Shall I build it?`;
}

/** The question for a step: one short line the screen shows and the voice reads out. */
export function question(step: DesignerStep, draft: Draft, shelf: readonly ShelfTemplate[]): string {
  switch (step) {
    case "template":
      return "Which game should we start from?";
    case "mechanic":
      return "How does a tap score?";
    case "theme":
      return "Where is it set? Pick one, or say anywhere you like.";
    case "twist":
      return "What's the twist?";
    case "stakes":
      return "What can players stake, in USDC a seat?";
    case "voice":
      return "Who calls the game?";
    case "title":
      return `How about “${titleSuggestions(draft.brief, shelf)[0]}”? Keep it, or say another name.`;
    case "confirm":
      return readBack(draft, shelf);
  }
}

const keys = (options: readonly Option[]): DesignerChoice[] => options.map(({ id, label }) => ({ id, label }));

/** The brass keys for a step. */
export function choices(step: DesignerStep, draft: Draft, shelf: readonly ShelfTemplate[]): DesignerChoice[] {
  switch (step) {
    case "template":
      return ordered(shelf).map(({ id, label }) => ({ id, label }));
    case "mechanic":
      return keys(MECHANICS);
    case "theme":
      return keys(THEMES);
    case "twist":
      return keys(TWISTS);
    case "stakes":
      return STAKE_SETS.map((set) => ({ id: stakeId(set), label: stakeLabel(set) }));
    case "voice":
      return keys(VOICES);
    case "title":
      return titleSuggestions(draft.brief, shelf).map((label, i) => ({ id: `title-${i}`, label }));
    case "confirm":
      return [{ id: BUILD, label: "Build it" }];
  }
}

/** The confirm step's key: answered by confirm(). */
export const BUILD = "build";

/** What a key on a step writes into the brief; null when it isn't one of that step's keys. */
export function choicePatch(step: Field, id: string, draft: Draft, shelf: readonly ShelfTemplate[]): BriefPatch | null {
  const key = choices(step, draft, shelf).find((c) => c.id === id);
  if (!key) return null;
  const value = (options: readonly Option[]) => options.find((o) => o.id === id)?.value ?? null;
  switch (step) {
    case "template":
      return { template: id };
    case "mechanic":
      return { mechanic: value(MECHANICS) ?? key.label };
    case "theme":
      return { theme: value(THEMES) ?? key.label };
    case "twist":
      return { twist: value(TWISTS) ?? key.label };
    case "stakes":
      return { stakes: id.split("-").map(Number) };
    case "voice":
      return { voice: value(VOICES) ?? key.label };
    case "title":
      return { title: key.label };
  }
}

// ---- answers --------------------------------------------------------------------------------------------------------

export interface PatchResult {
  readonly draft: Draft;
  /** Fields whose value or settledness changed. */
  readonly changed: readonly Field[];
  /** Parts of the patch that couldn't be used, in plain words. */
  readonly errors: readonly string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A line tidied: one line, no wrapping quotes, at most `max` characters; null when nothing is left. */
export function cleanLine(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim().replace(/^["“'‘]+|["”'’]+$/g, "").trim();
  return s ? s.slice(0, max).trim() : null;
}

/** Whole USDC, ascending, no repeats, 1 to 4 of them; null when that can't be made of it. */
export function cleanStakes(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const set = [...new Set(v)].filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0 && n <= MAX_STAKE);
  if (!set.length || set.length !== v.length || set.length > MAX_STAKES) return null;
  return set.sort((a, b) => a - b);
}

export function findTemplate(v: string, shelf: readonly ShelfTemplate[]): ShelfTemplate | null {
  const n = norm(v);
  return shelf.find((t) => t.id === v || norm(t.id) === n || norm(t.label) === n) ?? null;
}

/** A key named by its id or label stands for its value; anything else is the player's own line. */
function keyed(options: readonly Option[], v: string): string | null {
  const n = norm(v);
  return options.find((o) => o.id === v || norm(o.label) === n)?.value ?? cleanLine(v, MAX_LINE);
}

const NONE = TWISTS.find((o) => o.id === "none")!.words;

/** The mechanic follows the template: a template that fixes it settles it, and leaving one unsettles it again. */
function withTemplateMechanic(draft: Draft, shelf: readonly ShelfTemplate[]): Draft {
  const fixed = templateOf(draft.brief, shelf)?.mechanic;
  if (fixed) return { brief: { ...draft.brief, mechanic: fixed }, settled: { ...draft.settled, mechanic: "shelf" } };
  if (draft.settled.mechanic !== "shelf") return draft;
  const { mechanic: _, ...settled } = draft.settled;
  return { brief: { ...draft.brief, mechanic: null }, settled };
}

/** Applies a patch: each usable field is set and settled by the player; the rest come back as errors. */
export function applyPatch(draft: Draft, patch: BriefPatch, shelf: readonly ShelfTemplate[]): PatchResult {
  let next: Draft = draft;
  const errors: string[] = [];
  const set = (field: Field, value: GameBrief[Field]) => {
    next = { brief: { ...next.brief, [field]: value }, settled: { ...next.settled, [field]: "player" } };
  };

  if (patch.template !== undefined) {
    const t = findTemplate(patch.template, shelf);
    if (!t) errors.push(`there's no template “${patch.template}” on the shelf`);
    else {
      set("template", t.id);
      next = withTemplateMechanic(next, shelf);
    }
  }
  if (patch.mechanic !== undefined) {
    const line = keyed(MECHANICS, patch.mechanic);
    if (next.settled.mechanic === "shelf") errors.push("this template fixes how a tap scores");
    else if (line) set("mechanic", line);
  }
  if (patch.theme !== undefined) {
    const line = keyed(THEMES, patch.theme);
    if (line) set("theme", line);
  }
  if (patch.twist !== undefined) {
    const line = keyed(TWISTS, patch.twist);
    if (line) set("twist", NONE.test(norm(line)) ? NO_TWIST : line);
  }
  if (patch.stakes !== undefined) {
    const stakes = cleanStakes(patch.stakes);
    if (stakes) set("stakes", stakes);
    else errors.push(`stakes are 1 to ${MAX_STAKES} whole amounts of USDC`);
  }
  if (patch.voice !== undefined) {
    const line = keyed(VOICES, patch.voice);
    if (line) set("voice", line);
  }
  if (patch.title !== undefined) {
    const line = cleanLine(patch.title, MAX_TITLE);
    if (line) set("title", line);
  }

  const changed = FIELDS.filter(
    (f) => JSON.stringify(next.brief[f]) !== JSON.stringify(draft.brief[f]) || next.settled[f] !== draft.settled[f],
  );
  return { draft: next, changed, errors };
}

/** Opens a step again: its value stays (a hint), and it is asked next. Shelf-settled steps can't be opened. */
export function reopen(draft: Draft, field: Field): Draft {
  if (draft.settled[field] !== "player") return draft;
  const { [field]: _, ...settled } = draft.settled;
  return { brief: draft.brief, settled };
}

/** The step back(): the last one the player settled before the current step, or null at the first question. */
export function previousStep(draft: Draft): Field | null {
  const step = currentStep(draft);
  const upto = step === "confirm" ? FIELDS.length : FIELDS.indexOf(step);
  for (let i = upto - 1; i >= 0; i--) {
    const f = FIELDS[i]!;
    if (draft.settled[f] === "player") return f;
  }
  return null;
}
