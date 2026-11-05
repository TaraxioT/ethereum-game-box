import { afterEach, describe, expect, it, vi } from "vitest";
import { clientOver, type BackendCall } from "../llm/model.ts";
import { readAnswer, READ_TIMEOUT_MS } from "./reader.ts";
import { applyPatch, emptyDraft } from "./steps.ts";
import { fakeModel, NOTHING, offModel, SHELF } from "./test-helpers.ts";

const atTheme = applyPatch(emptyDraft(SHELF), { template: "quick-draw", mechanic: "first-tap" }, SHELF).draft;

afterEach(() => {
  vi.useRealTimers();
});

describe("reading an answer", () => {
  it("takes the model's reading when it has one, with the shelf and the keys in its prompt", async () => {
    const model = fakeModel(() => ({ ...NOTHING, theme: "Pirates on the moon", stakes: [5, 10] }));
    const read = await readAnswer("pirates on the moon, five or ten", atTheme, SHELF, model);
    expect(read).toEqual({ patch: { theme: "Pirates on the moon", stakes: [5, 10] }, build: false, change: null, by: "model" });
    expect(model.prompts[0]).toMatch(/The question \(step "theme"\): Where is it set\?/);
    expect(model.prompts[0]).toMatch(/The keys on screen: Wild West \| Deep space/);
    expect(model.prompts[0]).toMatch(/The player answered: pirates on the moon, five or ten$/);
  });

  it("falls back to keywords when the model is off, fails, says nothing or fails validation", async () => {
    const want = { patch: { theme: "a haunted kitchen" }, build: false, change: null, by: "keywords" };
    expect(await readAnswer("a haunted kitchen", atTheme, SHELF, offModel)).toEqual(want);
    expect(await readAnswer("a haunted kitchen", atTheme, SHELF, fakeModel(() => Promise.reject(new Error("HTTP 529"))))).toEqual(want);
    expect(await readAnswer("a haunted kitchen", atTheme, SHELF, fakeModel(() => NOTHING))).toEqual(want);
    expect(await readAnswer("a haunted kitchen", atTheme, SHELF, fakeModel(() => ({ ...NOTHING, template: "b17" })))).toEqual(want);
    expect(await readAnswer("a haunted kitchen", atTheme, SHELF, fakeModel(() => ({ ...NOTHING, stakes: [2.5] })))).toEqual(want);
    expect(await readAnswer("a haunted kitchen", atTheme, SHELF, fakeModel(() => "pirates"))).toEqual(want);
  });

  it("gives the model 5 s, then keywords answer and the model's call is stopped", async () => {
    vi.useFakeTimers();
    let call: BackendCall | null = null;
    // A backend that never answers and ignores its abort: only the client's deadline ends the wait.
    const model = clientOver("sdk", {
      run: (c) => {
        call = c;
        return new Promise(() => {});
      },
    });
    let done = false;
    const reading = readAnswer("a haunted kitchen", atTheme, SHELF, model).then((r) => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect((await reading).by).toBe("keywords");
    expect(call!.signal.aborted).toBe(true);
    expect(call!.model).toBe("claude-haiku-5-5");
  });
});
