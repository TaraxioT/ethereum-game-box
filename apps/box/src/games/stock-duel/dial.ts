// The stat wheel at the top of the tray: a dark disc of four graphite quarters (PRICE, AVG PRICE, 24H MOVE,
// LIQUIDITY in roll order, clockwise from the top left), each named beside the wheel, and a white pointer round a hub.
// Until both cards are down the wheel rests with a "?" on its hub and a line saying how the stat is picked. Then the
// rest of the room dims, a halo pulses round the wheel and the pointer whips round five turns, each quarter flashing as
// it passes; under the wheel both badges' rolls scramble and lock in one after the other. The pointer crawls the last
// stretch, creeps into the next quarter, hangs there, and slips back onto the stat; its quarter lights white, its name
// is underlined, a ring bursts off the wheel and the wheel jolts. The spin clicks like a slot reel at every 30° the
// pointer passes, and lands with a boom and a bell.
import type { Point } from "../../screen/shell/layout.ts";
import type { Sound } from "../../screen/views/view.ts";
import type { StatKey } from "./types.ts";
import { calm, el } from "../../screen/shell/dom.ts";
import { DIAL_MS } from "./rules.ts";
import { STAT_LABEL, STATS } from "./deck.ts";

/** The spin ends a little before the dial phase does, so the lit quarter holds a beat before the flip. */
const SPIN_MS = DIAL_MS - 600;
const TURNS = 5;
/** The near miss: the pointer creeps this far past the stat's middle (into the next quarter, 45° on), hangs, and
 * slips back. */
const NEAR_MISS = 54;
/** Where each roll locks in, as a share of the spin. */
const LOCK_AT: readonly [number, number] = [0.32, 0.58];
/** How often a scrambling roll changes its digits. */
const SCRAMBLE_MS = 50;
/** The gap round each quarter, and between the wheel and the names beside it. */
const GAP = 6;
const LABEL_GAP = 16;
const HINT_W = 392;

export interface Dial {
  readonly el: HTMLElement;
  /** The pointer spins and settles on `stat`, picked by `rolls` (each badge's). `elapsedMs` is how far into the spin
   * the screen joins. Resolves on landing. */
  spin(stat: StatKey, elapsedMs: number, rolls: readonly [number, number]): Promise<void>;
  /** Awake, with the pointer already on `stat` and its quarter lit; the rolls give way to the cards. */
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
  // The two rolls in their seats' colours; once the pointer lands, the sum mod 4 that picked the stat.
  const rollBox = el("p", "sd-wheel-rolls");
  const rollEls = [el("span", "sd-roll s0"), el("span", "sd-roll s1")] as const;
  const sum = el("b", "sd-roll-sum");
  rollBox.append(rollEls[0], el("i", "", "+"), rollEls[1], sum);
  box(rollBox, radius - HINT_W / 2, size + 16, HINT_W, 44);
  const halo = el("i", "sd-wheel-halo");
  const burst = el("i", "sd-wheel-burst");
  box(halo, -14, -14, size + 28, size + 28);
  box(burst, 0, 0, size, size);
  root.append(halo, burst, disc, ...quarters.values(), pointer, hub, ...labels.values(), hint, rollBox);

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
  /** The quarter under the pointer flashes as it passes. */
  function pass(at: number | null): void {
    const index = at === null ? -1 : Math.floor((((at + 90) % 360) + 360) % 360 / 90);
    STATS.forEach((stat, i) => quarters.get(stat)?.classList.toggle("pass", i === index));
  }
  /** Each roll as eight hex digits, locked or still scrambling; the sum once the stat is known. */
  function writeRolls(rolls: readonly [number, number], locked: readonly [boolean, boolean], stat: StatKey | null): void {
    rollEls.forEach((node, seat) => {
      const value = locked[seat] ? (rolls[seat] ?? 0) : Math.floor(Math.random() * 0x1_0000_0000);
      node.textContent = `P${seat + 1} ${value.toString(16).toUpperCase().padStart(8, "0")}`;
      node.classList.toggle("locked", locked[seat]);
    });
    sum.textContent = stat ? "MOD 4" : "";
    root.classList.add("rolls");
  }
  function clearRolls(): void {
    root.classList.remove("rolls");
  }
  function land(): void {
    if (calm()) return;
    burst.animate([{ transform: "scale(1)", opacity: 0.9 }, { transform: "scale(1.9)", opacity: 0 }], { duration: 620, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" });
    root.animate(
      [{ transform: "none" }, { transform: "translate(-5px, 3px)" }, { transform: "translate(4px, -3px)" }, { transform: "translate(-2px, 1px)" }, { transform: "none" }],
      { duration: 320, easing: "ease-out" },
    );
  }
  let clicking = 0;
  function stop(): void {
    spinning?.cancel();
    spinning = null;
    cancelAnimationFrame(clicking);
    root.classList.remove("spinning");
    pass(null);
  }

  /** The pointer's angle as drawn now, from its computed transform. */
  function drawnAngle(): number | null {
    const m = /matrix\(([^,]+),\s*([^,]+)/.exec(getComputedStyle(pointer).transform);
    return m ? (Math.atan2(Number(m[2]), Number(m[1])) * 180) / Math.PI : null;
  }

  /** Clicks for every CLICK_DEG the pointer turns while `run` plays, flashes the quarter it is over, and scrambles the
   * rolls until each locks in. */
  function clicks(run: Animation, rolls: readonly [number, number]): void {
    let prev = drawnAngle();
    let travelled = 0;
    let scrambled = -Infinity;
    const locked: [boolean, boolean] = [false, false];
    const frame = (): void => {
      if (spinning !== run) return;
      const share = Number(run.currentTime ?? 0) / SPIN_MS;
      let lockedNow = false;
      LOCK_AT.forEach((at, seat) => {
        if (locked[seat] || share < at) return;
        locked[seat] = true;
        lockedNow = true;
        sound.play("count", { pitch: seat === 0 ? 0.4 : 0.8 });
      });
      const t = performance.now();
      if (lockedNow || t - scrambled >= SCRAMBLE_MS) {
        scrambled = t;
        writeRolls(rolls, locked, null);
      }
      const now = drawnAngle();
      pass(now);
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
    spin(stat, elapsedMs, rolls) {
      stop();
      wake(true);
      light(null);
      const target = angleOf(stat);
      if (calm() || elapsedMs >= SPIN_MS) {
        setAngle(target);
        light(stat);
        writeRolls(rolls, [true, true], stat);
        if (elapsedMs < SPIN_MS) sound.play("land");
        return Promise.resolve();
      }
      let to = target;
      while (to < angle + 360 * TURNS) to += 360;
      // Five fast turns, a crawl into the next quarter, a hang there, and a slip back onto the stat.
      const run = pointer.animate(
        [
          { transform: `rotate(${angle}deg)`, easing: "cubic-bezier(0.3, 0.75, 0.45, 1)" },
          { transform: `rotate(${to - 20}deg)`, offset: 0.66, easing: "cubic-bezier(0.25, 0.1, 0.4, 1)" },
          { transform: `rotate(${to + NEAR_MISS}deg)`, offset: 0.84 },
          { transform: `rotate(${to + NEAR_MISS}deg)`, offset: 0.9, easing: "cubic-bezier(0.6, 0, 0.3, 1.4)" },
          { transform: `rotate(${to}deg)` },
        ],
        { duration: SPIN_MS },
      );
      run.currentTime = Math.max(0, elapsedMs);
      spinning = run;
      root.classList.add("spinning");
      setAngle(target);
      clicks(run, rolls);
      return run.finished.then(
        () => {
          spinning = null;
          root.classList.remove("spinning");
          pass(null);
          light(stat);
          writeRolls(rolls, [true, true], stat);
          land();
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
      clearRolls();
    },
    rest() {
      stop();
      wake(false);
      light(null);
      clearRolls();
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
