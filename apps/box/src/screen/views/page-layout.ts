// Where a page's pieces stand round the core (Join, Stake, Result, Refund): a seat panel on each player's side, a
// plate under the core, and a row of keys at the bottom. The core stays in the middle: money moves port → core → port.
//
// Two panels stand one each side. Three or four stand in a column each side, at a smaller size: a seat stays on its own
// side of the stage (Player 1 and 3 left, Player 2 and 4 right), under its port, and a side with one panel centres it.
// Those pages stand round the core on the wide stage too, where the two-seat pages keep their places.
import { sideOf, type Seated } from "@egb/sdk";
import type { Seat } from "../../core/types.ts";
import { shiftRect, type Layout, type Rect } from "../shell/layout.ts";

export interface PageLayout {
  /** Each seat's panel, in the order the seats were given. */
  readonly seats: Seated<Rect>;
  readonly plate: Rect;
  readonly keys: Rect;
}

/** A page's two-seat places, and where the columns of three or four stand. */
interface PagePlaces extends PageLayout {
  /** The two columns of panels: the left one's `x`, the right one's, and a panel's size. */
  readonly columns: { readonly left: number; readonly right: number; readonly w: number; readonly h: number };
  /** The upper panel's top, and the lower's. */
  readonly rows: readonly [number, number];
}

const LANDSCAPE: PagePlaces = {
  seats: [
    { x: 64, y: 180, w: 340, h: 330 },
    { x: 876, y: 180, w: 340, h: 330 },
  ],
  plate: { x: 360, y: 500, w: 560, h: 120 },
  keys: { x: 340, y: 652, w: 600, h: 76 },
  columns: { left: 48, right: 932, w: 300, h: 248 },
  rows: [134, 390],
};

const PORTRAIT: PagePlaces = {
  seats: [
    { x: 24, y: 560, w: 324, h: 250 },
    { x: 372, y: 560, w: 324, h: 250 },
  ],
  plate: { x: 40, y: 828, w: 640, h: 110 },
  keys: { x: 60, y: 960, w: 600, h: 76 },
  columns: { left: 24, right: 372, w: 324, h: 142 },
  rows: [530, 680],
};

/** Three or four seats in their columns. */
function columns(places: PagePlaces, seats: readonly Seat[]): Rect[] {
  const { columns: { left, right, w, h }, rows } = places;
  return seats.map((seat) => {
    const beside = seats.filter((other) => sideOf(other) === sideOf(seat));
    const x = sideOf(seat) === 0 ? left : right;
    if (beside.length === 1) return { x, y: (rows[0] + rows[1]) / 2, w, h };
    return { x, y: rows[beside.indexOf(seat) as 0 | 1], w, h };
  });
}

/** The page's places, for the `seats` it shows. */
export function pageLayout(layout: Layout, seats: readonly Seat[] = [0, 1]): PageLayout {
  const places = layout.orientation === "portrait" ? PORTRAIT : LANDSCAPE;
  if (seats.length <= 2) return places;
  const onStage = (r: Rect): Rect => shiftRect(r, layout.inset);
  return { seats: columns(places, seats).map(onStage) as unknown as Seated<Rect>, plate: onStage(places.plate), keys: onStage(places.keys) };
}
