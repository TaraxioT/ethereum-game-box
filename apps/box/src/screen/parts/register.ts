// Defines every part once.
import { EgbCart } from "./cart.ts";
import { EgbClock } from "./clock.ts";
import { EgbCore } from "./core.ts";
import { EgbFact } from "./fact.ts";
import { EgbGauge } from "./gauge.ts";
import { EgbKey } from "./key.ts";
import { EgbPanel } from "./panel.ts";
import { EgbPort } from "./port.ts";
import { EgbTxbar } from "./txbar.ts";

const PARTS: readonly (readonly [string, CustomElementConstructor])[] = [
  ["egb-panel", EgbPanel],
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
    "egb-panel": EgbPanel;
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
