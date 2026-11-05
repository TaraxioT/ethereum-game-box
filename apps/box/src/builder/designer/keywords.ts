// The keyword reader: typed or spoken words → brief fields, with no model and no network. It answers whenever the
// model is off, slow (past 5 s), wrong or has nothing to add. Template names, the keys' own words, stakes ("5, 10 and
// 25", "ten EGB", "low"), "call it …", and on the confirm step "yes, build it" or "change the title". On an open
// question (mechanic, theme, twist, voice, title) the words themselves are the answer.
import type { DesignerStep } from "../types.ts";
import { MECHANICS, STAKE_SETS, THEMES, TWISTS, VOICES, type Option } from "./options.ts";
import type { ShelfTemplate } from "./shelf.ts";
import { currentStep, titleSuggestions, type BriefPatch, type Draft, type Field } from "./steps.ts";

/** What words ask for. */
export interface ReadAnswer {
  readonly patch: BriefPatch;
  /** "Yes, build it" on the confirm step. */
  readonly build: boolean;
  /** "Change the voice": open that step again. */
  readonly change: Field | null;
  /** Which reader understood it. */
  readonly by: "model" | "keywords";
}

/** Lower case, apostrophes dropped, everything else but letters, digits and $ a space; padded for \b matches. */
export const normal = (s: string): string =>
  ` ${s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9$]+/g, " ")
    .trim()} `;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100,
};

/** Every number in the words, in order: digits, number words, and "twenty five" as 25. */
export function numbersIn(n: string): number[] {
  const out: number[] = [];
  const words = n.trim().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!.replace(/^\$/, "");
    if (/^\d+$/.test(w)) out.push(Number(w));
    else if (w in NUMBER_WORDS) {
      let v = NUMBER_WORDS[w]!;
      const next = words[i + 1];
      if (v >= 20 && v < 100 && next && next in NUMBER_WORDS && NUMBER_WORDS[next]! < 10) {
        v += NUMBER_WORDS[next]!;
        i++;
      } else if (v < 10 && next === "hundred") {
        v *= 100;
        i++;
      }
      out.push(v);
    }
  }
  return out;
}

/** Stakes in the words: a whole set ("low", "high") or the amounts said. Null when none. */
export function stakesIn(n: string): number[] | null {
  if (/\b(low|cheap|small|tiny)\b/.test(n)) return [...STAKE_SETS[0]!];
  if (/\b(high|big|huge|whale)\b/.test(n)) return [...STAKE_SETS[STAKE_SETS.length - 1]!];
  const amounts = [...new Set(numbersIn(n).filter((x) => x > 0))].sort((a, b) => a - b);
  return amounts.length ? amounts.slice(0, 4) : null;
}

/** The template a phrase names by label or id, when exactly one does. */
function templateIn(n: string, shelf: readonly ShelfTemplate[]): string | null {
  const hits = shelf.filter((t) => n.includes(normal(t.label)) || n.includes(normal(t.id.replace(/-/g, " "))));
  return hits.length === 1 ? hits[0]!.id : null;
}

const optionIn = (options: readonly Option[], n: string): Option | null => {
  const hits = options.filter((o) => o.words.test(n.trim()) || n.includes(normal(o.label)));
  return hits.length === 1 ? hits[0]! : null;
};

/** "for 5 or 10 EGB", "at 25 EGB a seat": the stakes said inside another answer, which the stakes field takes. */
const STAKES_PHRASE = /,?\s*(?:for |at )?\d+(?:\s*(?:,|or|and)\s*\d+)*\s*egb\b(?: a seat| each)?/gi;

/** The words of an open answer, without the fillers people say first ("um, I think it's …"). */
export function openAnswer(text: string): string {
  return text
    .replace(STAKES_PHRASE, "")
    .replace(/^\s*(?:(?:um+|uh+|er+|so|well|ok(?:ay)?|hmm+)[,.]?\s+)*/i, "")
    .replace(/^(?:i think |i guess |maybe |how about |let['’]?s (?:go with |do |make it |have |set it in )?|it['’]?s |it is |make it |set it in |in |on |call it |name it |the twist is |twist:? )+/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:-]+|[\s,.;:!?-]+$/g, "")
    .trim();
}

const CHANGE: [RegExp, Field][] = [
  [/\b(template|game)\b/, "template"],
  [/\b(mechanic|scoring|score|rules?)\b/, "mechanic"],
  [/\b(theme|setting|world|place)\b/, "theme"],
  [/\b(twist)\b/, "twist"],
  [/\b(stakes?|money|egb|price)\b/, "stakes"],
  [/\b(voice|caller|commentator)\b/, "voice"],
  [/\b(title|name)\b/, "title"],
];

const YES = /^\s*(yes|yeah|yep|yup|sure|ok|okay|go|go for it|do it|build|build it|lets go|lets do it|sounds (good|great)|perfect|ship it|make it|absolutely)\b/;
const KEEP = /^(keep it|keep that|yes|yeah|sure|ok|okay|sounds good|that one|perfect|fine)$/i;

/** Reads words against the step they answer. */
export function keywordAnswer(text: string, draft: Draft, shelf: readonly ShelfTemplate[]): ReadAnswer {
  const step: DesignerStep = currentStep(draft);
  const n = normal(text);
  const patch: { -readonly [K in keyof BriefPatch]: BriefPatch[K] } = {};
  const answer = (o: { build?: boolean; change?: Field | null } = {}): ReadAnswer => ({
    patch,
    build: o.build ?? false,
    change: o.change ?? null,
    by: "keywords",
  });

  if (/\b(change|different|another|switch|swap)\b/.test(n)) {
    const hit = CHANGE.find(([re]) => re.test(n));
    if (hit) return answer({ change: hit[1] });
  }
  if (step === "confirm") return answer({ build: YES.test(n) || /\bbuild it\b/.test(n) });

  const template = templateIn(n, shelf);
  if (template && (step === "template" || /\b(start from|based on|template)\b/.test(n))) patch.template = template;

  const stakes = stakesIn(n);
  if (stakes && (step === "stakes" || /\b(egb|stakes?|a seat|each)\b/.test(n))) patch.stakes = stakes;

  const voice = optionIn(VOICES, n);
  if (voice && /\b(voice|called by|calls it|commentary)\b/.test(n)) patch.voice = voice.value;

  const named = /\b(?:call it|name it|called|title it)\s+["“]?([^"”]+?)["”]?\s*[.!]?\s*$/i.exec(text.trim());
  if (named?.[1]) patch.title = named[1];

  const rest = openAnswer(text);
  if (!rest) return answer();
  switch (step) {
    case "template":
      break;
    case "mechanic":
      patch.mechanic = optionIn(MECHANICS, n)?.value ?? rest;
      break;
    case "theme":
      patch.theme = THEMES.find((o) => n.trim() === normal(o.label).trim())?.value ?? rest;
      break;
    case "twist":
      patch.twist = optionIn(TWISTS, n)?.value ?? rest;
      break;
    case "stakes":
      break;
    case "voice":
      patch.voice ??= optionIn(VOICES, n)?.value ?? rest;
      break;
    case "title":
      patch.title ??= KEEP.test(rest) ? titleSuggestions(draft.brief, shelf)[0] : rest;
      break;
  }
  return answer();
}

