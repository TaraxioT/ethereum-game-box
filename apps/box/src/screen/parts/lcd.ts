// <egb-lcd>: a log of light: a chamfered panel of glass holding lines of mono text in the system's light, the newest at
// its foot, bright and glowing, the older ones dimmer above it; the oldest scroll off under a dark band at its top.
// The agent's words while a game builds, the Designer's status and captions. A new line steps the others up and fades
// in. Lines wrap.
//
// Size: it fills its box; `font-size` sets the text. Attribute: `caret` (a block cursor blinking after the last
// line: the machine is working). API: `push(text, mark?)` adds a line (`bad` in the alert red, `ok` hot white),
// `set(lines)` replaces them all without moving, `clear()`.
import { chamferClip, fitFrame } from "./frame.ts";
import { motion, pick, shadow, sheet } from "./part.ts";

/** Lines kept; more than ever fit, so the oldest leave under the top band rather than vanish. */
const KEEP = 24;
const CHAMFER = 12;

export type LcdMark = "bad" | "ok";

const styles = sheet(`
:host { display: block; position: relative; width: 380px; height: 120px; font-size: 16px; }
.box { position: absolute; inset: 0; }
.frame-fill { position: absolute; inset: 0; background: var(--glass); clip-path: ${chamferClip(CHAMFER)}; }
.frame-line { opacity: 0.45; }
.frame-bloom { opacity: 0; }
.glass {
  position: absolute; inset: 8px 10px; overflow: hidden; padding: .3em .5em;
  display: flex; flex-direction: column; justify-content: flex-end;
}
/* The lines step up as one block: it keeps its layer, so a new line doesn't make the Pi's GPU raster the screen
   round the log as the step starts and ends. */
.lines { display: flex; flex-direction: column; gap: .3em; font: 600 1em / 1.3 var(--mono); color: var(--sys); overflow-wrap: anywhere; will-change: transform; }
.line { opacity: .45; }
.line:last-of-type { opacity: 1; color: var(--fg); text-shadow: 0 0 2px rgb(255 255 255 / 0.6), 0 0 8px var(--sys-bloom); }
.line.bad { color: var(--alert); opacity: 1; text-shadow: 0 0 8px rgb(255 45 61 / 0.4); }
.line.ok { color: var(--sys-hot); opacity: 1; text-shadow: var(--glow-text); }
/* The cursor: a block of light after the last line, blinking by opacity alone on a layer of its own. */
.caret { display: none; width: .6em; height: 1.05em; margin-top: .2em; background: var(--sys-hot); box-shadow: 0 0 6px var(--sys-bloom); will-change: opacity; }
:host([caret]) .caret { display: block; animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
/* Old lines go under a dark band along the top. */
.shade { position: absolute; inset: 0 0 auto; height: 1.6em; background: linear-gradient(180deg, rgb(3 10 18), transparent); pointer-events: none; }
`);

export class EgbLcd extends HTMLElement {
  readonly #lines: HTMLElement;

  constructor() {
    super();
    const root = shadow(
      this,
      styles,
      `<div class="box"><i class="frame-fill"></i></div><div class="glass" role="log" aria-live="polite"><div class="lines"></div><i class="caret"></i><i class="shade"></i></div>`,
    );
    this.#lines = pick(root, ".lines");
    fitFrame(pick(root, ".box"), { chamfer: CHAMFER, ticks: true });
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
