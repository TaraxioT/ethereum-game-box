import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesignerState, GameBrief } from "../types.ts";
import { createMockVoice } from "../voice/mock.ts";
import type { VoicePort } from "../voice/port.ts";
import { DesignerError } from "./errors.ts";
import { createEditLock, type EditLock } from "./lock.ts";
import { createDesigner, type DesignerService } from "./service.ts";
import { deferred, fakeModel, NOTHING, offModel, shelfPort } from "./test-helpers.ts";
import type { ModelClient } from "../llm/model.ts";

interface Rig {
  designer: DesignerService;
  lock: EditLock;
  states: DesignerState[];
  briefs: GameBrief[];
}

function rig(o: { model?: ModelClient; voice?: VoicePort } = {}): Rig {
  const lock = createEditLock();
  let n = 0;
  const designer = createDesigner({ shelf: shelfPort(), lock, model: o.model ?? offModel, voice: o.voice ?? createMockVoice(), newId: () => `d${++n}` });
  const states: DesignerState[] = [];
  const briefs: GameBrief[] = [];
  designer.onChange((s) => states.push(s));
  designer.onConfirm((b) => briefs.push(b));
  return { designer, lock, states, briefs };
}

/** Taps keys until the confirm step. */
function keysToConfirm(d: DesignerService): DesignerState {
  let s = d.state()!;
  for (let i = 0; i < 10 && s.step !== "confirm"; i++) s = d.choose(s.choices[0]!.id);
  return s;
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DesignerError).code;
  }
  return null;
};

afterEach(() => {
  vi.useRealTimers();
});

describe("a Designer session", () => {
  it("asks one question at a time, with keys, and confirms a GameBrief to the Forge", () => {
    const { designer, states, briefs } = rig();
    expect(designer.state()).toBeNull();
    const first = designer.start();
    expect(first).toMatchObject({ session: "d1", step: "template", question: "Which game should we start from?", locked: false, thinking: false });
    expect(first.choices.map((c) => c.id)).toEqual(["quick-draw", "stock-duel"]);
    const at = keysToConfirm(designer);
    expect(at.step).toBe("confirm");
    expect(at.question).toMatch(/Shall I build it\?$/);
    expect(states.map((s) => s.step)).toEqual(["template", "mechanic", "theme", "twist", "stakes", "voice", "title", "confirm"]);
    const brief = designer.confirm();
    expect(brief).toEqual({
      template: "quick-draw",
      mechanic: "Wait for the signal; the first tap after it wins the round, and a tap before it is a foul.",
      theme: "A Wild West showdown",
      twist: "It gets faster every round.",
      stakes: [1, 2, 5],
      voice: "A sports commentator",
      title: "Wild Draw",
    });
    expect(briefs).toEqual([brief]);
  });

  it("skips the mechanic for a template that fixes it", () => {
    const { designer } = rig();
    designer.start();
    expect(designer.choose("stock-duel").step).toBe("theme");
    expect(designer.back().step).toBe("template");
  });

  it("refuses bad keys, empty words, stale sessions, and confirming early", async () => {
    const { designer } = rig();
    expect(code(() => designer.choose("x"))).toBe("no-session");
    designer.start();
    expect(code(() => designer.choose("b17"))).toBe("bad-choice");
    expect(code(() => designer.choose("build"))).toBe("bad-choice");
    expect(code(() => designer.confirm())).toBe("not-ready");
    await expect(designer.answer("   ")).rejects.toMatchObject({ code: "empty", status: 400 });
    designer.start();
    expect(code(() => designer.choose("quick-draw", "d1"))).toBe("stale");
    expect(designer.choose("quick-draw", "d2").step).toBe("mechanic");
    expect(designer.back().step).toBe("template");
    expect(designer.back().step).toBe("template");
  });

  it("the Build it key confirms", () => {
    const { designer, briefs } = rig();
    designer.start();
    keysToConfirm(designer);
    designer.choose("build");
    expect(briefs).toHaveLength(1);
  });
});

describe("the edit lock", () => {
  it("refuses every edit while the Forge holds it, and streams `locked`", async () => {
    const { designer, lock, states } = rig();
    designer.start();
    keysToConfirm(designer);
    // The Forge takes the lock as it accepts the brief.
    designer.onConfirm(() => void lock.hold());
    designer.confirm();
    expect(states.at(-1)!.locked).toBe(true);
    expect(code(() => designer.choose("build"))).toBe("locked");
    expect(code(() => designer.back())).toBe("locked");
    expect(code(() => designer.confirm())).toBe("locked");
    expect(code(() => designer.start())).toBe("locked");
    await expect(designer.answer("change the title")).rejects.toMatchObject({ code: "locked", status: 409 });
    await expect(designer.transcribe(new Uint8Array(2000), "audio/wav")).rejects.toMatchObject({ code: "locked" });
  });

  it("opens again when the build ends", () => {
    const { designer, lock, states } = rig();
    designer.start();
    const release = lock.hold();
    expect(states.at(-1)!.locked).toBe(true);
    release();
    release();
    expect(states.at(-1)!.locked).toBe(false);
    expect(designer.choose("quick-draw").step).toBe("mechanic");
  });

  it("drops a model reply that lands after a build started", async () => {
    const reply = deferred<unknown>();
    const { designer, lock, states } = rig({ model: fakeModel(() => reply.promise) });
    designer.start();
    const answering = designer.answer("stock duel");
    expect(states.at(-1)!.thinking).toBe(true);
    lock.hold();
    reply.resolve({ ...NOTHING, template: "stock-duel" });
    const after = await answering;
    expect(after.brief.template).toBe("quick-draw");
    expect(after.step).toBe("template");
    expect(after.thinking).toBe(false);
  });
});

describe("a late model reply", () => {
  it("applies to the brief as it is when it lands: keys tapped meanwhile win, the rest of the reply still counts", async () => {
    const reply = deferred<unknown>();
    const { designer, states } = rig({ model: fakeModel(() => reply.promise) });
    designer.start();
    designer.choose("quick-draw");
    designer.choose("first-tap");
    expect(designer.state()!.step).toBe("theme");
    const answering = designer.answer("pirates, for 25, 50 or 100");
    expect(designer.state()!.thinking).toBe(true);
    // While the model reads, the player taps Deep space and then a twist.
    designer.choose("deep-space");
    designer.choose("decoys");
    expect(designer.state()!.step).toBe("stakes");
    reply.resolve({ ...NOTHING, theme: "Pirates", stakes: [25, 50, 100] });
    const after = await answering;
    expect(after.brief.theme).toBe("Deep space");
    expect(after.brief.twist).toBe("Decoy signals flash before the real one.");
    expect(after.brief.stakes).toEqual([25, 50, 100]);
    expect(after.step).toBe("voice");
    expect(after.thinking).toBe(false);
    expect(states.at(-1)).toEqual(after);
  });

  it("doesn't reopen a step the player went back to meanwhile", async () => {
    const reply = deferred<unknown>();
    const { designer } = rig({ model: fakeModel(() => reply.promise) });
    designer.start();
    designer.choose("quick-draw");
    designer.choose("first-tap");
    const answering = designer.answer("first tap wins, in space");
    designer.back(); // reopens the mechanic
    reply.resolve({ ...NOTHING, mechanic: "Last tap loses", theme: "Space" });
    const after = await answering;
    expect(after.step).toBe("mechanic");
    expect(after.brief.mechanic).toMatch(/^Wait for the signal/);
    expect(after.brief.theme).toBe("Space");
  });

  it("builds on a yes only if the brief is still the one that was read back", async () => {
    const reply = deferred<unknown>();
    const { designer, briefs } = rig({ model: fakeModel(() => reply.promise) });
    designer.start();
    keysToConfirm(designer);
    const answering = designer.answer("yes, build it");
    designer.back(); // the title is open again: the yes was about another brief
    designer.choose("title-1");
    reply.resolve({ ...NOTHING, build: true });
    expect((await answering).step).toBe("confirm");
    expect(briefs).toEqual([]);

    const yes = deferred<unknown>();
    const again = rig({ model: fakeModel(() => yes.promise) });
    again.designer.start();
    keysToConfirm(again.designer);
    const said = again.designer.answer("yes, build it");
    yes.resolve({ ...NOTHING, build: true });
    await said;
    expect(again.briefs).toHaveLength(1);
  });

  it("from an older answer is dropped when a newer one was given", async () => {
    const replies = [deferred<unknown>(), deferred<unknown>()];
    let i = 0;
    const { designer } = rig({ model: fakeModel(() => replies[i++]!.promise) });
    designer.start();
    designer.choose("quick-draw");
    designer.choose("first-tap");
    const older = designer.answer("pirates");
    const newer = designer.answer("deep space");
    // The older call returns at once with the state as it stands: its reading will never be applied.
    expect(await older).toMatchObject({ thinking: true, brief: { theme: null } });
    replies[0]!.resolve({ ...NOTHING, theme: "Pirates" });
    replies[1]!.resolve({ ...NOTHING, theme: "Deep space" });
    expect(await newer).toMatchObject({ thinking: false, brief: { theme: "Deep space" } });
    expect(designer.state()!.brief.theme).toBe("Deep space");
  });

  it("past 5 s: keywords answer, and the caller is back on time", async () => {
    vi.useFakeTimers();
    const hang = clientThatNeverAnswers();
    const { designer, states } = rig({ model: hang });
    designer.start();
    designer.choose("quick-draw");
    designer.choose("first-tap");
    let done: DesignerState | null = null;
    void designer.answer("a haunted kitchen").then((s) => (done = s));
    await vi.advanceTimersByTimeAsync(4999);
    expect(done).toBeNull();
    expect(states.at(-1)!.thinking).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(done!.brief.theme).toBe("a haunted kitchen");
    expect(done!.thinking).toBe(false);
  });
});

function clientThatNeverAnswers(): ModelClient {
  return {
    provider: "sdk",
    reason: null,
    json: (req) =>
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("timed out")), req.timeoutMs);
      }),
  };
}

describe("voice", () => {
  it("mock voice drives a Designer session to a confirmed brief, by words alone", async () => {
    const { designer, briefs } = rig();
    designer.start();
    const said: string[] = [];
    const heard: string[] = [];
    for (let turn = 0; turn < 12 && briefs.length === 0; turn++) {
      const line = await designer.speak();
      expect(line.clip).toBeNull();
      said.push(line.text);
      const { text, state } = await designer.transcribe(new Uint8Array(4000), "audio/webm");
      heard.push(text!);
      expect(state.thinking).toBe(false);
    }
    expect(said[0]).toBe("Which game should we start from?");
    expect(said.at(-1)).toMatch(/Shall I build it\?$/);
    expect(heard).toEqual([
      "Quick Draw, please.",
      "First tap wins.",
      "A Wild West showdown!",
      "Make it faster every round.",
      "Five, ten or twenty-five.",
      "A pirate, arr!",
      "Keep it.",
      "Yes, build it!",
    ]);
    expect(briefs).toEqual([
      {
        template: "quick-draw",
        mechanic: "Wait for the signal; the first tap after it wins the round, and a tap before it is a foul.",
        theme: "A Wild West showdown",
        twist: "It gets faster every round.",
        stakes: [5, 10, 25],
        voice: "A pirate",
        title: "Wild Draw",
      },
    ]);
  });

  it("mock turns script the rest of the session; nothing scripted for a live voice", () => {
    const { designer } = rig();
    designer.start();
    designer.choose("stock-duel");
    const turns = designer.mockTurns();
    expect(turns.map((t) => t.say)).toEqual([
      "Where is it set? Pick one, or say anywhere you like.",
      "What's the twist?",
      "What can players stake, in EGB a seat?",
      "Who calls the game?",
      "How about “Wild Duel”? Keep it, or say another name.",
      "“Wild Duel”: Stock Duel set in a Wild West showdown, and it gets faster every round. Each player picks a stock from a turning hand; the better move wins the round. 5, 10 or 25 EGB a seat, called by a pirate. Shall I build it?",
    ]);
    const live = rig({ voice: { ...createMockVoice(), mode: "elevenlabs" } as VoicePort });
    live.designer.start();
    expect(live.designer.mockTurns()).toEqual([]);
  });

  it("nothing heard leaves the session where it was", async () => {
    const silent: VoicePort = { ...createMockVoice(), mode: "elevenlabs", transcribe: async () => null } as VoicePort;
    const { designer } = rig({ voice: silent });
    designer.start();
    const r = await designer.transcribe(new Uint8Array(10), "audio/wav");
    expect(r.text).toBeNull();
    expect(r.state.step).toBe("template");
  });

  it("status says how answers are read and how the Box speaks", () => {
    expect(rig().designer.status()).toEqual({
      model: { provider: "off", reason: "off in tests" },
      voice: { mode: "mock", reason: null, tts: null, stt: null },
    });
  });
});
