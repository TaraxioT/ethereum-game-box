// The Build screen: the World Computer making a new game. It stands on the whole lit Grid. Left: what is being built
// (a kicker with the build's state, the game's title, the step at work, the time it has run on a mono readout) over a
// log of the agent's own words. Right: the brief it was built from. In the middle the core takes a packet of the
// system's light for every tool call the agent makes, along the trace for its kind of work (reading down Player 1's
// trace, writing down Player 2's, the build check down the clock's feed). Along the bottom, where the rack's programs
// stand, the four compile checks (manifest, type check, bundle, icon), each lighting as its check lands and sending a
// packet up its slot's trace. The result: the game's title and HOME, or the error in plain words and a key back to the
// Designer. A sim build says SIMULATED.
//
// It draws from ForgeEvents. Events older than a moment are a replay (a screen that came in late): they set the end
// state without moving anything. Only transform and opacity animate; under reduced motion it shows end states.
import type { CompileStep, ForgeEvent, ForgeJob, ForgeStatus } from "../../builder/types.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbLcd } from "../parts/lcd.ts";
import type { EgbSeg } from "../parts/seg.ts";
import { chamferClip, fitFrame } from "../parts/frame.ts";
import { el, facesReady, fitFont, place } from "../shell/dom.ts";
import { flicker, rez } from "../shell/rez.ts";
import { LIGHT, type TraceName } from "../shell/traces.ts";
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

/** A compile check is cut like a program in the rack, whose place it takes. */
const COMPILE_CHAMFER = 16;

/** An event this much older than the Box's clock is a replay: it draws its end state, without a moment. */
const LIVE_MS = 2_000;

/** A tool's kind of work and its trace into the core. Every packet is the system's light, even on a port's trace: a
 * seat's colour would say a player did it. */
function wire(name: string): { readonly trace: TraceName; readonly verb: string } {
  if (name.endsWith("build_game")) return { trace: "clock", verb: "CHECKING THE BUILD" };
  if (name === "Write") return { trace: "port1", verb: "WRITING" };
  if (name === "Edit") return { trace: "port1", verb: "EDITING" };
  if (name === "Glob" || name === "Grep") return { trace: "port0", verb: "SEARCHING" };
  return { trace: "port0", verb: "READING" };
}

const base = (path: string | null): string => (path ? (path.split("/").pop() ?? path) : "");

/** mm:ss. */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
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
  const sim = document.createElement("egb-panel");
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
    const fill = el("i", "frame-fill");
    fill.style.clipPath = chamferClip(COMPILE_CHAMFER, "tr-bl");
    const lamp = el("i", "compile-lamp");
    const name = el("span", "compile-name", label);
    const word = el("span", "compile-word", "WAITING");
    plate.append(fill, lamp, name, word);
    fitFrame(plate, { chamfer: COMPILE_CHAMFER, corners: "tr-bl" });
    const slot = layout.rack[i];
    if (slot) place(plate, compileSlot(slot));
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
  void facesReady().then(() => fitFont(title, at.head.w, layout.orientation === "portrait" ? 40 : 44));
  fitFont(title, at.head.w, layout.orientation === "portrait" ? 40 : 44);

  function packet(trace: TraceName, colour: string = LIGHT.sys, reverse = false): void {
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
    const key = (label: string, variant: "primary" | "ghost", act: () => void): EgbKey => {
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
    if (status === "done") keys.replaceChildren(key("HOME", "primary", home));
    else if (status === "failed") keys.replaceChildren(key("DESIGNER", "primary", hooks.toDesigner), key("HOME", "ghost", home));
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
        if (live) packet(w.trace);
        break;
      }
      case "tool_done":
        if (!event.ok && live) packet("clock", LIGHT.alert, true);
        break;
      case "compile": {
        const i = COMPILE.findIndex((c) => c.step === event.step);
        setPlate(i, event.ok ? "ok" : "bad", event.ok ? "OK" : "FAILED");
        if (!event.ok) lcd.push(`${COMPILE[i]?.label ?? event.step}: ${event.text}`, "bad");
        if (live && i >= 0) {
          packet(`slot${i}` as TraceName, event.ok ? LIGHT.sys : LIGHT.alert);
          sound.play(event.ok ? "tick" : "error");
          flicker(plates[i]!.plate);
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
          void rez(keys);
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
