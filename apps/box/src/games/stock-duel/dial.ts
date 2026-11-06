// The stat wheel at the top of the tray: a dark disc of four graphite quarters (PRICE, AVG PRICE, 24H MOVE,
// LIQUIDITY in roll order, clockwise from the top left), each named beside the wheel, and a white pointer round a hub.
// Until both cards are down the wheel rests with a "?" on its hub and a line saying how the stat is picked. Then the
// pointer spins a few turns and settles on the chosen stat; its quarter lights white and its name is underlined. The
// spin clicks like a slot reel at every 30° the pointer passes, and lands with a boom and a bell.
import type { Point } from "../../screen/shell/layout.ts";
import type { Sound } from "../../screen/views/view.ts";
import type { StatKey } from "./types.ts";
import { calm, el } from "../../screen/shell/dom.ts";
import { DIAL_MS } from "./rules.ts";
import { STAT_LABEL, STATS } from "./deck.ts";

/** The spin ends a little before the dial phase does, so the lit quarter holds a beat before the flip. */
const SPIN_MS = DIAL_MS - 500;
const TURNS = 3;
/** The pointer swings this far past the stat before it settles back on it. */
const OVERSHOOT = 7;
/** The gap round each quarter, and between the wheel and the names beside it. */
const GAP = 6;
const LABEL_GAP = 16;
const HINT_W = 392;

export interface Dial {
  readonly el: HTMLElement;
  /** The pointer spins and settles on `stat`. `elapsedMs` is how far into the spin the screen joins. Resolves on landing. */
  spin(stat: StatKey, elapsedMs: number): Promise<void>;
  /** Awake, with the pointer already on `stat` and its quarter lit. */
  show(stat: StatKey): void;
  /** At rest: no quarter lit, the "?" on the hub and the hint showing. The pointer stays where it stopped. */
  rest(): void;
  dispose(): void;
}

/** The pointer's angle for a stat: the middle of its quarter, clockwise from the top. */
function angleOf(stat: StatKey): number {
  return -45 + 90 * STATS.indexOf(stat);
}

/** Each quarter's corner of the wheel, in roll order: top left, top right, bottom right, bottom left. */
const CORNERS = [
  { x: 0, y: 0, round: "100% 8% 8% 8%" },
  { x: 1, y: 0, round: "8% 100% 8% 8%" },
  { x: 1, y: 1, round: "8% 8% 100% 8%" },
  { x: 0, y: 1, round: "8% 8% 8% 100%" },
] as const;

/** A reel click each time the pointer turns this far. */
const CLICK_DEG = 30;

export function createDial(centre: Point, radius: number, sound: Sound): Dial {
  const size = radius * 2;
  const root = el("div", "sd-wheel");
  root.style.left = `${centre.x - radius}px`;
  root.style.top = `${centre.y - radius}px`;
  root.style.width = `${size}px`;
  root.style.height = `${size}px`;

  const disc = el("i", "sd-wheel-disc");
  box(disc, 0, 0, size, size);
  // Each quarter fills its corner of the disc inside the gap, with a narrower seam between neighbours.
  const quarter = radius - GAP - 2;
  const quarters = new Map<StatKey, HTMLElement>();
  const labels = new Map<StatKey, HTMLElement>();
  STATS.forEach((stat, i) => {
    const corner = CORNERS[i] ?? CORNERS[0];
    const q = el("i", "sd-q");
    box(q, corner.x === 0 ? GAP : size - GAP - quarter, corner.y === 0 ? GAP : size - GAP - quarter, quarter, quarter);
    q.style.borderRadius = corner.round;
    q.style.transformOrigin = `${corner.x === 0 ? "100%" : "0"} ${corner.y === 0 ? "100%" : "0"}`;
    quarters.set(stat, q);
    // The names stand beside the wheel: the upper pair level with its top, the lower pair below its middle.
    const label = el("span", `sd-wheel-label ${corner.x === 0 ? "l" : "r"}`, STAT_LABEL[stat]);
    label.dataset.text = STAT_LABEL[stat];
    if (corner.x === 0) label.style.right = `${size + LABEL_GAP}px`;
    else label.style.left = `${size + LABEL_GAP}px`;
    label.style.top = `${corner.y === 0 ? radius * 0.24 : radius * 1.46}px`;
    labels.set(stat, label);
  });
  const pointer = el("i", "sd-wheel-pointer");
  pointer.style.left = `${radius}px`;
  pointer.style.top = `${radius}px`;
  pointer.style.setProperty("--tip", `${-Math.round(radius * 0.9)}px`);
  const hub = el("i", "sd-wheel-hub");
  const hubR = Math.round(radius * 0.31);
  box(hub, radius - hubR, radius - hubR, hubR * 2, hubR * 2);
  const hint = el("p", "sd-wheel-hint");
  hint.append("The stat is picked by both badges' rolls,", el("br"), "once both cards are down.");
  box(hint, radius - HINT_W / 2, size + 16, HINT_W, 44);
  root.append(disc, ...quarters.values(), pointer, hub, ...labels.values(), hint);

  let angle = 0;
  let spinning: Animation | null = null;

  function setAngle(deg: number): void {
    angle = ((deg % 360) + 360) % 360;
    pointer.style.transform = `rotate(${angle}deg)`;
  }
  function light(stat: StatKey | null): void {
    for (const [key, q] of quarters) q.classList.toggle("lit", key === stat);
    for (const [key, label] of labels) label.classList.toggle("lit", key === stat);
  }
  function wake(on: boolean): void {
    root.classList.toggle("awake", on);
  }
  let clicking = 0;
  function stop(): void {
    spinning?.cancel();
    spinning = null;
    cancelAnimationFrame(clicking);
  }

  /** The pointer's angle as drawn now, from its computed transform. */
  function drawnAngle(): number | null {
    const m = /matrix\(([^,]+),\s*([^,]+)/.exec(getComputedStyle(pointer).transform);
    return m ? (Math.atan2(Number(m[2]), Number(m[1])) * 180) / Math.PI : null;
  }

  /** Clicks for every CLICK_DEG the pointer turns while `run` plays. */
  function clicks(run: Animation): void {
    let prev = drawnAngle();
    let travelled = 0;
    const frame = (): void => {
      if (spinning !== run) return;
      const now = drawnAngle();
      if (now !== null && prev !== null) {
        // The shortest way round from the last frame's angle: a frame turns the pointer far less than half a turn.
        travelled += Math.abs(((now - prev + 540) % 360) - 180);
        if (travelled >= CLICK_DEG) {
          travelled %= CLICK_DEG;
          sound.play("reel");
        }
      }
      prev = now;
      clicking = requestAnimationFrame(frame);
    };
    clicking = requestAnimationFrame(frame);
  }
  setAngle(angle);

  return {
    el: root,
    spin(stat, elapsedMs) {
      stop();
      wake(true);
      light(null);
      const target = angleOf(stat);
      if (calm() || elapsedMs >= SPIN_MS) {
        setAngle(target);
        light(stat);
        if (elapsedMs < SPIN_MS) sound.play("land");
        return Promise.resolve();
      }
      let to = target;
      while (to < angle + 360 * TURNS) to += 360;
      const run = pointer.animate(
        [
          { transform: `rotate(${angle}deg)`, easing: "cubic-bezier(0.18, 0.55, 0.3, 1)" },
          { transform: `rotate(${to + OVERSHOOT}deg)`, offset: 0.84, easing: "cubic-bezier(0.45, 0, 0.35, 1)" },
          { transform: `rotate(${to}deg)` },
        ],
        { duration: SPIN_MS },
      );
      run.currentTime = Math.max(0, elapsedMs);
      spinning = run;
      setAngle(target);
      clicks(run);
      return run.finished.then(
        () => {
          spinning = null;
          light(stat);
          sound.play("land");
        },
        () => undefined,
      );
    },
    show(stat) {
      stop();
      wake(true);
      setAngle(angleOf(stat));
      light(stat);
    },
    rest() {
      stop();
      wake(false);
      light(null);
    },
    dispose() {
      stop();
    },
  };
}

function box(node: HTMLElement, x: number, y: number, w: number, h: number): void {
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  node.style.width = `${w}px`;
  node.style.height = `${h}px`;
}
