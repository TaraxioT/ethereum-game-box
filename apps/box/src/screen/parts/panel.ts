// <egb-panel>: a panel of light: a chamfered frame at 45 % with a hot tick on each uncut corner, round a nearly
// opaque dark fill (plain alpha, no backdrop blur). The page plates, the in-game stake chip, the Demo intro.
//
// Size: it fits its content; `font-size` sets its text and everything round it. Its children are the content, so a
// panel can carry more than words. A caller can set `--frame-tone` (Refund's red) and `--panel-line` (the line's
// opacity) on it.
import { chamferClip, fitFrame } from "./frame.ts";
import { pick, shadow, sheet } from "./part.ts";

const CHAMFER = 12;

const styles = sheet(`
:host {
  display: inline-block; position: relative; vertical-align: top; font-size: 16px; padding: 0.6em 1.6em;
  font-family: var(--hud-body); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; line-height: 1.3;
  color: var(--fg-2);
}
.box { position: absolute; inset: 0; pointer-events: none; }
.frame-fill { position: absolute; inset: 0; background: rgb(1 4 9 / 0.88); clip-path: ${chamferClip(CHAMFER)}; }
.frame-line { opacity: var(--panel-line, 0.45); }
.frame-bloom { opacity: 0; }
.content { position: relative; display: block; }
`);

export class EgbPanel extends HTMLElement {
  constructor() {
    super();
    const root = shadow(this, styles, `<div class="box"><i class="frame-fill"></i></div><span class="content"><slot></slot></span>`);
    fitFrame(pick(root, ".box"), { chamfer: CHAMFER, ticks: true });
  }
}
