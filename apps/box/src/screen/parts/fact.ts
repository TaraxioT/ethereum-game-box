// <egb-fact icon="players|clock|coin|shield">: a fact about the focused game, as an IC chip package standing on the
// board. A dark epoxy body with silver pins along its top and bottom and a pin-1 dot, a line icon and a word printed on
// it in silkscreen ("2 PLAYERS", "1 MIN", "5–25 EGB"; the element's text).
//
// Size: its height is the box's (44 px by default, pins included); its width follows the word; `font-size` sets the
// print. `press(delayMs)`: after the delay the chip presses into the board and settles (Home presses each fact in
// turn when the focused game changes).
import { motion, pick, shadow, sheet } from "./part.ts";

export type FactIcon = "players" | "clock" | "coin" | "shield";

const ICONS: Record<FactIcon, string> = {
  players: `<circle cx="9" cy="8" r="3.2"/><path d="M3 19.5c0-3.4 2.7-5.8 6-5.8s6 2.4 6 5.8"/><circle cx="16.6" cy="9" r="2.6"/><path d="M15.6 13.7c3 .3 5.3 2.4 5.3 5.8"/>`,
  clock: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.2 2.2"/>`,
  coin: `<circle cx="12" cy="12" r="8.5"/><path d="M12 6.8 15.4 12 12 17.2 8.6 12Z"/>`,
  shield: `<path d="M12 3.2 19 6v5.6c0 4.4-3 7.7-7 9.2-4-1.5-7-4.8-7-9.2V6Z"/><path d="m9 12 2.2 2.2L15.4 10"/>`,
};

const PIN = 6;

const styles = sheet(`
:host { display: inline-flex; vertical-align: top; height: 44px; font-size: 15px; }
.chip { position: relative; display: flex; height: 100%; padding: ${PIN - 1}px 0; }
/* The pins: silver leads along the top and bottom, each lit along its left side, under the body's edge. */
.pins {
  position: absolute; left: .55em; right: .55em; height: ${PIN + 2}px;
  background: repeating-linear-gradient(90deg, transparent 0 .22em, #77738f .22em .28em, #ece8f8 .28em .36em, #a29eb8 .36em .46em, #5c5872 .46em .52em, transparent .52em .78em);
}
.pins.top { top: 0; border-radius: 1px 1px 0 0; }
.pins.bottom { bottom: 0; }
.pins.bottom::after { content: ""; position: absolute; inset: auto 0 0 0; height: 2px; background: rgb(4 2 10 / 0.5); }
/* The body: matte black epoxy, its top face lit from the top left. */
.body {
  position: relative; display: flex; align-items: center; gap: .45em; padding: 0 .85em 0 .75em; border-radius: 4px;
  background: radial-gradient(120% 140% at 20% 0%, #2f2940, transparent 60%), linear-gradient(180deg, #221d30, #15111f 60%, #0f0c17);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.14), inset 0 -2px 0 rgb(0 0 0 / 0.55), 0 0 0 1px #05030a, 0 4px 8px rgb(3 1 10 / 0.5);
}
/* Pin 1: a small dimple moulded into the corner. */
.dot { position: absolute; left: .32em; top: .3em; width: .32em; height: .32em; border-radius: 50%; background: #08060e; box-shadow: inset 0 1px 1px rgb(0 0 0 / 0.8), 0 1px 0 rgb(255 255 255 / 0.12); }
.icon { width: 1.2em; height: 1.2em; flex: none; color: #ddd6f2; }
.icon svg { display: block; width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.word { font: 600 max(14px, .94em) / 1 var(--display); letter-spacing: .02em; text-transform: uppercase; white-space: nowrap; color: #ece7fa; }
`);

export class EgbFact extends HTMLElement {
  static readonly observedAttributes = ["icon"];
  readonly #chip: HTMLElement;
  readonly #icon: HTMLElement;

  constructor() {
    super();
    const root = shadow(
      this,
      styles,
      `<div class="chip"><i class="pins top"></i><i class="pins bottom"></i>
        <div class="body"><i class="dot"></i><span class="icon"></span><span class="word"><slot></slot></span></div></div>`,
    );
    this.#chip = pick(root, ".chip");
    this.#icon = pick(root, ".icon");
  }

  attributeChangedCallback(_name: string, _old: string | null, value: string | null): void {
    const icon = ICONS[value as FactIcon] as string | undefined;
    this.#icon.innerHTML = icon ? `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>` : "";
  }

  /** After `delayMs`, the chip comes down, presses into the board and settles. Hidden until then. */
  press(delayMs: number): void {
    motion(
      this.#chip,
      [
        { opacity: 0, transform: "translateY(-8px) scale(1.06)" },
        { opacity: 1, transform: "translateY(2px) scale(0.97)", offset: 0.55 },
        { opacity: 1, transform: "none" },
      ],
      { duration: 360, delay: delayMs, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "backwards" },
    );
  }
}
