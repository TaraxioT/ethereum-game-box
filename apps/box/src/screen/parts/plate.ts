// <egb-plate>: an engraved plate screwed to the Box: DEMO, SOON, the instruction plate. `brass` (the default) or
// `metal`, a screw in each corner, its content engraved (dark letters, the light catching each groove's lower edge).
//
// Size: it fits its content; `font-size` sets the engraving and everything round it. Its children are the content,
// so a plate can carry more than words (a switch, several lines).
import { shadow, sheet } from "./part.ts";

const styles = sheet(`
:host {
  display: inline-block; position: relative; vertical-align: top; font-size: 16px; padding: .6em 1.6em; border-radius: .38em;
  font-family: var(--display); font-weight: 800; letter-spacing: .12em; text-transform: uppercase; line-height: 1.2;
  color: var(--brass-ink); text-shadow: 0 1px 0 rgb(255 242 200 / 0.65), 0 -1px 0 rgb(60 40 0 / 0.4);
  background:
    linear-gradient(180deg, rgb(255 250 225 / 0.26), transparent 38%, transparent 75%, rgb(70 44 0 / 0.14)),
    repeating-linear-gradient(90deg, rgb(255 255 255 / 0.05) 0 1px, transparent 1px 3px, rgb(80 50 0 / 0.05) 3px 4px),
    linear-gradient(170deg, #f1d98f 0%, #d8b866 30%, #c19b4b 70%, #a9843a 100%);
  box-shadow:
    inset 0 1.5px 0 rgb(255 250 220 / 0.75), inset 0 -2px 0 rgb(90 58 6 / 0.55), inset 0 0 0 1px rgb(110 75 15 / 0.45),
    0 0 0 1.5px #2e1f05, 0 3px 0 #5a3f10, 0 8px 14px rgb(3 1 10 / 0.5);
  --screw-hi: #fff8e0; --screw: #cbb27a; --screw-lo: #7c6130; --screw-rim: #4a3810;
}
:host([variant="metal"]) {
  color: #1a1630; text-shadow: 0 1px 0 rgb(255 255 255 / 0.3), 0 -1px 0 rgb(0 0 0 / 0.3);
  background:
    linear-gradient(180deg, rgb(255 255 255 / 0.16), transparent 40%),
    repeating-linear-gradient(90deg, rgb(255 255 255 / 0.04) 0 1px, transparent 1px 3px),
    linear-gradient(170deg, #a29dbd 0%, #7a759e 35%, #5d5880 70%, #4a4568 100%);
  box-shadow:
    inset 0 1.5px 0 rgb(255 255 255 / 0.45), inset 0 -2px 0 rgb(0 0 0 / 0.4), inset 0 0 0 1px rgb(0 0 0 / 0.25),
    0 0 0 1.5px #0b0718, 0 3px 0 #1d1838, 0 8px 14px rgb(3 1 10 / 0.5);
  --screw-hi: #f1eefb; --screw: #aaa5c4; --screw-lo: #5d5878; --screw-rim: #2f2b45;
}
.screw { width: .56em; height: .56em; }
.screw.tl { left: .42em; top: .42em; --turn: 35deg; }
.screw.tr { right: .42em; top: .42em; --turn: -20deg; }
.screw.bl { left: .42em; bottom: .42em; --turn: 80deg; }
.screw.br { right: .42em; bottom: .42em; --turn: 10deg; }
.content { position: relative; display: block; }
`);

export class EgbPlate extends HTMLElement {
  constructor() {
    super();
    shadow(this, styles, `<i class="screw tl"></i><i class="screw tr"></i><i class="screw bl"></i><i class="screw br"></i><span class="content"><slot></slot></span>`);
  }
}
