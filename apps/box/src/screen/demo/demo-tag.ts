// The DEMO tag: always on screen in Demo mode, fixed to the window's bottom-right corner above the stage. Collapsed,
// it is a small chamfered panel reading DEMO (POWER CUT while the power is cut) with a lamp and a chevron. Opened (a
// tap, or Enter), a panel rezzes up out of it: what the demo is and the links to the project's other pages
// (`about.ts`), then three rows: CUT POWER (sim.setPower), OPPONENT, VS BOT or HOT SEAT (sim.setOpponent), and SOUND
// (sound.setMuted). A tap outside, Escape or the chevron closes it. It keeps in step
// with the simulated Box, and none of its pointer or key events reach the stage.
import "./demo.css";
import type { Opponent, SimLink } from "../link/control.ts";
import type { Sound } from "../views/view.ts";
import { framed } from "../parts/frame.ts";
import { el } from "../shell/dom.ts";
import { derez, rez } from "../shell/rez.ts";
import { aboutSection } from "./about.ts";

const CHAMFER = 10;

/** A light switch: a pill track with a sliding knob. */
function lightSwitch(label: string, onChange: (on: boolean) => void): { row: HTMLElement; set(on: boolean): void } {
  const row = el("div", "demo-row");
  const button = el("button", "demo-switch");
  button.type = "button";
  button.setAttribute("role", "switch");
  button.setAttribute("aria-label", label);
  button.append(el("i", "demo-knob"));
  button.addEventListener("click", () => onChange(button.getAttribute("aria-checked") !== "true"));
  row.append(el("span", "demo-label", label), button);
  return { row, set: (on) => button.setAttribute("aria-checked", String(on)) };
}

export function mountDemoTag(host: HTMLElement, sim: SimLink, sound: Sound): void {
  const tag = el("div", "demo-tag");
  tag.setAttribute("role", "group");
  tag.setAttribute("aria-label", "Demo controls");

  const panel = framed(el("div", "demo-panel"), CHAMFER);
  panel.id = "demo-panel";
  panel.hidden = true;

  const power = lightSwitch("CUT POWER", (cut) => {
    sim.setPower(!cut);
    sync();
  });
  power.row.classList.add("demo-power");

  const opponentRow = el("div", "demo-row");
  const segments = el("div", "demo-segments");
  segments.setAttribute("role", "group");
  segments.setAttribute("aria-label", "Opponent");
  const choices = (["bot", "hotseat"] as const).map((value) => {
    const b = el("button", "demo-segment", value === "bot" ? "VS BOT" : "HOT SEAT");
    b.type = "button";
    b.addEventListener("click", () => {
      sim.setOpponent(value);
      sync();
    });
    return { value, b };
  });
  segments.append(...choices.map((c) => c.b));
  opponentRow.append(el("span", "demo-label", "OPPONENT"), segments);

  const soundSwitch = lightSwitch("SOUND", (on) => {
    sound.setMuted(!on);
    sync();
  });
  panel.append(aboutSection(), power.row, opponentRow, soundSwitch.row);

  const head = framed(el("button", "demo-head"), CHAMFER);
  head.type = "button";
  head.setAttribute("aria-expanded", "false");
  head.setAttribute("aria-controls", panel.id);
  const lamp = el("i", "demo-lamp");
  const word = el("span", "demo-word", "DEMO");
  head.append(lamp, word, el("i", "demo-chevron"));

  tag.append(panel, head);
  host.append(tag);

  let open = false;
  function setOpen(next: boolean): void {
    if (next === open) return;
    open = next;
    head.setAttribute("aria-expanded", String(open));
    if (open) {
      panel.hidden = false;
      void rez(panel);
    } else {
      void derez(panel).then(() => {
        if (!open) panel.hidden = true;
      });
    }
  }

  function sync(): void {
    const cut = !sim.power();
    power.set(cut);
    tag.classList.toggle("cut", cut);
    word.textContent = cut ? "POWER CUT" : "DEMO";
    const opponent: Opponent = sim.opponent();
    for (const { value, b } of choices) b.setAttribute("aria-pressed", String(value === opponent));
    soundSwitch.set(!sound.muted);
  }

  head.addEventListener("click", () => setOpen(!open));
  // Its pointer and key events stay its own: they never tap a seat, skip the boot or start attract.
  for (const type of ["pointerdown", "keydown"] as const) tag.addEventListener(type, (e) => e.stopPropagation());
  tag.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setOpen(false);
      head.focus();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (open && !tag.contains(e.target as Node)) setOpen(false);
  }, { capture: true });
  sim.subscribe(sync);
  sync();
}
