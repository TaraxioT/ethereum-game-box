// The Designer as a service the server mounts behind the launcher token: one session at a time, one question at a
// time, ending in a GameBrief. Keys (choose), typed or spoken words (answer, transcribe), back() and confirm() all edit
// one draft; every change streams to the screen through onChange.
//
// The race with a late model reply: reading words takes up to 5 s, and the player may tap a key, go back, or answer
// again meanwhile. So the session counts edits (a generation number, and the generation each field was last edited
// at). A reply is applied to the brief as it is when the reply lands, never to the brief it was asked about, and only
// to fields nobody has touched since the question; a "yes, build it" counts only if the brief hasn't changed at all
// since; a newer answer supersedes an older one still being read, and a build that started meanwhile drops it.
import { randomBytes } from "node:crypto";
import type { ModelClient, ModelProvider } from "../llm/model.ts";
import type { DesignerState, GameBrief } from "../types.ts";
import type { SpokenLine, VoicePort, VoiceStatus } from "../voice/port.ts";
import { DesignerError } from "./errors.ts";
import type { ReadAnswer } from "./keywords.ts";
import type { EditLock } from "./lock.ts";
import { readAnswer } from "./reader.ts";
import { mockTurns, type MockTurn } from "./script.ts";
import type { ShelfPort, ShelfTemplate } from "./shelf.ts";
import {
  applyPatch,
  BUILD,
  choicePatch,
  choices,
  currentStep,
  emptyDraft,
  FIELDS,
  previousStep,
  question,
  reopen,
  templateOf,
  type BriefPatch,
  type Draft,
  type Field,
} from "./steps.ts";

/** Longer answers are cut: nobody says more to a one-line question. */
export const MAX_ANSWER_CHARS = 500;

export interface DesignerDeps {
  readonly shelf: ShelfPort;
  /** Held by the Forge while a build runs. */
  readonly lock: EditLock;
  readonly model: ModelClient;
  readonly voice: VoicePort;
  /** Session ids (tests). */
  readonly newId?: () => string;
}

export interface DesignerService {
  /** A new session (it replaces any other), asking its first open question. */
  start(): DesignerState;
  /** The active session, or null before start(). */
  state(): DesignerState | null;
  /** Answers the current step with one of its keys. The confirm step's `build` key confirms (see confirm()). */
  choose(choiceId: string, session?: string): DesignerState;
  /** Answers with words, typed or heard: the model reads them (≤ 5 s), else keywords. */
  answer(text: string, session?: string): Promise<DesignerState>;
  /** Reopens the last step the player settled before the current one. */
  back(session?: string): DesignerState;
  /** The finished brief, handed to every onConfirm listener (the Forge, which then holds the lock). */
  confirm(session?: string): GameBrief;
  /** Hears a recorded answer and reads it, as answer() does. `text` null: nothing was heard. */
  transcribe(audio: Uint8Array, mime: string, session?: string): Promise<{ readonly text: string | null; readonly state: DesignerState }>;
  /** The current question, spoken: its words, and a clip when the voice made one. */
  speak(session?: string): Promise<SpokenLine>;
  /** The file behind a clip name speak() returned, or null. */
  clipPath(file: string): string | null;
  /** Mock voice: the rest of the session as scripted turns (the screen may play them). Empty otherwise. */
  mockTurns(): readonly MockTurn[];
  status(): { readonly model: { readonly provider: ModelProvider; readonly reason: string | null }; readonly voice: VoiceStatus };
  /** Every change of the state, for streaming to the screen. Returns an unsubscribe function. */
  onChange(listener: (state: DesignerState) => void): () => void;
  /** Each confirmed brief. A listener that throws makes confirm() throw. Returns an unsubscribe function. */
  onConfirm(listener: (brief: GameBrief) => void): () => void;
  /** Lets go of the lock's listener and any model call in flight. */
  stop(): void;
}

interface Session {
  readonly id: string;
  draft: Draft;
  /** Bumped on every edit of a field. */
  gen: number;
  /** The generation each field was last edited at. */
  readonly edited: Partial<Record<Field, number>>;
  /** The words being read now; a newer answer replaces it. */
  reading: { readonly abort: AbortController } | null;
}

export function createDesigner(deps: DesignerDeps): DesignerService {
  const newId = deps.newId ?? (() => `d${randomBytes(6).toString("hex")}`);
  const changeListeners = new Set<(state: DesignerState) => void>();
  const confirmListeners = new Set<(brief: GameBrief) => void>();
  let current: Session | null = null;

  const shelf = (): readonly ShelfTemplate[] => deps.shelf.templates();

  function view(s: Session): DesignerState {
    const sh = shelf();
    const step = currentStep(s.draft);
    return {
      session: s.id,
      step,
      question: question(step, s.draft, sh),
      choices: choices(step, s.draft, sh),
      brief: structuredClone(s.draft.brief),
      locked: deps.lock.held(),
      thinking: s.reading !== null,
    };
  }

  function emit(): void {
    if (!current) return;
    const state = view(current);
    for (const listener of [...changeListeners]) {
      try {
        listener(state);
      } catch {
        // A broken subscriber (a closed socket) must not break the edit that told it.
      }
    }
  }

  // A build starting drops any reading in flight (its reply would edit a brief being built); `locked` streams.
  const stopLock = deps.lock.onChange((held) => {
    if (held) current?.reading?.abort.abort();
    emit();
  });

  function active(session?: string): Session {
    if (!current) throw new DesignerError("no-session", "No design is open: start one.");
    if (session !== undefined && session !== current.id) throw new DesignerError("stale", "That design was replaced by a newer one.");
    return current;
  }

  function editable(): void {
    if (deps.lock.held()) throw new DesignerError("locked", "A game is being built: the design can't change until it's done.");
  }

  function edit(s: Session, draft: Draft, changed: readonly Field[]): void {
    s.draft = draft;
    for (const f of changed) s.edited[f] = ++s.gen;
  }

  function settle(s: Session, patch: BriefPatch): void {
    const r = applyPatch(s.draft, patch, shelf());
    edit(s, r.draft, r.changed);
  }

  function open(s: Session, field: Field): void {
    const next = reopen(s.draft, field);
    if (next !== s.draft) edit(s, next, [field]);
  }

  function confirmSession(s: Session): GameBrief {
    editable();
    const sh = shelf();
    const step = currentStep(s.draft);
    if (step !== "confirm") throw new DesignerError("not-ready", `Still to decide: ${FIELDS.filter((f) => !s.draft.settled[f]).join(", ")}.`);
    if (!templateOf(s.draft.brief, sh)) {
      // The template left the shelf since it was picked: ask again rather than build from nothing.
      open(s, "template");
      emit();
      throw new DesignerError("not-ready", "That template isn't on the shelf any more: pick another.");
    }
    s.reading?.abort.abort();
    s.reading = null;
    const brief = structuredClone(s.draft.brief);
    for (const listener of [...confirmListeners]) listener(structuredClone(brief));
    emit();
    return brief;
  }

  /**
   * A reading lands on the brief as it is now. Fields edited since the question keep their newer value; a "change"
   * reopens its step unless that step was edited since; a "yes" counts only on an unchanged brief.
   */
  function applyRead(s: Session, read: ReadAnswer, asked: number): void {
    const untouched = (f: Field) => (s.edited[f] ?? 0) <= asked;
    const fresh = Object.fromEntries(Object.entries(read.patch).filter(([f]) => untouched(f as Field))) as BriefPatch;
    const unchanged = s.gen === asked;
    settle(s, fresh);
    if (read.change && untouched(read.change)) open(s, read.change);
    if (read.build && unchanged && currentStep(s.draft) === "confirm") {
      try {
        confirmSession(s);
      } catch {
        // Not buildable after all (the shelf changed): the read-back is still on screen.
      }
    }
  }

  async function answer(text: string, session?: string): Promise<DesignerState> {
    const s = active(session);
    editable();
    const words = text.trim().slice(0, MAX_ANSWER_CHARS);
    if (!words) throw new DesignerError("empty", "Say or type an answer.");
    s.reading?.abort.abort();
    const reading = { abort: new AbortController() };
    s.reading = reading;
    const asked = s.gen;
    emit();
    const read = await readAnswer(words, s.draft, shelf(), deps.model, { signal: reading.abort.signal });
    // Superseded by a newer answer, replaced by a new session, or dropped by a build: the newer state stands.
    if (current !== s || s.reading !== reading) return current ? view(current) : view(s);
    s.reading = null;
    if (!deps.lock.held()) applyRead(s, read, asked);
    emit();
    return view(s);
  }

  return {
    start() {
      editable();
      current?.reading?.abort.abort();
      current = { id: newId(), draft: emptyDraft(shelf()), gen: 0, edited: {}, reading: null };
      emit();
      return view(current);
    },

    state: () => (current ? view(current) : null),

    choose(choiceId, session) {
      const s = active(session);
      editable();
      const step = currentStep(s.draft);
      if (step === "confirm") {
        if (choiceId !== BUILD) throw new DesignerError("bad-choice", `“${choiceId}” isn't a key here.`);
        confirmSession(s);
        return view(s);
      }
      const patch = choicePatch(step, choiceId, s.draft, shelf());
      if (!patch) throw new DesignerError("bad-choice", `“${choiceId}” isn't a key for ${step}.`);
      settle(s, patch);
      emit();
      return view(s);
    },

    answer,

    back(session) {
      const s = active(session);
      editable();
      const step = previousStep(s.draft);
      if (step) {
        open(s, step);
        emit();
      }
      return view(s);
    },

    confirm: (session) => confirmSession(active(session)),

    async transcribe(audio, mime, session) {
      const s = active(session);
      editable();
      // The mock "player" answers whatever the Designer just asked.
      if (deps.voice.mode === "mock" && deps.voice.pending() === 0) {
        const turn = mockTurns(s.draft, shelf())[0];
        if (turn) deps.voice.script([turn.hear]);
      }
      const text = await deps.voice.transcribe(audio, mime);
      if (!text) return { text: null, state: view(active(s.id)) };
      return { text, state: await answer(text, s.id) };
    },

    async speak(session) {
      const s = active(session);
      return deps.voice.speak(question(currentStep(s.draft), s.draft, shelf()));
    },

    clipPath: (file) => deps.voice.clipPath(file),

    mockTurns: () => (current && deps.voice.mode === "mock" ? mockTurns(current.draft, shelf()) : []),

    status: () => ({ model: { provider: deps.model.provider, reason: deps.model.reason }, voice: deps.voice.status() }),

    onChange(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },

    onConfirm(listener) {
      confirmListeners.add(listener);
      return () => confirmListeners.delete(listener);
    },

    stop() {
      stopLock();
      current?.reading?.abort.abort();
    },
  };
}
