// The mock voice's script: from where a session stands, the Designer's line for each open step and what a player
// plausibly says back, generated from the step graph and checked against the keyword reader as it goes (each answer
// is read the way a real one would be, so the script can't drift from what the Designer understands). It drives a
// whole session offline: the mock voice, demos, tests.
import { keywordAnswer } from "./keywords.ts";
import { ordered, type ShelfTemplate } from "./shelf.ts";
import { applyPatch, currentStep, FIELDS, question, type Draft, type Field } from "./steps.ts";

export interface MockTurn {
  /** What the Designer says (the step's question). */
  readonly say: string;
  /** What the player answers. */
  readonly hear: string;
}

/** What a player says on a step. */
function spoken(step: Field, shelf: readonly ShelfTemplate[]): string {
  switch (step) {
    case "template":
      return `${ordered(shelf)[0]?.label ?? "Quick Draw"}, please.`;
    case "mechanic":
      return "First tap wins.";
    case "theme":
      return "A Wild West showdown!";
    case "twist":
      return "Make it faster every round.";
    case "stakes":
      return "Five, ten or twenty-five.";
    case "voice":
      return "A pirate, arr!";
    case "title":
      return "Keep it.";
  }
}

export const BUILD_LINE = "Yes, build it!";

/** The turns from `start` to the end: one per open step, then the read-back answered with a yes. */
export function mockTurns(start: Draft, shelf: readonly ShelfTemplate[]): MockTurn[] {
  const turns: MockTurn[] = [];
  let draft = start;
  for (let i = 0; i < FIELDS.length; i++) {
    const step = currentStep(draft);
    if (step === "confirm") break;
    const hear = spoken(step, shelf);
    turns.push({ say: question(step, draft, shelf), hear });
    const next = applyPatch(draft, keywordAnswer(hear, draft, shelf).patch, shelf);
    if (!next.changed.length) return turns; // the reader didn't take it: stop rather than loop
    draft = next.draft;
  }
  if (currentStep(draft) === "confirm") turns.push({ say: question("confirm", draft, shelf), hear: BUILD_LINE });
  return turns;
}
