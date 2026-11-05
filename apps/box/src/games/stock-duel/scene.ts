// The study behind the game, painted once: a dark wood-panelled room, a walnut desk with a leather blotter, a warm
// brass lamp on Player 1's side pooling amber light over that half of the desk, and a cyan-glass lamp on Player 2's.
// Layered gradients give the paint and paper texture. A lamp brightens on its player's moments (a play, a won round)
// by fading in a brighter copy of its light: opacity only.
import type { Point, Rect } from "../../screen/shell/layout.ts";
import type { Seat } from "../seat.ts";
import { el, place, play } from "../../screen/shell/dom.ts";

export interface Pool {
  readonly centre: Point;
  readonly rx: number;
  readonly ry: number;
}

export interface ScenePlaces {
  readonly width: number;
  readonly height: number;
  /** The desk's top edge. */
  readonly desk: number;
  readonly blotter: Rect;
  /** Each lamp's shade, by its centre. */
  readonly lamps: readonly [Point, Point];
  /** Where each lamp's light pools. */
  readonly pools: readonly [Pool, Pool];
}

export interface Scene {
  readonly el: HTMLElement;
  /** The seat's lamp flares up and settles back; `holdMs` is how long it stays bright. */
  flare(seat: Seat, holdMs: number): void;
  /** Keeps one lamp bright (the match's winner), or none. */
  hold(seat: Seat | null): void;
}

const PANEL_W = 160;
const SHADE_W = 150;
const SHADE_H = 58;

export function createScene(at: ScenePlaces): Scene {
  const root = el("div", "sd-scene");
  place(root, { x: 0, y: 0, w: at.width, h: at.height });

  const wall = el("div", "sd-wall");
  place(wall, { x: 0, y: 0, w: at.width, h: at.desk });
  const columns = Math.max(1, Math.round(at.width / PANEL_W));
  const pw = at.width / columns;
  for (let i = 0; i < columns; i++) {
    const panel = el("i", "sd-panel");
    place(panel, { x: i * pw + 14, y: 22, w: pw - 28, h: at.desk - 96 });
    wall.append(panel);
  }
  const rail = el("i", "sd-rail");
  place(rail, { x: 0, y: at.desk - 52, w: at.width, h: 22 });
  wall.append(rail);

  const desk = el("div", "sd-desk");
  place(desk, { x: 0, y: at.desk, w: at.width, h: at.height - at.desk });
  const blotter = el("i", "sd-blotter");
  place(blotter, { ...at.blotter, y: at.blotter.y - at.desk });
  desk.append(blotter);

  const lights = [light(0, at), light(1, at)] as const;
  const lamps = [lamp(0, at.lamps[0], at.width), lamp(1, at.lamps[1], at.width)] as const;
  const vignette = el("i", "sd-vignette");
  place(vignette, { x: 0, y: 0, w: at.width, h: at.height });

  root.append(wall, desk, ...lights.map((l) => l.steady), ...lights.map((l) => l.bright), ...lamps.map((l) => l.el), vignette);

  let held: Seat | null = null;

  return {
    el: root,
    flare(seat, holdMs) {
      if (held === seat) return;
      const total = 260 + holdMs + 900;
      const targets = [lights[seat].bright, lamps[seat].bulb];
      for (const target of targets) {
        void play(
          target,
          [
            { opacity: 0 },
            { opacity: 1, offset: 260 / total },
            { opacity: 1, offset: (260 + holdMs) / total },
            { opacity: 0 },
          ],
          { duration: total, easing: "ease-out" },
        );
      }
    },
    hold(seat) {
      held = seat;
      for (const s of [0, 1] as const) {
        lights[s].bright.classList.toggle("held", s === seat);
        lamps[s].bulb.classList.toggle("held", s === seat);
      }
    },
  };
}

/** A lamp's light on the room: its cone and pool, steady, and a brighter copy that fades in for its moments. */
function light(seat: Seat, at: ScenePlaces): { steady: HTMLElement; bright: HTMLElement } {
  const steady = el("div", `sd-light s${seat}`);
  const bright = el("div", `sd-light bright s${seat}`);
  for (const layer of [steady, bright]) {
    place(layer, { x: 0, y: 0, w: at.width, h: at.height });
    layer.append(cone(at.lamps[seat], at.pools[seat]), pool(at.pools[seat]));
  }
  return { steady, bright };
}

/** The light falling from a shade to its pool: a soft trapezoid, narrow at the shade and wide on the desk. */
function cone(from: Point, to: Pool): HTMLElement {
  const top = from.y + SHADE_H / 2 - 6;
  const bottom = to.centre.y;
  const topHalf = SHADE_W / 2 - 14;
  const bottomHalf = to.rx * 0.78;
  const left = Math.min(from.x - topHalf, to.centre.x - bottomHalf);
  const right = Math.max(from.x + topHalf, to.centre.x + bottomHalf);
  const w = right - left;
  const node = el("i", "sd-cone");
  place(node, { x: left, y: top, w, h: bottom - top });
  const pct = (x: number): string => `${(((x - left) / w) * 100).toFixed(2)}%`;
  node.style.clipPath = `polygon(${pct(from.x - topHalf)} 0, ${pct(from.x + topHalf)} 0, ${pct(to.centre.x + bottomHalf)} 100%, ${pct(to.centre.x - bottomHalf)} 100%)`;
  return node;
}

function pool(p: Pool): HTMLElement {
  const node = el("i", "sd-pool");
  place(node, { x: p.centre.x - p.rx, y: p.centre.y - p.ry, w: p.rx * 2, h: p.ry * 2 });
  return node;
}

/** A lamp on its arm from the side wall: the shade, the bulb's glow under its rim, and a brighter glow for flares. */
function lamp(seat: Seat, shade: Point, width: number): { el: HTMLElement; bulb: HTMLElement } {
  const node = el("div", `sd-lamp s${seat}`);
  place(node, { x: shade.x - SHADE_W / 2, y: shade.y - SHADE_H / 2, w: SHADE_W, h: SHADE_H });
  const arm = el("i", "sd-lamp-arm");
  // The arm runs from the shade's crown to the near side wall.
  const reach = seat === 0 ? shade.x + 10 : width - shade.x + 10;
  arm.style.width = `${reach}px`;
  arm.style[seat === 0 ? "right" : "left"] = `${SHADE_W / 2}px`;
  const bulb = el("i", "sd-lamp-bulb");
  node.append(arm, el("i", "sd-lamp-glow"), bulb, el("i", "sd-lamp-shade"), el("i", "sd-lamp-cap"));
  return { el: node, bulb };
}
