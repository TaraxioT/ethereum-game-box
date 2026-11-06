// Where every object of the Box stands, in stage pixels. The stage is a fixed-size surface (1280×800 landscape,
// 1422×800 wide for a 16:9 screen such as the Pi's 1280×720, 720×1080 portrait) scaled to fit the window; the Grid, the parts and the views all place themselves from these
// anchors, so the traces always land on the parts they feed.
import { sideOf, type Seat } from "@egb/sdk";

export type Orientation = "landscape" | "portrait";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Layout {
  readonly orientation: Orientation;
  readonly width: number;
  readonly height: number;
  /** How far right the 1280-wide landscape design stands on this stage: 0, or `WIDE_INSET` on the wide stage. Games
   *  designed at 1280×800 shift their places by it and draw their backdrops across the whole width. */
  readonly inset: number;
  /** The core: the centre of the glass and its radius; the collar's outer radius. */
  readonly core: { readonly centre: Point; readonly glass: number; readonly collar: number };
  /** The Grid's horizon: the back wall stands above it, the floor runs toward the viewer below it. */
  readonly horizon: number;
  /** Each port's module (ring, blockie, name, LCD) and the ring's centre, where its trace starts. */
  readonly ports: readonly [PortAnchor, PortAnchor];
  /** The block readout and the gas bar beside it. */
  readonly clock: Rect;
  readonly gas: Rect;
  /** The focused game's title, its fact chips and Play. */
  readonly title: Rect;
  readonly facts: Rect;
  readonly play: Rect;
  /** Four cartridge housings along the bottom, in rack order. */
  readonly rack: readonly Rect[];
  /** The transaction strip. */
  readonly txbar: Rect;
  /** Home's and Attract's board of champions and championships, right of the core; none in portrait. */
  readonly board: Rect | null;
}

export interface PortAnchor {
  readonly module: Rect;
  readonly ring: Point;
  /** Which way the module reads from its ring: left port reads rightwards, right port leftwards. */
  readonly side: "left" | "right";
}

export const LANDSCAPE: Layout = {
  orientation: "landscape",
  width: 1280,
  height: 800,
  inset: 0,
  core: { centre: { x: 640, y: 318 }, glass: 132, collar: 166 },
  horizon: 540,
  ports: [
    { module: { x: 40, y: 28, w: 380, h: 96 }, ring: { x: 92, y: 76 }, side: "left" },
    { module: { x: 860, y: 28, w: 380, h: 96 }, ring: { x: 1188, y: 76 }, side: "right" },
  ],
  clock: { x: 478, y: 30, w: 276, h: 64 },
  gas: { x: 764, y: 40, w: 88, h: 48 },
  title: { x: 60, y: 186, w: 400, h: 80 },
  facts: { x: 60, y: 272, w: 400, h: 44 },
  play: { x: 60, y: 340, w: 200, h: 72 },
  rack: [
    { x: 236, y: 580, w: 176, h: 186 },
    { x: 436, y: 580, w: 176, h: 186 },
    { x: 668, y: 580, w: 176, h: 186 },
    { x: 868, y: 580, w: 176, h: 186 },
  ],
  txbar: { x: 452, y: 102, w: 376, h: 46 },
  board: { x: 836, y: 176, w: 404, h: 352 },
};

export const PORTRAIT: Layout = {
  orientation: "portrait",
  width: 720,
  height: 1080,
  inset: 0,
  core: { centre: { x: 360, y: 400 }, glass: 116, collar: 146 },
  horizon: 840,
  ports: [
    { module: { x: 20, y: 24, w: 300, h: 84 }, ring: { x: 64, y: 66 }, side: "left" },
    { module: { x: 400, y: 24, w: 300, h: 84 }, ring: { x: 656, y: 66 }, side: "right" },
  ],
  clock: { x: 200, y: 146, w: 236, h: 56 },
  gas: { x: 448, y: 150, w: 88, h: 48 },
  title: { x: 40, y: 590, w: 640, h: 72 },
  facts: { x: 40, y: 668, w: 640, h: 44 },
  play: { x: 260, y: 728, w: 200, h: 68 },
  rack: [
    { x: 16, y: 862, w: 160, h: 172 },
    { x: 190, y: 862, w: 160, h: 172 },
    { x: 370, y: 862, w: 160, h: 172 },
    { x: 544, y: 862, w: 160, h: 172 },
  ],
  txbar: { x: 170, y: 208, w: 380, h: 40 },
  board: null,
};

/** `r` moved `dx` to the right. */
export const shiftRect = (r: Rect, dx: number): Rect => ({ ...r, x: r.x + dx });
export const shiftPoint = (p: Point, dx: number): Point => ({ ...p, x: p.x + dx });
const shiftPort = (p: PortAnchor, dx: number): PortAnchor => ({ ...p, module: shiftRect(p.module, dx), ring: shiftPoint(p.ring, dx) });

/** The wide stage's extra width on each side: 1422×800 is 16:9, so it fills a 1280×720 screen at 0.9. */
export const WIDE_INSET = 71;

/** The landscape layout on the wide stage: every anchor `WIDE_INSET` further right, the Grid across the whole width. */
export const WIDE: Layout = {
  ...LANDSCAPE,
  width: LANDSCAPE.width + 2 * WIDE_INSET,
  inset: WIDE_INSET,
  core: { ...LANDSCAPE.core, centre: shiftPoint(LANDSCAPE.core.centre, WIDE_INSET) },
  ports: [shiftPort(LANDSCAPE.ports[0], WIDE_INSET), shiftPort(LANDSCAPE.ports[1], WIDE_INSET)],
  clock: shiftRect(LANDSCAPE.clock, WIDE_INSET),
  gas: shiftRect(LANDSCAPE.gas, WIDE_INSET),
  title: shiftRect(LANDSCAPE.title, WIDE_INSET),
  facts: shiftRect(LANDSCAPE.facts, WIDE_INSET),
  play: shiftRect(LANDSCAPE.play, WIDE_INSET),
  rack: LANDSCAPE.rack.map((r) => shiftRect(r, WIDE_INSET)),
  txbar: shiftRect(LANDSCAPE.txbar, WIDE_INSET),
  board: LANDSCAPE.board && shiftRect(LANDSCAPE.board, WIDE_INSET),
};

/**
 * Each port's box for `seats` seats on show. Two stand as the layout has them. With more, each corner's box holds two at
 * half height, Player 3 under Player 1 and Player 4 under Player 2, and a port scales itself to fit.
 */
export function portBoxes(layout: Layout, seats: number): readonly Rect[] {
  const [left, right] = layout.ports.map((port) => port.module) as [Rect, Rect];
  if (seats <= 2) return [left, right];
  const half = (r: Rect, row: 0 | 1): Rect => ({ ...r, y: r.y + (row * r.h) / 2, h: r.h / 2 });
  return [half(left, 0), half(right, 0), half(left, 1), half(right, 1)].slice(0, seats);
}

/** In a game, a touch below the overlay (stage px) taps a seat. */
export const OVERLAY_FOOT = { landscape: 130, portrait: 150 } as const;

/** The seat a touch below the overlay taps, with `seats` on show: the half it lands in, or with more than two, the quarter. */
export function seatAt(layout: Layout, seats: number, x: number, y: number): Seat {
  const side = sideOf(x < layout.width / 2 ? 0 : 1);
  const middle = (OVERLAY_FOOT[layout.orientation] + layout.height) / 2;
  return y >= middle && side + 2 < seats ? ((side + 2) as Seat) : side;
}

export function layoutFor(orientation: Orientation): Layout {
  return orientation === "portrait" ? PORTRAIT : LANDSCAPE;
}

/** A window this wide or wider (16:9 is 1.78, 16:10 is 1.6) gets the wide stage. */
const WIDE_ASPECT = 1.7;

/** The layout that best fills a `width` × `height` window. */
export function layoutForArea(width: number, height: number): Layout {
  const orientation = orientationFor(width, height);
  if (orientation === "portrait") return PORTRAIT;
  return width / height >= WIDE_ASPECT ? WIDE : LANDSCAPE;
}

/** Portrait when the space is clearly taller than wide. */
export function orientationFor(width: number, height: number): Orientation {
  return width / height < 0.9 ? "portrait" : "landscape";
}
