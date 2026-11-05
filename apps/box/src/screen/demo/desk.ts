// The desk: a dark wood-and-metal bench along the bottom of the window, below the Box's screen. It carries what
// Demo mode draws in place of hardware: the two tap-station pucks at the corners, the badges between them, and the
// engraved DEMO plate with the CUT POWER toggle, the VS BOT / HOT SEAT switch and the mute key. It listens to the
// simulated Box itself, to keep the OLEDs, the buzz motors, the seated badges and the switches true. The parts must
// be registered first (the plate is an <egb-plate>).
import "./demo.css";
import type { Opponent, SimLink } from "../link/sim/control.ts";
import type { BoxEvent, BoxState } from "../link/types.ts";
import type { Sound } from "../views/view.ts";
import { el } from "../shell/dom.ts";
import { CARD_RATIO, createBadgeTray } from "./badges.ts";
import { createPuck, type Puck } from "./puck.ts";

export interface Desk {
  readonly el: HTMLElement;
  /** The desk's height for a window size; it also lays itself out for that size. */
  height(viewW: number, viewH: number): number;
  dispose(): void;
}

/** "row": pucks, tray and plate side by side. "stacked": the tray on top, the pucks and plate below. */
type Arrangement = "row" | "stacked";
/** The plate's controls in one row of two ("wide") or in a column ("tall"). */
type PlateForm = "wide" | "tall";

interface DeskLayout {
  readonly height: number;
  readonly arrangement: Arrangement;
  readonly plate: PlateForm;
  /** The desk's scale: 1 is a 160 px landscape desk. */
  readonly unit: number;
  readonly puck: number;
  readonly card: number;
}

const GUTTER = 16;
const PAD = 8;
/** Between the grid's columns: side by side, and stacked (where the pucks need every pixel). */
const GAP = 16;
const STACKED_GAP = 10;
/** The plate's footprint at unit 1: wide (one row of controls) and tall (a column). */
const PLATE_WIDE_W = 352;
const PLATE_TALL_W = 174;
const PLATE_TALL_H = 180;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * Where everything goes for a window size. Landscape keeps one row while the tray holds two badges side by side,
 * first with the wide plate, then with the tall one; otherwise (and in portrait) the tray moves above the pucks.
 */
export function deskLayout(w: number, h: number): DeskLayout {
  const portrait = w / h < 0.9;
  const height = Math.round(portrait ? clamp(h * 0.26, 180, 260) : clamp(h * 0.2, 130, 220));
  if (!portrait) {
    const puck = height - 2 * PAD;
    const card = Math.round(height * 0.58);
    const room = (plateW: number): number => w - 2 * GUTTER - 2 * puck - plateW - 3 * GAP;
    const wide = height / 160;
    if (room(PLATE_WIDE_W * wide) >= card * CARD_RATIO * 2) {
      return { height, arrangement: "row", plate: "wide", unit: wide, puck, card };
    }
    const tall = Math.min(wide, (height - 2 * PAD) / PLATE_TALL_H);
    if (room(PLATE_TALL_W * tall) >= card * CARD_RATIO * 1.6) {
      return { height, arrangement: "row", plate: "tall", unit: tall, puck, card };
    }
  }
  const trayH = Math.round(height * 0.3);
  const bottom = height - trayH - 3 * PAD;
  const unit = Math.min(portrait ? clamp(w / 520, 0.7, 1) : height / 160, bottom / PLATE_TALL_H);
  const puck = Math.floor(Math.min(bottom, (w - 2 * GUTTER - 2 * STACKED_GAP - PLATE_TALL_W * unit) / 2));
  return { height, arrangement: "stacked", plate: "tall", unit, puck, card: trayH - 4 };
}

const SPEAKER = `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="dk-mute-cone" d="M4 9h4l5-4v14l-5-4H4z"/><path class="dk-mute-waves" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/><path class="dk-mute-x" d="M16.5 9.5l5 5m0-5l-5 5"/></svg>`;

interface Plate {
  readonly el: HTMLElement;
  sync(): void;
  dispose(): void;
}

/** The engraved DEMO plate (a metal <egb-plate>) and its three controls. `changed` runs after a control moves. */
function createPlate(sim: SimLink, sound: Sound, changed: () => void): Plate {
  const plate = document.createElement("egb-plate");
  plate.className = "dk-plate";
  plate.setAttribute("variant", "metal");
  const grid = el("div", "dk-plate-grid");
  const name = el("div", "dk-plate-name");
  name.append(el("span", "dk-plate-demo", "Demo"));

  const mute = el("button", "dk-mute");
  mute.type = "button";
  mute.innerHTML = SPEAKER;

  const power = el("div", "dk-power");
  const toggle = el("button", "dk-toggle");
  toggle.type = "button";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-label", "Cut power");
  toggle.append(el("span", "dk-toggle-nut"), el("span", "dk-toggle-bat"));
  const powerText = el("span", "dk-power-text");
  const pilot = el("span", "dk-pilot");
  pilot.setAttribute("aria-hidden", "true");
  powerText.append(el("span", "dk-label", "Cut power"), pilot);
  power.append(toggle, powerText);

  const opponent = el("div", "dk-opponent");
  const slide = el("button", "dk-slide");
  slide.type = "button";
  slide.setAttribute("role", "switch");
  slide.setAttribute("aria-label", "Hot seat (off: versus the bot)");
  slide.append(el("span", "dk-slide-knob"));
  const bot = el("span", "dk-label dk-opp-bot", "VS bot");
  const hot = el("span", "dk-label dk-opp-hot", "Hot seat");
  const opponentText = el("span", "dk-opponent-text");
  opponentText.append(bot, hot);
  opponent.append(slide, opponentText);

  grid.append(name, mute, power, opponent);
  plate.append(grid);

  function sync(): void {
    const on = sim.power();
    toggle.setAttribute("aria-checked", String(!on));
    plate.classList.toggle("dk-cut", !on);
    const hotseat = sim.opponent() === "hotseat";
    slide.setAttribute("aria-checked", String(hotseat));
    plate.classList.toggle("dk-hotseat", hotseat);
    mute.setAttribute("aria-pressed", String(sound.muted));
    mute.setAttribute("aria-label", sound.muted ? "Sound off" : "Sound on");
  }

  const onToggle = (): void => {
    sim.setPower(!sim.power());
    changed();
  };
  const onSlide = (): void => {
    sim.setOpponent(sim.opponent() === "bot" ? "hotseat" : "bot");
    changed();
  };
  const pick = (choice: Opponent) => (): void => {
    sim.setOpponent(choice);
    changed();
  };
  const onBot = pick("bot");
  const onHot = pick("hotseat");
  const onMute = (): void => {
    sound.setMuted(!sound.muted);
    changed();
    sound.play("tap");
  };
  toggle.addEventListener("click", onToggle);
  slide.addEventListener("click", onSlide);
  bot.addEventListener("click", onBot);
  hot.addEventListener("click", onHot);
  mute.addEventListener("click", onMute);

  return {
    el: plate,
    sync,
    dispose() {
      toggle.removeEventListener("click", onToggle);
      slide.removeEventListener("click", onSlide);
      bot.removeEventListener("click", onBot);
      hot.removeEventListener("click", onHot);
      mute.removeEventListener("click", onMute);
    },
  };
}

export function mountDesk(host: HTMLElement, sim: SimLink, sound: Sound): Desk {
  const root = el("div", "dk");
  root.setAttribute("aria-label", "Demo desk");
  const bench = el("div", "dk-bench");
  bench.setAttribute("aria-hidden", "true");
  const rail = el("div", "dk-rail");
  rail.setAttribute("aria-hidden", "true");
  const grid = el("div", "dk-grid");
  const pucks: readonly [Puck, Puck] = [createPuck(0, sim), createPuck(1, sim)];
  const tray = createBadgeTray(sim, pucks);
  const plate = createPlate(sim, sound, () => switches());
  pucks[0].el.classList.add("dk-p1");
  pucks[1].el.classList.add("dk-p2");
  grid.append(pucks[0].el, tray.el, plate.el, pucks[1].el);
  root.append(bench, rail, grid);
  host.append(root);

  /** The plate's switches and the BOT plate, from the sim (the switches change it without an event). */
  function switches(): void {
    plate.sync();
    pucks[1].setBot(sim.opponent() === "bot");
  }

  function draw(state: BoxState, event: BoxEvent): void {
    pucks[0].show(state.stations[0]);
    pucks[1].show(state.stations[1]);
    tray.update(state);
    switches();
    if (event.type === "buzz") pucks[event.seat].buzz();
    if (event.type === "tap") {
      if (event.accepted) pucks[event.seat].flash();
      else pucks[event.seat].refuse();
    }
  }

  draw(sim.state(), { type: "init" });
  const unsubscribe = sim.subscribe(draw);

  function height(viewW: number, viewH: number): number {
    const layout = deskLayout(viewW, viewH);
    root.dataset.arrange = layout.arrangement;
    root.dataset.plate = layout.plate;
    root.style.setProperty("--desk-h", `${layout.height}px`);
    root.style.setProperty("--u", String(layout.unit));
    root.style.setProperty("--puck", `${layout.puck}px`);
    root.style.setProperty("--tray-h", `${layout.card}px`);
    for (const puck of pucks) puck.size(layout.puck);
    tray.size(layout.card);
    return layout.height;
  }

  height(window.innerWidth, window.innerHeight);

  return {
    el: root,
    height,
    dispose() {
      unsubscribe();
      plate.dispose();
      tray.dispose();
      for (const puck of pucks) puck.dispose();
      root.remove();
    },
  };
}
