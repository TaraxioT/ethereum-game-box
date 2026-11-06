// The parts bundle (/parts.js): the Box's parts a built game's screen may use by tag (builder/forge/reference/parts.md),
// defined as the module loads, before the game's screen.js runs. Their look comes from /parts.css (the tokens and the
// faces), which frame.html links. Games written for these tags before the Box wore the Grid keep working: a `metal`
// key draws as a ghost one (key.ts), and `<egb-plate>` is a panel, lit unless it is `metal`.
import { EgbFact } from "../parts/fact.ts";
import { EgbKey } from "../parts/key.ts";
import { EgbPanel } from "../parts/panel.ts";
import { EgbSeg } from "../parts/seg.ts";

/** <egb-plate>: a panel of light, `lit` unless its `variant` is `metal` (`brass`, the default, is lit). */
class EgbPlate extends EgbPanel {
  static readonly observedAttributes = ["variant"];

  connectedCallback(): void {
    this.attributeChangedCallback();
  }

  attributeChangedCallback(): void {
    this.toggleAttribute("lit", this.getAttribute("variant") !== "metal");
  }
}

const FRAME_PARTS: readonly (readonly [string, CustomElementConstructor])[] = [
  ["egb-seg", EgbSeg],
  ["egb-plate", EgbPlate],
  ["egb-key", EgbKey],
  ["egb-fact", EgbFact],
];

for (const [name, part] of FRAME_PARTS) if (!customElements.get(name)) customElements.define(name, part);
