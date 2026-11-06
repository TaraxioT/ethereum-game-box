// The Designer: a new game's brief, one question at a time, on a page round the dimmed core. The step and its question
// on the left with the step's keys under it; the brief so far as panels of light on the right; under the core a status
// log (the model reading an answer, what was heard, a refusal in the Box's words); along the bottom HOME, BACK, a big
// typed-answer field with SEND, and the push-to-talk key. Every answer goes to the Box (server/builder-api.ts),
// which answers with the design as it now stands; the same states also stream in, so a second screen keeps up.
//
// Moments: a new question's keys rez in one after another; a field that fills flickers its panel and runs a packet up
// its trace into the core, which swells; while the model reads, the log's cursor blinks and a packet runs into the
// core every so often. Locked (a build is running): nothing can change, and the log says so.
import type { DesignerState } from "../../builder/types.ts";
import { BUILDER, type BuilderStatus } from "../../server/builder-wire.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbLcd } from "../parts/lcd.ts";
import { el, fitFont, place } from "../shell/dom.ts";
import { rez } from "../shell/rez.ts";
import { LIGHT, type SlotTrace } from "../shell/traces.ts";
import { createDesignerVoice } from "../voice/designer-voice.ts";
import { createBriefPlates } from "./brief-plates.ts";
import { designerLayout } from "./builder-layout.ts";
import { BuilderError, getJson, postJson } from "./builder-link.ts";
import type { ViewContext } from "./view.ts";

const STEP_NAME: Record<DesignerState["step"], string> = {
  template: "STARTING POINT",
  mechanic: "HOW IT SCORES",
  theme: "WHERE IT'S SET",
  twist: "THE TWIST",
  stakes: "THE STAKES",
  voice: "WHO CALLS IT",
  title: "THE TITLE",
  confirm: "READY TO BUILD",
};

/** While the model reads an answer, a packet runs into the core this often. */
const THINK_PULSE_MS = 1_100;

export interface DesignerScreen {
  readonly el: HTMLElement;
  update(state: DesignerState): void;
  setStatus(status: BuilderStatus): void;
  dispose(): void;
}

export interface DesignerHooks {
  /** The player did something: the Box keeps the builder open. */
  stay(): void;
}

export function createDesignerScreen(ctx: ViewContext, status: BuilderStatus, hooks: DesignerHooks): DesignerScreen {
  const { layout, machine, sound, link } = ctx;
  const at = designerLayout(layout);
  const root = el("div", "designer");

  // ---- the question and its keys ------------------------------------------------------------------------------
  const ask = el("div", "designer-ask");
  place(ask, at.question);
  const stepName = el("div", "designer-step");
  const question = el("p", "designer-question");
  ask.append(stepName, question);

  const keys = el("div", "designer-keys");
  place(keys, at.keys);

  // ---- the brief ----------------------------------------------------------------------------------------------
  const plates = createBriefPlates();
  place(plates.el, at.brief);

  // ---- the status log -----------------------------------------------------------------------------------------
  const lcd = document.createElement("egb-lcd") as EgbLcd;
  lcd.classList.add("designer-lcd");
  place(lcd, at.status);

  // ---- the answer bar -----------------------------------------------------------------------------------------
  const bar = el("div", "designer-bar");
  place(bar, at.bar);
  const ghost = (label: string, className: string): EgbKey => {
    const key = document.createElement("egb-key") as EgbKey;
    key.setAttribute("variant", "ghost");
    key.classList.add(className);
    key.textContent = label;
    return key;
  };
  const home = ghost("HOME", "designer-home");
  const back = ghost("BACK", "designer-back");
  const field = el("form", "designer-field");
  const input = el("input", "designer-input");
  input.type = "text";
  input.maxLength = 200;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.enterKeyHint = "send";
  input.placeholder = "Type an answer";
  const send = document.createElement("egb-key") as EgbKey;
  send.classList.add("designer-send");
  send.textContent = "SEND";
  field.append(input);
  const talk = ghost("HOLD TO TALK", "designer-talk");
  bar.append(home, back, field, send, talk);

  root.append(ask, keys, plates.el, lcd, bar);

  let state: DesignerState | null = null;
  let current = status;
  /** One request at a time: a second tap while one is out does nothing. */
  let busy = false;
  let disposed = false;
  let keysFor = "";
  let spoken = "";
  let thinkTimer: ReturnType<typeof setInterval> | undefined;

  const voice = createDesignerVoice(status.voice, () => sound.muted, {
    onCaption: (text) => lcd.push(text),
    onListening: (on) => talk.toggleAttribute("selected", on),
  });

  /** Sends one edit; its answer (the design now) is drawn, a refusal goes on the log. */
  async function act(run: () => Promise<DesignerState | null>): Promise<void> {
    if (busy || !state) return;
    busy = true;
    hooks.stay();
    drawControls();
    try {
      const next = await run();
      if (next && !disposed) update(next);
    } catch (error) {
      if (disposed) return;
      sound.play("error");
      lcd.push(error instanceof BuilderError ? error.message : "The Box didn't answer.", "bad");
      // A newer design replaced this one (another screen started one): show it; none open at all: start one.
      if (error instanceof BuilderError && error.code === "stale") await refresh(() => getJson<DesignerState | null>(BUILDER.designer));
      if (error instanceof BuilderError && error.code === "no-session") await refresh(() => postJson<DesignerState>(BUILDER.start));
    } finally {
      busy = false;
      if (!disposed) drawControls();
    }
  }

  async function refresh(load: () => Promise<DesignerState | null>): Promise<void> {
    const next = await load().catch(() => null);
    if (next && !disposed) update(next);
  }

  function choose(choice: string): void {
    sound.play("tap");
    void act(() => postJson<DesignerState>(BUILDER.choose, { choice, session: state?.session }));
  }

  function answer(): void {
    const text = input.value.trim();
    if (!text) return;
    sound.play("tap");
    void act(async () => {
      lcd.push(`YOU: ${text}`);
      const next = await postJson<DesignerState>(BUILDER.answer, { text, session: state?.session });
      input.value = "";
      return next;
    });
  }

  home.addEventListener("click", () => {
    sound.play("tap");
    link.send({ type: "home" });
  });
  back.addEventListener("click", () => {
    sound.play("tap");
    void act(() => postJson<DesignerState>(BUILDER.back, { session: state?.session }));
  });
  send.addEventListener("click", answer);
  field.addEventListener("submit", (e) => {
    e.preventDefault();
    answer();
  });
  input.addEventListener("input", () => hooks.stay());

  // Push-to-talk: down opens the mic (or plays the scripted line), up sends the take.
  talk.addEventListener("pointerdown", (e) => {
    if (!state || state.locked || busy) return;
    talk.setPointerCapture(e.pointerId);
    sound.play("tick");
    hooks.stay();
    void voice.press();
  });
  const letGo = (): void => {
    const session = state?.session;
    if (!session) return;
    void act(async () => (await voice.release(session))?.state ?? null);
  };
  talk.addEventListener("pointerup", letGo);
  talk.addEventListener("pointercancel", letGo);

  // ---- drawing ------------------------------------------------------------------------------------------------

  function drawKeys(s: DesignerState): void {
    const sig = `${s.session}|${s.step}|${s.choices.map((c) => c.id).join(",")}`;
    if (sig === keysFor) return;
    const fresh = keysFor !== "";
    keysFor = sig;
    const made = s.choices.map((choice) => {
      const key = document.createElement("egb-key") as EgbKey;
      key.dataset.choice = choice.id;
      key.textContent = choice.label;
      key.addEventListener("click", () => choose(choice.id));
      return key;
    });
    keys.replaceChildren(...made);
    keys.dataset.count = String(s.choices.length);
    // A new question's keys rez in one after another (in place, so each draws its line where it stands).
    if (fresh) made.forEach((key, i) => void rez(key, { delay: i * 90 }));
  }

  function drawControls(): void {
    const locked = !state || state.locked;
    const off = locked || busy;
    for (const key of keys.children) {
      const choice = (key as HTMLElement).dataset.choice;
      // The build key also needs a provider that can build here.
      key.toggleAttribute("disabled", off || (choice === "build" && !current.ready.ok));
    }
    back.toggleAttribute("disabled", off);
    send.toggleAttribute("disabled", off);
    talk.toggleAttribute("disabled", locked);
    input.disabled = locked;
  }

  /** The design as it stood when the model started reading: whether its reading changed anything. */
  const sigOf = (s: DesignerState): string => JSON.stringify([s.step, s.brief]);
  let readFrom: string | null = null;

  function drawThinking(next: DesignerState): void {
    const thinking = next.thinking;
    lcd.toggleAttribute("caret", thinking);
    clearInterval(thinkTimer);
    thinkTimer = undefined;
    if (!thinking) {
      if (readFrom !== null) lcd.push(readFrom === sigOf(next) ? "NOTHING THERE I COULD USE: TAP A KEY, OR SAY IT ANOTHER WAY." : "GOT IT.");
      readFrom = null;
      return;
    }
    readFrom = sigOf(next);
    lcd.push("READING YOUR ANSWER…");
    // The answer goes into the machine while it is read: a packet down the clock's feed into the core.
    const pulse = (): void => void machine.run("clock", { colour: LIGHT.sys }).then(() => machine.swell());
    pulse();
    thinkTimer = setInterval(pulse, THINK_PULSE_MS);
  }

  function update(next: DesignerState): void {
    const prev = state;
    state = next;
    const fresh = prev?.session !== next.session;
    stepName.textContent = STEP_NAME[next.step];
    question.textContent = next.question;
    fitQuestion();
    drawKeys(next);
    // A field that filled runs up a feed into the core.
    const filled = plates.set(next.brief, next.step, !fresh);
    filled.forEach((i, n) => {
      setTimeout(() => {
        if (disposed) return;
        void machine.run(`slot${i % 4}` as SlotTrace).then(() => machine.swell());
      }, n * 160);
    });
    if (filled.length) sound.play("tick");
    if (prev?.thinking !== next.thinking) drawThinking(next);
    if (next.locked && !prev?.locked) lcd.push("A GAME IS BEING BUILT: THE DESIGN IS LOCKED.");
    if (next.step === "confirm" && !current.ready.ok) lcd.push(current.ready.reason ?? "This Box can't build games right now.", "bad");
    drawControls();
    // Each new question is spoken, once (ElevenLabs only, and not while muted).
    const line = `${next.session}|${next.question}`;
    if (line !== spoken && !next.locked) {
      spoken = line;
      void voice.speak(next.session);
    }
  }

  /** The question fills its box: as big as fits, down to the smallest size the screen allows. */
  function fitQuestion(): void {
    const max = layout.orientation === "portrait" ? 26 : 30;
    for (let size = max; size >= 16; size -= 2) {
      question.style.fontSize = `${size}px`;
      if (ask.scrollHeight <= at.question.h) break;
    }
    fitFont(stepName, at.question.w, 18);
  }

  lcd.push(voice.mode === "mock" ? "TAP A KEY, TYPE, OR HOLD TO TALK (MOCK VOICE)." : "TAP A KEY, TYPE, OR HOLD TO TALK.");

  return {
    el: root,
    update,
    setStatus(next) {
      current = next;
      drawControls();
    },
    dispose() {
      disposed = true;
      clearInterval(thinkTimer);
      voice.stop();
    },
  };
}
