import { describe, expect, it } from "vitest";
import { keywordAnswer, numbersIn, stakesIn, normal } from "./keywords.ts";
import { NO_TWIST } from "./options.ts";
import {
  applyPatch,
  choicePatch,
  choices,
  currentStep,
  emptyDraft,
  previousStep,
  question,
  readBack,
  reopen,
  titleSuggestions,
  type Draft,
  type Field,
} from "./steps.ts";
import { QUICK_DRAW, SHELF, STOCK_DUEL } from "./test-helpers.ts";

/** Answers the current step with a key (the first unless named). */
function pick(draft: Draft, id?: string): Draft {
  const step = currentStep(draft);
  if (step === "confirm") throw new Error("at confirm");
  const key = id ?? choices(step, draft, SHELF)[0]!.id;
  const patch = choicePatch(step, key, draft, SHELF);
  if (!patch) throw new Error(`${key} isn't a key for ${step}`);
  return applyPatch(draft, patch, SHELF).draft;
}

describe("the steps", () => {
  it("asks template, mechanic, theme, twist, stakes, voice, title, then confirm, one at a time", () => {
    let d = emptyDraft(SHELF);
    expect(d.brief.template).toBe("quick-draw");
    const seen: string[] = [];
    for (const key of ["quick-draw", "closest", "deep-space", "decoys", "5-10-25", "robot", undefined]) {
      seen.push(currentStep(d));
      d = pick(d, key);
    }
    expect(seen).toEqual(["template", "mechanic", "theme", "twist", "stakes", "voice", "title"]);
    expect(currentStep(d)).toBe("confirm");
    expect(d.brief).toEqual({
      template: "quick-draw",
      mechanic: "A hidden timer counts down; the tap closest to zero wins the round.",
      theme: "Deep space",
      twist: "Decoy signals flash before the real one.",
      stakes: [5, 10, 25],
      voice: "A robot",
      title: "Space Draw",
    });
    expect(readBack(d, SHELF)).toBe(
      "“Space Draw”: Quick Draw set in deep space, and decoy signals flash before the real one. Closest to zero. 5, 10 or 25 USDC a seat, called by a robot. Shall I build it?",
    );
  });

  it("skips the mechanic when the template fixes it, and asks it again when a template that doesn't is picked", () => {
    let d = pick(emptyDraft(SHELF), "stock-duel");
    expect(d.brief.mechanic).toBe(STOCK_DUEL.mechanic);
    expect(d.settled.mechanic).toBe("shelf");
    expect(currentStep(d)).toBe("theme");
    expect(applyPatch(d, { mechanic: "first-tap" }, SHELF).errors).toEqual(["this template fixes how a tap scores"]);
    d = applyPatch(d, { template: "quick-draw" }, SHELF).draft;
    expect(d.brief.mechanic).toBeNull();
    expect(currentStep(d)).toBe("mechanic");
  });

  it("skips the template on a shelf of one, and the default's mechanic is settled from the start", () => {
    expect(currentStep(emptyDraft([QUICK_DRAW]))).toBe("mechanic");
    const only = emptyDraft([{ ...STOCK_DUEL, default: true }]);
    expect(currentStep(only)).toBe("theme");
    expect(previousStep(only)).toBeNull();
  });

  it("skips every step one answer settled", () => {
    const d = applyPatch(emptyDraft(SHELF), { template: "quick-draw", mechanic: "first-tap", theme: "Pirates", stakes: [10, 5] }, SHELF);
    expect(d.changed).toEqual(["template", "mechanic", "theme", "stakes"]);
    expect(currentStep(d.draft)).toBe("twist");
    expect(d.draft.brief.stakes).toEqual([5, 10]);
    expect(currentStep(applyPatch(d.draft, { twist: "none" }, SHELF).draft)).toBe("voice");
  });

  it("goes back to the last step the player settled, keeping its value; never to a shelf-settled one", () => {
    let d = pick(pick(emptyDraft(SHELF), "stock-duel"));
    expect(currentStep(d)).toBe("twist");
    expect(previousStep(d)).toBe("theme");
    d = reopen(d, "theme");
    expect(currentStep(d)).toBe("theme");
    expect(d.brief.theme).toBe("A Wild West showdown");
    expect(previousStep(d)).toBe("template");
    expect(reopen(d, "mechanic")).toBe(d);
  });
});

describe("the keys", () => {
  it("are short labels for every step", () => {
    const d = emptyDraft(SHELF);
    expect(choices("template", d, SHELF)).toEqual([
      { id: "quick-draw", label: "Quick Draw" },
      { id: "stock-duel", label: "Stock Duel" },
    ]);
    expect(choices("stakes", d, SHELF).map((c) => c.label)).toEqual(["1 · 2 · 5 USDC", "5 · 10 · 25 USDC", "10 · 25 · 50 USDC", "25 · 50 · 100 USDC"]);
    expect(choices("twist", d, SHELF).map((c) => c.id)).toContain("none");
    expect(choices("confirm", d, SHELF)).toEqual([{ id: "build", label: "Build it" }]);
    for (const step of ["template", "mechanic", "theme", "twist", "stakes", "voice", "title"] as const) {
      for (const c of choices(step, applyPatch(d, { theme: "Wild West" }, SHELF).draft, SHELF)) expect(c.label.length).toBeLessThanOrEqual(24);
      expect(question(step, d, SHELF).length).toBeLessThan(90);
    }
  });

  it("refuse ids that aren't the step's", () => {
    expect(choicePatch("stakes", "1-2-3", emptyDraft(SHELF), SHELF)).toBeNull();
    expect(choicePatch("template", "b17", emptyDraft(SHELF), SHELF)).toBeNull();
  });

  it("titles come from the theme and the template, at most 24 characters", () => {
    const d = applyPatch(emptyDraft(SHELF), { theme: "A haunted kitchen at midnight" }, SHELF).draft;
    const titles = titleSuggestions(d.brief, SHELF);
    expect(titles[0]).toBe("Haunted Draw");
    expect(titles.every((t) => t.length <= 24)).toBe(true);
    expect(titleSuggestions(emptyDraft(SHELF).brief, SHELF)).toEqual(["New Quick Draw"]);
  });

  it("patches are checked and tidied", () => {
    const r = applyPatch(emptyDraft(SHELF), { template: "nope", stakes: [5, 5], title: "x".repeat(40), theme: "  “Space”  ", twist: "No twist" }, SHELF);
    expect(r.errors).toEqual(["there's no template “nope” on the shelf", "stakes are 1 to 4 whole amounts of USDC"]);
    expect(r.draft.brief.title).toHaveLength(24);
    expect(r.draft.brief.theme).toBe("Space");
    expect(r.draft.brief.twist).toBe(NO_TWIST);
    expect(applyPatch(emptyDraft(SHELF), { stakes: [1, 2, 3, 4, 5] }, SHELF).changed).toEqual([]);
    expect(applyPatch(emptyDraft(SHELF), { stakes: [0.5] }, SHELF).changed).toEqual([]);
    expect(applyPatch(emptyDraft(SHELF), { template: "Stock Duel" }, SHELF).draft.brief.template).toBe("stock-duel");
    expect(applyPatch(emptyDraft(SHELF), { voice: "Pirate" }, SHELF).draft.brief.voice).toBe("A pirate");
  });
});

describe("the keyword fallback", () => {
  const at = (...fields: Field[]): Draft => {
    let d = emptyDraft(SHELF);
    for (const f of fields) d = pick(d, f === "template" ? "quick-draw" : undefined);
    return d;
  };

  it("reads numbers and stakes", () => {
    expect(numbersIn(normal("five, ten or twenty-five"))).toEqual([5, 10, 25]);
    expect(numbersIn(normal("$10 and 25 USDC"))).toEqual([10, 25]);
    expect(stakesIn(normal("keep it low"))).toEqual([1, 2, 5]);
    expect(stakesIn(normal("high rollers"))).toEqual([25, 50, 100]);
    expect(stakesIn(normal("whatever"))).toBeNull();
  });

  it("reads each step's answer, and anything else it names", () => {
    expect(keywordAnswer("stock duel please", emptyDraft(SHELF), SHELF).patch).toEqual({ template: "stock-duel" });
    const mech = at("template");
    expect(keywordAnswer("whoever is fastest", mech, SHELF).patch.mechanic).toMatch(/^Wait for the signal/);
    expect(keywordAnswer("you tap when the lights go out", mech, SHELF).patch.mechanic).toBe("you tap when the lights go out");
    const theme = at("template", "mechanic");
    expect(keywordAnswer("Um, I think it's a haunted kitchen", theme, SHELF).patch).toEqual({ theme: "a haunted kitchen" });
    expect(keywordAnswer("pirates, for 5 or 10 USDC", theme, SHELF).patch).toEqual({ theme: "pirates", stakes: [5, 10] });
    const twist = at("template", "mechanic", "theme");
    expect(keywordAnswer("no twist", twist, SHELF).patch.twist).toBe(NO_TWIST);
    expect(keywordAnswer("decoys!", twist, SHELF).patch.twist).toBe("Decoy signals flash before the real one.");
    const stakes = at("template", "mechanic", "theme", "twist");
    expect(keywordAnswer("ten, twenty-five and fifty", stakes, SHELF).patch.stakes).toEqual([10, 25, 50]);
    const voice = at("template", "mechanic", "theme", "twist", "stakes");
    expect(keywordAnswer("the robot", voice, SHELF).patch.voice).toBe("A robot");
    expect(keywordAnswer("a grumpy chef", voice, SHELF).patch.voice).toBe("a grumpy chef");
    const title = at("template", "mechanic", "theme", "twist", "stakes", "voice");
    expect(keywordAnswer("keep it", title, SHELF).patch.title).toBe(titleSuggestions(title.brief, SHELF)[0]);
    expect(keywordAnswer("call it Laser Noon", title, SHELF).patch.title).toBe("Laser Noon");
    expect(keywordAnswer("Moon Duel", title, SHELF).patch.title).toBe("Moon Duel");
  });

  it("on confirm: yes builds, and 'change the …' reopens a step", () => {
    const done = at("template", "mechanic", "theme", "twist", "stakes", "voice", "title");
    expect(currentStep(done)).toBe("confirm");
    expect(keywordAnswer("Yes, build it!", done, SHELF).build).toBe(true);
    expect(keywordAnswer("hmm, not sure", done, SHELF).build).toBe(false);
    expect(keywordAnswer("change the voice", done, SHELF).change).toBe("voice");
    expect(keywordAnswer("a different name", done, SHELF).change).toBe("title");
  });
});
