// Defines every part once. The seven-segment display comes first: the port and the clock build theirs as they are
// constructed.
import { EgbCart } from "./cart.ts";
import { EgbClock } from "./clock.ts";
import { EgbCore } from "./core.ts";
import { EgbFact } from "./fact.ts";
import { EgbGauge } from "./gauge.ts";
import { EgbKey } from "./key.ts";
import { EgbPlate } from "./plate.ts";
import { EgbPort } from "./port.ts";
import { EgbSeg } from "./seg.ts";
import { EgbTxbar } from "./txbar.ts";

const PARTS: readonly (readonly [string, CustomElementConstructor])[] = [
  ["egb-seg", EgbSeg],
  ["egb-plate", EgbPlate],
  ["egb-core", EgbCore],
  ["egb-port", EgbPort],
  ["egb-clock", EgbClock],
  ["egb-gauge", EgbGauge],
  ["egb-fact", EgbFact],
  ["egb-key", EgbKey],
  ["egb-cart", EgbCart],
  ["egb-txbar", EgbTxbar],
];

export function registerParts(): void {
  for (const [name, part] of PARTS) if (!customElements.get(name)) customElements.define(name, part);
}

declare global {
  interface HTMLElementTagNameMap {
    "egb-seg": EgbSeg;
    "egb-plate": EgbPlate;
    "egb-core": EgbCore;
    "egb-port": EgbPort;
    "egb-clock": EgbClock;
    "egb-gauge": EgbGauge;
    "egb-fact": EgbFact;
    "egb-key": EgbKey;
    "egb-cart": EgbCart;
    "egb-txbar": EgbTxbar;
  }
}
