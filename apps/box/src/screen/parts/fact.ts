// <egb-fact icon="players|clock|coin|shield">: a fact about the focused game as a data tag. A small chamfered frame
// at idle brightness round a line icon and a word ("2 PLAYERS", "1 MIN", "5–25 EGB"; the element's text).
//
// Size: its height is the box's (44 px by default); its width follows the word. `rez(delayMs)`: after the delay the
// tag rezzes in (Home rezzes each fact in turn when the focused game changes).
import { chamferClip, fitFrame } from "./frame.ts";
import { pick, shadow, sheet } from "./part.ts";
import { rez } from "../shell/rez.ts";

export type FactIcon = "players" | "clock" | "coin" | "shield";

const ICONS: Record<FactIcon, string> = {
  players: `<circle cx="9" cy="8" r="3.2"/><path d="M3 19.5c0-3.4 2.7-5.8 6-5.8s6 2.4 6 5.8"/><circle cx="16.6" cy="9" r="2.6"/><path d="M15.6 13.7c3 .3 5.3 2.4 5.3 5.8"/>`,
  clock: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.2 2.2"/>`,
  coin: `<circle cx="12" cy="12" r="8.5"/><path d="M12 6.8 15.4 12 12 17.2 8.6 12Z"/>`,
  shield: `<path d="M12 3.2 19 6v5.6c0 4.4-3 7.7-7 9.2-4-1.5-7-4.8-7-9.2V6Z"/><path d="m9 12 2.2 2.2L15.4 10"/>`,
};

const CHAMFER = 8;

const styles = sheet(`
:host { display: inline-flex; vertical-align: top; height: 44px; }
.tag { position: relative; display: flex; align-items: center; gap: 10px; height: 100%; padding: 0 16px 0 13px; }
.frame-fill { position: absolute; inset: 0; background: var(--glass); clip-path: ${chamferClip(CHAMFER)}; }
.frame-line { opacity: 0.3; }
.frame-bloom { opacity: 0; }
.icon { position: relative; width: 18px; height: 18px; flex: none; }
.icon svg { display: block; width: 100%; height: 100%; fill: none; stroke: var(--sys); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.word { position: relative; font: 600 17px / 1 var(--hud-body); letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; color: var(--fg-2); }
`);

export class EgbFact extends HTMLElement {
  static readonly observedAttributes = ["icon"];
  readonly #icon: HTMLElement;

  constructor() {
    super();
    const root = shadow(this, styles, `<div class="tag"><i class="frame-fill"></i><span class="icon"></span><span class="word"><slot></slot></span></div>`);
    this.#icon = pick(root, ".icon");
    fitFrame(pick(root, ".tag"), { chamfer: CHAMFER });
  }

  attributeChangedCallback(_name: string, _old: string | null, value: string | null): void {
    const icon = ICONS[value as FactIcon] as string | undefined;
    this.#icon.innerHTML = icon ? `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>` : "";
  }

  /** After `delayMs`, the tag rezzes in. Hidden until then. */
  rez(delayMs: number): void {
    void rez(this, { delay: delayMs });
  }
}
