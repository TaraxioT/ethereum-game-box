// The stage: a fixed-size surface in layout pixels, scaled and centred to fit the space it is given. Everything on
// the Box's screen is placed in stage pixels; only this module knows the window's size.
import type { Layout } from "./layout.ts";

export interface Fit {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

/** The largest scale at which the stage fits the area, centred in it. */
export function fit(layout: Layout, areaW: number, areaH: number): Fit {
  const scale = Math.min(areaW / layout.width, areaH / layout.height);
  return { scale, x: (areaW - layout.width * scale) / 2, y: (areaH - layout.height * scale) / 2 };
}

export function createStage(layout: Layout): HTMLElement {
  const el = document.createElement("div");
  el.className = "stage";
  el.dataset.orientation = layout.orientation;
  el.style.width = `${layout.width}px`;
  el.style.height = `${layout.height}px`;
  return el;
}

export function applyFit(stage: HTMLElement, f: Fit): void {
  stage.style.transform = `translate(${f.x}px, ${f.y}px) scale(${f.scale})`;
}
