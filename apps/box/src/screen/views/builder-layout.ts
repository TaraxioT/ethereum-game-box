// Where the game builder's pieces stand, in stage pixels. The Designer is a page round the dimmed core: the question
// and its keys on the left, the brief on the right, the status log under the core, the answer bar along the bottom.
// The Build screen stands on the whole lit Grid: the words on the left, the brief on the right, the core in the middle
// taking packets, and the four compile checks where the rack's programs stand, each on the trace that feeds its slot
// into the core.
import type { Layout, Rect } from "../shell/layout.ts";

export interface DesignerLayout {
  /** The step's name and the question. */
  readonly question: Rect;
  /** The step's keys (at most four). */
  readonly keys: Rect;
  /** The brief so far, as panels of light. */
  readonly brief: Rect;
  /** The status log: thinking, what was heard, refusals. */
  readonly status: Rect;
  /** HOME, BACK, the typed answer and SEND, push-to-talk. */
  readonly bar: Rect;
}

export interface BuildLayout {
  /** What is being built: the kicker, the title, the step at work, the elapsed time. */
  readonly head: Rect;
  /** The agent's words. */
  readonly lcd: Rect;
  /** The result's keys. */
  readonly keys: Rect;
  /** The brief it was built from. */
  readonly brief: Rect | null;
}

const DESIGNER_LANDSCAPE: DesignerLayout = {
  question: { x: 48, y: 156, w: 420, h: 156 },
  keys: { x: 48, y: 322, w: 420, h: 280 },
  brief: { x: 812, y: 150, w: 420, h: 456 },
  status: { x: 484, y: 494, w: 312, h: 108 },
  bar: { x: 48, y: 640, w: 1184, h: 80 },
};

const DESIGNER_PORTRAIT: DesignerLayout = {
  question: { x: 32, y: 548, w: 656, h: 100 },
  keys: { x: 32, y: 656, w: 656, h: 136 },
  brief: { x: 16, y: 950, w: 688, h: 118 },
  status: { x: 32, y: 802, w: 656, h: 60 },
  bar: { x: 16, y: 872, w: 688, h: 66 },
};

const BUILD_LANDSCAPE: BuildLayout = {
  head: { x: 48, y: 150, w: 410, h: 150 },
  lcd: { x: 48, y: 308, w: 410, h: 196 },
  keys: { x: 48, y: 514, w: 410, h: 60 },
  brief: { x: 822, y: 150, w: 410, h: 410 },
};

const BUILD_PORTRAIT: BuildLayout = {
  head: { x: 32, y: 556, w: 656, h: 110 },
  lcd: { x: 32, y: 672, w: 656, h: 112 },
  keys: { x: 110, y: 792, w: 500, h: 60 },
  brief: null,
};

export const designerLayout = (layout: Layout): DesignerLayout => (layout.orientation === "portrait" ? DESIGNER_PORTRAIT : DESIGNER_LANDSCAPE);

export const buildLayout = (layout: Layout): BuildLayout => (layout.orientation === "portrait" ? BUILD_PORTRAIT : BUILD_LANDSCAPE);

/** A compile check stands in a rack slot, its top a little under the slot's top, where the slot's trace ends. */
export function compileSlot(slot: Rect): Rect {
  const h = Math.round(slot.h * 0.62);
  return { x: slot.x, y: slot.y + 28, w: slot.w, h };
}
