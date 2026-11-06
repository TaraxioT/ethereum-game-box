// The Build screen: the World Computer making a new game. It stands on the whole lit board. Left: what is being
// built (a kicker with the build's state, the game's title, the step at work, the time it has run on an amber LCD)
// over a mint LCD of the agent's own words. Right: the brief it was built from. In the middle the core takes a packet
// for every tool call the agent makes, along the trace for its kind of work (reading down Player 1's copper, writing
// down Player 2's, the build check down the clock's feed). Along the bottom, in the rack's housings, the four compile
// plates (manifest, type check, bundle, icon), each lighting as its check lands and sending a packet up its housing's
// trace. The result: the game's title and HOME, or the error in plain words and a key back to the Designer. A sim build
// says SIMULATED.
//
// It draws from ForgeEvents. Events older than a moment are a replay (a screen that came in late): they set the end
// state without moving anything. Only transform and opacity animate; under reduced motion it shows end states.
import type { CompileStep, ForgeEvent, ForgeJob, ForgeStatus } from "../../builder/types.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbLcd } from "../parts/lcd.ts";
import type { EgbPlate } from "../parts/plate.ts";
import type { EgbSeg } from "../parts/seg.ts";
import { el, fitFont, place, play } from "../shell/dom.ts";
import { NEON, type TraceName } from "../shell/traces.ts";
import { createBriefPlates } from "./brief-plates.ts";
import { buildLayout, compileSlot } from "./builder-layout.ts";
import type { ViewContext } from "./view.ts";

const KICKER: Record<ForgeStatus, string> = {
  queued: "QUEUED",
  preparing: "PREPARING",
  working: "BUILDING",
  compiling: "CHECKING",
  fixing: "FIXING",
  installing: "INSTALLING",
  done: "READY TO PLAY",
  failed: "DIDN'T BUILD",
};

const COMPILE: readonly { readonly step: CompileStep; readonly label: string }[] = [
  { step: "manifest", label: "MANIFEST" },
  { step: "typecheck", label: "TYPE CHECK" },
  { step: "bundle", label: "BUNDLE" },
  { step: "icon", label: "ICON" },
];

/** An event this much older than the Box's clock is a replay: it draws its end state, without a moment. */
const LIVE_MS = 2_000;

/** A tool's kind of work, its trace into the core and its packet's colour. */
function wire(name: string): { readonly trace: TraceName; readonly colour: string; readonly verb: string } {
  if (name.endsWith("build_game")) return { trace: "clock", colour: NEON.gold, verb: "CHECKING THE BUILD" };
  if (name === "Write") return { trace: "port1", colour: NEON.mint, verb: "WRITING" };
  if (name === "Edit") return { trace: "port1", colour: NEON.mint, verb: "EDITING" };
  if (name === "Glob" || name === "Grep") return { trace: "port0", colour: NEON.lav, verb: "SEARCHING" };
  return { trace: "port0", colour: NEON.lav, verb: "READING" };
}

const base = (path: string | null): string => (path ? (path.split("/").pop() ?? path) : "");

/** mm.ss on the seven-segment cells (they have no colon). */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}.${String(s % 60).padStart(2, "0")}`;
}

export interface BuildScreen {
  readonly el: HTMLElement;
  /** The job this screen shows. */
  readonly job: string;
  apply(event: ForgeEvent): void;
  /** Back to the job's start: a replay follows (the stream reconnected). */
  reset(): void;
  dispose(): void;
}

export interface BuildHooks {
  /** A build failed: back to the Designer, its brief still there. */
  toDesigner(): void;
  /** A build moved on: the Box keeps the builder open. */
  stay(): void;
}

export function createBuildScreen(ctx: ViewContext, job: ForgeJob, hooks: BuildHooks): BuildScreen {
  const { layout, machine, sound, link } = ctx;
  const at = buildLayout(layout);
  const root = el("div", "build");

  const head = el("div", "build-head");
  place(head, at.head);
  const kickerRow = el("div", "build-kicker-row");
  const kicker = el("div", "build-kicker");
  const sim = document.createElement("egb-plate") as EgbPlate;
  sim.classList.add("build-sim");
  sim.textContent = "SIMULATED";
  sim.hidden = job.provider !== "sim";
  kickerRow.append(kicker, sim);
  const title = el("h1", "build-title");
  const stepRow = el("div", "build-step-row");
  const step = el("div", "build-step");
  const elapsed = document.createElement("egb-seg") as EgbSeg;
  elapsed.classList.add("build-clock");
  elapsed.setAttribute("digits", "5");
  stepRow.append(step, elapsed);
  head.append(kickerRow, title, stepRow);

  const lcd = document.createElement("egb-lcd") as EgbLcd;
  lcd.classList.add("build-lcd");
  place(lcd, at.lcd);

  const keys = el("div", "build-keys");
  place(keys, at.keys);

  const plates = COMPILE.map(({ label }, i) => {
    const plate = el("div", "compile-plate");
    plate.dataset.state = "idle";
    const lamp = el("i", "compile-lamp");
    const name = el("span", "compile-name", label);
    const word = el("span", "compile-word", "WAITING");
    plate.append(lamp, name, word);
    const housing = layout.rack[i];
    if (housing) place(plate, compileSlot(housing));
    return { plate, word };
  });

  root.append(head, lcd, keys, ...plates.map((p) => p.plate));
  if (at.brief) {
    const brief = createBriefPlates();
    brief.set(job.brief, null, false);
    place(brief.el, at.brief);
    root.append(brief.el);
  }

  let status: ForgeStatus = job.status;
  let endedAt: number | null = null;
  let disposed = false;
  /** Traces with a packet on them now: a burst of tool calls sends one per trace, not a pile. */
  const flying = new Set<TraceName>();

  title.textContent = job.brief.title ?? job.brief.template.replace(/-/g, " ");
  void document.fonts.ready.then(() => fitFont(title, at.head.w, layout.orientation === "portrait" ? 40 : 44));
  fitFont(title, at.head.w, layout.orientation === "portrait" ? 40 : 44);

  function packet(trace: TraceName, colour: string, reverse = false): void {
    if (flying.has(trace)) return;
    flying.add(trace);
    void machine.run(trace, { colour, reverse }).then(() => {
      flying.delete(trace);
      if (!reverse && !disposed) machine.swell();
    });
  }

  function setStatus(next: ForgeStatus, text: string): void {
    status = next;
    root.dataset.status = next;
    kicker.textContent = KICKER[next];
    if (next !== "done" && next !== "failed") step.textContent = text.toUpperCase();
  }

  function setPlate(i: number, state: "idle" | "checking" | "ok" | "bad", word: string): void {
    const p = plates[i];
    if (!p) return;
    p.plate.dataset.state = state;
    p.word.textContent = word;
  }

  function drawKeys(): void {
    const key = (label: string, variant: "brass" | "metal", act: () => void): EgbKey => {
      const k = document.createElement("egb-key") as EgbKey;
      k.setAttribute("variant", variant);
      k.textContent = label;
      k.addEventListener("click", () => {
        sound.play("tap");
        act();
      });
      return k;
    };
    const home = () => link.send({ type: "home" });
    if (status === "done") keys.replaceChildren(key("HOME", "brass", home));
    else if (status === "failed") keys.replaceChildren(key("DESIGNER", "brass", hooks.toDesigner), key("HOME", "metal", home));
    else keys.replaceChildren();
  }

  function tick(): void {
    elapsed.value = clock((endedAt ?? link.now()) - job.createdAt);
  }
  const ticker = setInterval(tick, 1000);

  function start(): void {
    setStatus(job.status, "");
    endedAt = null;
    lcd.clear();
    lcd.toggleAttribute("caret", true);
    plates.forEach((_, i) => setPlate(i, "idle", "WAITING"));
    drawKeys();
    tick();
  }

  function apply(event: ForgeEvent): void {
    if (event.job !== job.id || disposed) return;
    const live = link.now() - event.at < LIVE_MS;
    if (live) hooks.stay();
    switch (event.type) {
      case "status":
        setStatus(event.status, event.text);
        break;
      case "say":
        lcd.push(event.text);
        break;
      case "tool": {
        const w = wire(event.name);
        step.textContent = event.path ? `${w.verb} ${base(event.path).toUpperCase()}` : w.verb;
        // A build check starts over: every plate waits for its new answer.
        if (event.name.endsWith("build_game")) plates.forEach((_, i) => setPlate(i, "checking", "CHECKING"));
        if (live) packet(w.trace, w.colour);
        break;
      }
      case "tool_done":
        if (!event.ok && live) packet("clock", "#ff6b6b", true);
        break;
      case "compile": {
        const i = COMPILE.findIndex((c) => c.step === event.step);
        setPlate(i, event.ok ? "ok" : "bad", event.ok ? "OK" : "FAILED");
        if (!event.ok) lcd.push(`${COMPILE[i]?.label ?? event.step}: ${event.text}`, "bad");
        if (live && i >= 0) {
          packet(`slot${i}` as TraceName, event.ok ? NEON.mint : "#ff6b6b");
          sound.play(event.ok ? "tick" : "error");
          void play(plates[i]!.plate, [{ transform: "translateY(5px)" }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
        }
        break;
      }
      case "result":
        endedAt = event.at;
        tick();
        lcd.toggleAttribute("caret", false);
        setStatus(event.ok ? "done" : "failed", "");
        if (event.ok) {
          step.textContent = "IN THE LIBRARY";
          lcd.push("Installed. Its cartridge is in the rack.", "ok");
        } else {
          step.textContent = "YOUR BRIEF IS KEPT";
          lcd.push(event.error ?? "The build stopped.", "bad");
        }
        drawKeys();
        if (live) {
          sound.play(event.ok ? "win" : "lose");
          if (event.ok) machine.coin();
          void play(keys, [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { duration: 360, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
        }
        break;
    }
  }

  start();

  return {
    el: root,
    job: job.id,
    apply,
    reset: start,
    dispose() {
      disposed = true;
      clearInterval(ticker);
    },
  };
}
