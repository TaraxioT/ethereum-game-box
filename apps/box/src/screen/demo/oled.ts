// A tap station's OLED: a real 72×40 one-bit canvas (blue-white pixels on black glass) drawn from a `StationView`
// and scaled up with hard pixel edges.
import type { StationView } from "@egb/sdk";
import { faceLines, OLED_H, OLED_W, stationPixels, type Face } from "./oled-font.ts";

export interface Oled {
  readonly el: HTMLElement;
  /** Draws the view's `face` (its idle screen unless a tap is in progress). */
  show(view: StationView, face?: Face): void;
  /** Sets the panel's on-screen width (CSS px) as near `fitWidth` as keeps its pixels even. */
  size(fitWidth: number): void;
}

/** Packed RGBA (little-endian ABGR) for ImageData's 32-bit view. */
function rgba(r: number, g: number, b: number): number {
  return (0xff << 24) | (b << 16) | (g << 8) | r;
}

const LIT = rgba(0xc4, 0xe8, 0xff);
const DARK = rgba(0x02, 0x03, 0x06);

/** Rounding down to whole device pixels may give up at most this much of the room, else the panel fills it. */
const MAX_SHRINK = 0.15;

/**
 * The panel's CSS width: a whole number of device pixels per panel pixel where that costs little of the room;
 * otherwise the fit itself (pixels at least one device pixel wide, a few one wider than the rest).
 */
export function panelWidth(fitWidth: number, dpr: number): { readonly width: number; readonly crisp: boolean } {
  const perPixel = (fitWidth * dpr) / OLED_W;
  const whole = (Math.floor(perPixel) * OLED_W) / dpr;
  if (perPixel >= 1 && whole >= fitWidth * (1 - MAX_SHRINK)) return { width: whole, crisp: true };
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

  function show(view: StationView, face: Face = "idle"): void {
    const key = `${face}\n${JSON.stringify(view)}`;
    if (key === shown || !ctx || !image || !words) return;
    shown = key;
    words.fill(DARK);
    for (const [x, y] of stationPixels(view, face)) words[y * OLED_W + x] = LIT;
    ctx.putImageData(image, 0, 0);
    const { big, small } = faceLines(view, face);
    el.setAttribute("aria-label", [view.tag, big, small].filter(Boolean).join(" · "));
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
