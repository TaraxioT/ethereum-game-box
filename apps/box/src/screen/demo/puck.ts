// One drawn tap station: a dark bevelled puck with a seat-colour NFC ring round its OLED. A click or touch taps with
// the seat's badge; the buzz motor is a short shake (a double one for "no"); a read flashes the ring.
import type { SimControl } from "../link/sim/control.ts";
import type { Seat, StationView } from "../link/types.ts";
import { calm, el } from "../shell/dom.ts";
import { createOled } from "./oled.ts";

export interface Puck {
  readonly el: HTMLElement;
  readonly seat: Seat;
  show(view: StationView): void;
  /** The buzz motor: one short shake. */
  buzz(): void;
  /** An unaccepted tap: two quick shakes. */
  refuse(): void;
  /** A badge was read: the ring flashes. */
  flash(): void;
  /** The bot holds this seat: a BOT plate, and clicks do nothing. */
  setBot(bot: boolean): void;
  /** Whether a viewport point lies on the puck (a badge dropped there taps it). */
  hits(x: number, y: number): boolean;
  /** A badge hovers over the puck, ready to drop. */
  arm(on: boolean): void;
  /** The puck's diameter in CSS px. */
  size(diameter: number): void;
  dispose(): void;
}

const SHAKE: Keyframe[] = [
  { transform: "translateX(0)" },
  { transform: "translateX(-3px) rotate(-1.2deg)" },
  { transform: "translateX(3px) rotate(1.2deg)" },
  { transform: "translateX(-2px) rotate(-0.6deg)" },
  { transform: "translateX(2px) rotate(0.6deg)" },
  { transform: "translateX(0)" },
];

const NO: Keyframe[] = [
  ...SHAKE.map((frame, i) => ({ ...frame, offset: (i / (SHAKE.length - 1)) * 0.4 })),
  { transform: "translateX(0)", offset: 0.55 },
  ...SHAKE.map((frame, i) => ({ ...frame, offset: 0.55 + (i / (SHAKE.length - 1)) * 0.45 })),
];

const FLASH: Keyframe[] = [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }];

/** The ring's outer diameter and the OLED's fit inside it, as parts of the puck's diameter. */
const RING = 0.78;
const OLED_IN_RING = 0.88;

export function createPuck(seat: Seat, sim: Pick<SimControl, "tap">): Puck {
  const root = el("button", "dk-puck");
  root.type = "button";
  root.dataset.seat = String(seat);
  root.setAttribute("aria-label", `Player ${seat + 1} tap station`);
  const shaker = el("div", "dk-puck-shake");
  const body = el("div", "dk-puck-body");
  const groove = el("div", "dk-ring-groove");
  const ring = el("div", "dk-ring");
  const glow = el("div", "dk-ring-flash");
  const oled = createOled();
  const label = el("span", "dk-puck-seat", `P${seat + 1}`);
  const key = el("span", "dk-puck-key", seat === 0 ? "A" : "L");
  const bot = el("span", "dk-puck-bot", "BOT");
  bot.hidden = true;
  body.append(groove, ring, glow, oled.el, label, key, bot);
  shaker.append(body);
  root.append(shaker);

  let isBot = false;
  let shake: Animation | null = null;
  let refusing: ReturnType<typeof setTimeout> | undefined;

  const onClick = (): void => {
    if (!isBot) sim.tap(seat);
  };
  root.addEventListener("click", onClick);

  function motor(frames: Keyframe[], duration: number): void {
    flash();
    if (calm()) return;
    shake?.cancel();
    shake = shaker.animate(frames, { duration, easing: "linear" });
  }

  function flash(): void {
    glow.animate(FLASH, { duration: calm() ? 200 : 420, easing: "ease-out" });
  }

  return {
    el: root,
    seat,
    show: oled.show,
    buzz() {
      // A refusal already shook for this moment; a buzz arriving with it is the same motor.
      if (refusing === undefined) motor(SHAKE, 220);
    },
    refuse() {
      clearTimeout(refusing);
      refusing = setTimeout(() => (refusing = undefined), 520);
      motor(NO, 520);
    },
    flash,
    setBot(on) {
      isBot = on;
      bot.hidden = !on;
      key.hidden = on;
      root.classList.toggle("dk-puck-held", on);
      root.setAttribute("aria-disabled", String(on));
      root.setAttribute("aria-label", on ? `Player ${seat + 1} tap station, played by the bot` : `Player ${seat + 1} tap station`);
    },
    hits(x, y) {
      if (isBot) return false;
      const r = root.getBoundingClientRect();
      const radius = r.width / 2;
      return Math.hypot(x - (r.left + radius), y - (r.top + radius)) <= radius * 1.1;
    },
    arm(on) {
      root.classList.toggle("dk-puck-armed", on);
    },
    size(diameter) {
      root.style.setProperty("--d", `${diameter}px`);
      root.style.setProperty("--ring", `${Math.round(diameter * RING)}px`);
      oled.size(Math.floor((diameter * RING - 6) * OLED_IN_RING));
    },
    dispose() {
      clearTimeout(refusing);
      shake?.cancel();
      root.removeEventListener("click", onClick);
    },
  };
}
