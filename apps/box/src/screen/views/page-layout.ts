// Where a page's pieces stand round the core (Join, Stake, Result, Refund): a seat panel on each player's side, a
// plate under the core, and a row of keys at the bottom. The core stays in the middle: money moves port → core → port.
import type { Layout, Rect } from "../shell/layout.ts";

export interface PageLayout {
  readonly seats: readonly [Rect, Rect];
  readonly plate: Rect;
  readonly keys: Rect;
}

const LANDSCAPE: PageLayout = {
  seats: [
    { x: 64, y: 180, w: 340, h: 330 },
    { x: 876, y: 180, w: 340, h: 330 },
  ],
  plate: { x: 360, y: 500, w: 560, h: 120 },
  keys: { x: 340, y: 652, w: 600, h: 76 },
};

const PORTRAIT: PageLayout = {
  seats: [
    { x: 24, y: 560, w: 324, h: 250 },
    { x: 372, y: 560, w: 324, h: 250 },
  ],
  plate: { x: 40, y: 828, w: 640, h: 110 },
  keys: { x: 60, y: 960, w: 600, h: 76 },
};

export function pageLayout(layout: Layout): PageLayout {
  return layout.orientation === "portrait" ? PORTRAIT : LANDSCAPE;
}
