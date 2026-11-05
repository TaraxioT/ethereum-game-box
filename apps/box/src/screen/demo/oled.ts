// A tap station's OLED: a real 128×64 one-bit canvas (yellow top band, blue-white body, black glass) drawn from a
// `StationView` and scaled up with hard pixel edges.
import type { StationView } from "../link/types.ts";
import { BAND_ROWS, OLED_H, OLED_W, stationPixels } from "./oled-font.ts";

export interface Oled {
  readonly el: HTMLElement;
  show(view: StationView): void;
  /** Sets the panel's on-screen width (CSS px) as near `fitWidth` as keeps its pixels whole. */
  size(fitWidth: number): void;
}

/** Packed RGBA (little-endian ABGR) for ImageData's 32-bit view. */
function rgba(r: number, g: number, b: number): number {
  return (0xff << 24) | (b << 16) | (g << 8) | r;
}

const BAND = rgba(0xff, 0xd8, 0x4a);
const BODY = rgba(0xc4, 0xe8, 0xff);
const DARK = rgba(0x02, 0x03, 0x06);

/**
 * The panel's CSS width: a whole number of device pixels per panel pixel where there's room for two or more;
 * otherwise the fit itself (pixels at least one device pixel wide, a few one wider than the rest).
 */
export function panelWidth(fitWidth: number, dpr: number): { readonly width: number; readonly crisp: boolean } {
  const perPixel = (fitWidth * dpr) / OLED_W;
  if (perPixel >= 2) return { width: (Math.floor(perPixel) * OLED_W) / dpr, crisp: true };
  return { width: fitWidth, crisp: perPixel >= 1 };
}

export function createOled(): Oled {
  const el = document.createElement("div");
  el.className = "dk-oled";
  const canvas = document.createElement("canvas");
  canvas.width = OLED_W;
  canvas.height = OLED_H;
  el.append(canvas);
  const ctx = canvas.getContext("2d");
  const image = ctx?.createImageData(OLED_W, OLED_H);
  const words = image ? new Uint32Array(image.data.buffer) : null;
  let shown = "";

  function show(view: StationView): void {
    const key = `${view.top}\n${view.big}\n${view.bottom}`;
    if (key === shown || !ctx || !image || !words) return;
    shown = key;
    words.fill(DARK);
    for (const [x, y] of stationPixels(view)) words[y * OLED_W + x] = y < BAND_ROWS ? BAND : BODY;
    ctx.putImageData(image, 0, 0);
    el.setAttribute("aria-label", [view.top, view.big, view.bottom].filter(Boolean).join(" · "));
  }

  function size(fitWidth: number): void {
    const { width, crisp } = panelWidth(fitWidth, window.devicePixelRatio || 1);
    el.style.setProperty("--oled-w", `${width}px`);
    // Below one device pixel per panel pixel a hard downscale drops whole rows of type; a soft one keeps it legible.
    el.classList.toggle("dk-oled-soft", !crisp);
  }

  el.setAttribute("role", "img");
  return { el, show, size };
}
