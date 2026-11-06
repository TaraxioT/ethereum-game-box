// Where a page's pieces stand round the core (Join, Stake, Result, Refund, the lobby): a seat panel on each player's
// side, a plate under the core, and a row of keys at the bottom. The core stays in the middle: money moves port → core
// → port. On the wide stage (the Pi's 16:9 screen) the landscape places move `inset` right with the core, so the
// panels stand evenly either side of it, clear of the lease tag.
import { shiftRect, type Layout, type Rect } from "../shell/layout.ts";

export interface PageLayout {
  readonly seats: readonly [Rect, Rect];
  readonly plate: Rect;
  readonly keys: Rect;
  /** How far right this page's 1280-wide places moved (`layout.inset`): for a page's own extra places. */
  readonly dx: number;
}

const LANDSCAPE: PageLayout = {
  seats: [
    { x: 64, y: 180, w: 340, h: 330 },
    { x: 876, y: 180, w: 340, h: 330 },
  ],
  plate: { x: 360, y: 500, w: 560, h: 120 },
  keys: { x: 340, y: 652, w: 600, h: 76 },
  dx: 0,
};

const PORTRAIT: PageLayout = {
  seats: [
    { x: 24, y: 560, w: 324, h: 250 },
    { x: 372, y: 560, w: 324, h: 250 },
  ],
  plate: { x: 40, y: 828, w: 640, h: 110 },
  keys: { x: 60, y: 960, w: 600, h: 76 },
  dx: 0,
};

export function pageLayout(layout: Layout): PageLayout {
  if (layout.orientation === "portrait") return PORTRAIT;
  const dx = layout.inset;
  return {
    seats: [shiftRect(LANDSCAPE.seats[0], dx), shiftRect(LANDSCAPE.seats[1], dx)],
    plate: shiftRect(LANDSCAPE.plate, dx),
    keys: shiftRect(LANDSCAPE.keys, dx),
    dx,
  };
}
