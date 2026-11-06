// The parts bundle (/parts.js): the Box's parts a built game's screen may use by tag (builder/forge/reference/parts.md),
// defined as the module loads, before the game's screen.js runs. Their look comes from /parts.css (the tokens and the
// three faces), which frame.html links.
import { EgbFact } from "../parts/fact.ts";
import { EgbKey } from "../parts/key.ts";
import { EgbPlate } from "../parts/plate.ts";
import { EgbSeg } from "../parts/seg.ts";

const FRAME_PARTS: readonly (readonly [string, CustomElementConstructor])[] = [
  ["egb-seg", EgbSeg],
  ["egb-plate", EgbPlate],
  ["egb-key", EgbKey],
  ["egb-fact", EgbFact],
];

for (const [name, part] of FRAME_PARTS) if (!customElements.get(name)) customElements.define(name, part);
