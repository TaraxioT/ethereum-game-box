// Reads a typed or spoken answer: the model first, with a 5 s deadline, and the keyword reader when the model is off,
// late, fails, or comes back with nothing the brief can use while the keywords found something. The caller never
// waits past the deadline: the model client rejects at it, whatever its backend is doing.
import { designerPrompt, designerSchema, designerSystem, parseDesignerAnswer, type DesignerModelAnswer, type DesignerModelContext } from "../llm/designer.ts";
import type { ModelClient } from "../llm/model.ts";
import { keywordAnswer, type ReadAnswer } from "./keywords.ts";
import type { ShelfTemplate } from "./shelf.ts";
import { applyPatch, choices, currentStep, question, type BriefPatch, type Draft } from "./steps.ts";

/** The player is waiting: a tight deadline, then keywords. */
export const READ_TIMEOUT_MS = 5000;

export function modelContext(draft: Draft, shelf: readonly ShelfTemplate[]): DesignerModelContext {
  const step = currentStep(draft);
  return {
    step,
    question: question(step, draft, shelf),
    brief: draft.brief,
    templates: shelf.map(({ id, label }) => ({ id, label })),
    keys: choices(step, draft, shelf).map((c) => c.label),
  };
}

function fromModel(a: DesignerModelAnswer): ReadAnswer {
  const patch: { -readonly [K in keyof BriefPatch]: BriefPatch[K] } = {};
  for (const k of ["template", "mechanic", "theme", "twist", "voice", "title"] as const) {
    const v = a[k];
    if (v !== null && v.trim()) patch[k] = v;
  }
  if (a.stakes?.length) patch.stakes = a.stakes;
  return { patch, build: a.build, change: a.change, by: "model" };
}

const useful = (r: ReadAnswer, draft: Draft, shelf: readonly ShelfTemplate[]) =>
  r.build || r.change !== null || applyPatch(draft, r.patch, shelf).changed.length > 0;

export async function readAnswer(
  text: string,
  draft: Draft,
  shelf: readonly ShelfTemplate[],
  model: ModelClient,
  opts: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<ReadAnswer> {
  const quick = keywordAnswer(text, draft, shelf);
  if (model.provider === "off") return quick;
  const ctx = modelContext(draft, shelf);
  let read: ReadAnswer;
  try {
    const answer = await model.json({
      system: designerSystem(ctx),
      prompt: designerPrompt(text, ctx),
      schema: designerSchema(ctx),
      parse: (v) => parseDesignerAnswer(v, ctx),
      timeoutMs: opts.timeoutMs ?? READ_TIMEOUT_MS,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    read = fromModel(answer);
  } catch {
    return quick;
  }
  return useful(read, draft, shelf) || !useful(quick, draft, shelf) ? read : quick;
}
