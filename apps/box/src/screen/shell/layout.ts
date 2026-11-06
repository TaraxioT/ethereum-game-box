// Where every object of the Box stands, in stage pixels. The stage is a fixed-size surface (1280×800 landscape,
// 720×1080 portrait) scaled to fit the window; the board, the parts and the views all place themselves from these
// anchors, so the traces always land on the parts they feed.

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
  /** The core: the centre of the glass and its radius; the collar's outer radius. */
  readonly core: { readonly centre: Point; readonly glass: number; readonly collar: number };
  /** Each port's module (ring, blockie, name, LCD) and the ring's centre, where its trace starts. */
  readonly ports: readonly [PortAnchor, PortAnchor];
  /** The hanging block LCD and the gas gauge beside it. */
  readonly clock: Rect;
  readonly gauge: { readonly centre: Point; readonly radius: number };
  /** The focused game's title, its fact chips and Play. */
  readonly title: Rect;
  readonly facts: Rect;
  readonly play: Rect;
  /** Four cartridge housings along the bottom, in rack order. */
  readonly rack: readonly Rect[];
  /** The transaction-progress LCD strip. */
  readonly txbar: Rect;
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
  core: { centre: { x: 640, y: 318 }, glass: 132, collar: 166 },
  ports: [
    { module: { x: 40, y: 28, w: 380, h: 96 }, ring: { x: 92, y: 76 }, side: "left" },
    { module: { x: 860, y: 28, w: 380, h: 96 }, ring: { x: 1188, y: 76 }, side: "right" },
  ],
  clock: { x: 478, y: 30, w: 276, h: 64 },
  gauge: { centre: { x: 806, y: 62 }, radius: 40 },
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
};

export const PORTRAIT: Layout = {
  orientation: "portrait",
  width: 720,
  height: 1080,
  core: { centre: { x: 360, y: 400 }, glass: 116, collar: 146 },
  ports: [
    { module: { x: 20, y: 24, w: 300, h: 84 }, ring: { x: 64, y: 66 }, side: "left" },
    { module: { x: 400, y: 24, w: 300, h: 84 }, ring: { x: 656, y: 66 }, side: "right" },
  ],
  clock: { x: 200, y: 146, w: 236, h: 56 },
  gauge: { centre: { x: 482, y: 174 }, radius: 34 },
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
};

export function layoutFor(orientation: Orientation): Layout {
  return orientation === "portrait" ? PORTRAIT : LANDSCAPE;
}

/** Portrait when the space is clearly taller than wide. */
export function orientationFor(width: number, height: number): Orientation {
  return width / height < 0.9 ? "portrait" : "landscape";
}
