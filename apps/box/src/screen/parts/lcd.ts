// <egb-lcd>: a text LCD in a bevelled gunmetal frame (the clock's and the transaction strip's frame and glass): the
// agent's words while a game builds, the Designer's status and captions. The newest line sits at the foot of the glass;
// a new one slides the others up and fades in, and the oldest scroll off under the bezel. Lines wrap.
//
// Size: it fills its box; `font-size` sets the text. Attributes: `tone` (mint, the default, or amber), `caret` (a
// block cursor blinking after the last line: the machine is working). API: `push(text, mark?)` adds a line (`bad`
// in red, `ok` in bright mint), `set(lines)` replaces them all without moving, `clear()`.
import { motion, pick, shadow, sheet } from "./part.ts";

/** Lines kept on the glass; more than ever fit, so the oldest leave under the bezel rather than vanish. */
const KEEP = 24;

export type LcdMark = "bad" | "ok";

const styles = sheet(`
:host { display: block; position: relative; width: 380px; height: 120px; font-size: 16px; }
.lcd-frame { border-radius: 12px; }
.lcd-glass {
  --lcd-glass: var(--lcd-mint-bg); --ink: var(--lcd-mint); --glow: rgb(143 240 216 / 0.45);
  inset: 7px; border-radius: 7px; padding: .5em .8em;
  display: flex; flex-direction: column; justify-content: flex-end;
}
:host([tone="amber"]) .lcd-glass { --lcd-glass: var(--lcd-amber-bg); --ink: var(--lcd-amber); --glow: rgb(255 181 71 / 0.45); }
.lines { display: flex; flex-direction: column; gap: .3em; font: 600 1em / 1.3 var(--mono); color: var(--ink); overflow-wrap: anywhere; }
.line { opacity: .5; }
.line:last-of-type { opacity: 1; text-shadow: 0 0 6px var(--glow); }
.line.bad { color: var(--lose); opacity: 1; }
.line.ok { color: #d9fff3; opacity: 1; }
/* The cursor: a block after the last line, blinking by opacity alone. */
.caret { display: none; width: .6em; height: 1.05em; margin-top: .2em; background: var(--ink); box-shadow: 0 0 6px var(--glow); }
:host([caret]) .caret { display: block; animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
/* The bezel's shadow falls on the glass's top: old lines go under it. */
.shade { position: absolute; inset: 0 0 auto; height: 1.6em; background: linear-gradient(180deg, var(--lcd-glass), transparent); pointer-events: none; }
`);

export class EgbLcd extends HTMLElement {
  readonly #lines: HTMLElement;

  constructor() {
    super();
    const root = shadow(
      this,
      styles,
      `<div class="lcd-frame"></div><div class="lcd-glass" role="log" aria-live="polite"><div class="lines"></div><i class="caret"></i><i class="shade"></i></div>`,
    );
    this.#lines = pick(root, ".lines");
  }

  push(text: string, mark?: LcdMark): void {
    const line = this.#line(text, mark);
    this.#lines.append(line);
    while (this.#lines.childElementCount > KEEP) this.#lines.firstElementChild?.remove();
    // The lines above step up by the new one's height as it fades in at the foot.
    const rise = line.offsetHeight;
    motion(this.#lines, [{ transform: `translateY(${rise}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    motion(line, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 80, fill: "backwards" });
  }

  set(lines: readonly string[]): void {
    this.#lines.replaceChildren(...lines.slice(-KEEP).map((text) => this.#line(text)));
  }

  clear(): void {
    this.#lines.replaceChildren();
  }

  #line(text: string, mark?: LcdMark): HTMLElement {
    const line = document.createElement("div");
    line.className = mark ? `line ${mark}` : "line";
    line.textContent = text;
    return line;
  }
}
