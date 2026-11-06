// The brass astrolabe dial in the middle of the study. A bevelled brass rim, a band of four engraved stat sectors
// (PRICE, AVG PRICE, 24H MOVE, LIQUIDITY in roll order, clockwise from the top left), a ring of degree ticks and a
// dark enamel plate. The rete, a pierced brass pointer, spins a few turns once both cards are down and settles on
// the chosen stat; then that sector lights. Until both cards are down the dial sits idle and dim.
import type { Point } from "../../screen/shell/layout.ts";
import type { StatKey } from "./types.ts";
import { calm, el } from "../../screen/shell/dom.ts";
import { DIAL_MS } from "./rules.ts";
import { STAT_LABEL, STATS } from "./deck.ts";

/** The spin ends a little before the dial phase does, so the lit sector holds a beat before the flip. */
const SPIN_MS = DIAL_MS - 500;
const TURNS = 3;
/** The rete swings this far past the stat before it settles back on it. */
const OVERSHOOT = 7;

export interface Dial {
  readonly el: HTMLElement;
  /** The rete spins and settles on `stat`. `elapsedMs` is how far into the spin the screen joins. Resolves on landing. */
  spin(stat: StatKey, elapsedMs: number): Promise<void>;
  /** Awake, with the rete already on `stat` and its sector lit. */
  show(stat: StatKey): void;
  /** Idle: dim, no sector lit. The rete stays where it stopped. */
  rest(): void;
  dispose(): void;
}

let instances = 0;

/** The rete's angle for a stat: the middle of its sector, clockwise from the top. */
function angleOf(stat: StatKey): number {
  return -45 + 90 * STATS.indexOf(stat);
}

export function createDial(centre: Point, radius: number): Dial {
  const id = `sd-dial-${++instances}`;
  const size = Math.ceil(radius * 2 + 16);
  const root = el("div", "sd-dial");
  root.style.left = `${centre.x - size / 2}px`;
  root.style.top = `${centre.y - size / 2}px`;
  root.style.width = `${size}px`;
  root.style.height = `${size}px`;

  const face = el("div", "sd-dial-face");
  face.innerHTML = faceSvg(id, size, radius);
  const sectors = new Map<StatKey, Element>();
  for (const stat of STATS) {
    const sector = face.querySelector(`[data-stat="${stat}"]`);
    if (sector) sectors.set(stat, sector);
  }
  const rete = el("div", "sd-dial-rete");
  rete.innerHTML = reteSvg(id, size, radius);
  const boss = el("div", "sd-dial-boss");
  boss.innerHTML = bossSvg(id, size);
  const dim = el("i", "sd-dial-dim");
  root.append(face, rete, boss, dim);

  let angle = -45;
  let spinning: Animation | null = null;

  function setAngle(deg: number): void {
    angle = ((deg % 360) + 360) % 360;
    rete.style.transform = `rotate(${angle}deg)`;
  }
  function light(stat: StatKey | null): void {
    for (const [key, sector] of sectors) sector.classList.toggle("lit", key === stat);
  }
  function wake(on: boolean): void {
    root.classList.toggle("awake", on);
  }
  setAngle(angle);

  return {
    el: root,
    spin(stat, elapsedMs) {
      spinning?.cancel();
      spinning = null;
      wake(true);
      light(null);
      const target = angleOf(stat);
      if (calm() || elapsedMs >= SPIN_MS) {
        setAngle(target);
        light(stat);
        return Promise.resolve();
      }
      let to = target;
      while (to < angle + 360 * TURNS) to += 360;
      const run = rete.animate(
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
      return run.finished.then(
        () => {
          spinning = null;
          light(stat);
        },
        () => undefined,
      );
    },
    show(stat) {
      spinning?.cancel();
      spinning = null;
      wake(true);
      setAngle(angleOf(stat));
      light(stat);
    },
    rest() {
      spinning?.cancel();
      spinning = null;
      wake(false);
      light(null);
    },
    dispose() {
      spinning?.cancel();
    },
  };
}

/** A point on a circle round (c, c), `deg` clockwise from the top. */
function at(c: number, r: number, deg: number): string {
  const a = (deg * Math.PI) / 180;
  return `${(c + r * Math.sin(a)).toFixed(2)} ${(c - r * Math.cos(a)).toFixed(2)}`;
}

/** A ring segment between radii r0 < r1, from angle a to b clockwise. */
function segment(c: number, r0: number, r1: number, a: number, b: number): string {
  return `M${at(c, r1, a)} A${r1} ${r1} 0 0 1 ${at(c, r1, b)} L${at(c, r0, b)} A${r0} ${r0} 0 0 0 ${at(c, r0, a)} Z`;
}

function faceSvg(id: string, size: number, radius: number): string {
  const c = size / 2;
  const R = radius;
  const bandOut = R - 12;
  const bandIn = R - 38;
  const font = R >= 120 ? 15 : 14;
  const ticks: string[] = [];
  for (let deg = 0; deg < 360; deg += 5) {
    const long = deg % 30 === 0;
    ticks.push(`<path d="M${at(c, bandIn, deg)} L${at(c, bandIn - (long ? 10 : 5), deg)}"/>`);
  }
  const sectors: string[] = [];
  const labels: string[] = [];
  STATS.forEach((stat, i) => {
    const mid = -45 + 90 * i;
    sectors.push(`<path class="sd-dial-sector" data-stat="${stat}" d="${segment(c, bandIn, bandOut, mid - 45, mid + 45)}"/>`);
    // Upper labels run clockwise on a path inside the band; lower ones run the other way, so all read upright.
    const upper = Math.abs(((mid + 360) % 360) - 180) > 90;
    const r = upper ? (bandIn + bandOut) / 2 - font * 0.36 : (bandIn + bandOut) / 2 + font * 0.36;
    const path = upper
      ? `M${at(c, r, mid - 44)} A${r} ${r} 0 0 1 ${at(c, r, mid + 44)}`
      : `M${at(c, r, mid + 44)} A${r} ${r} 0 0 0 ${at(c, r, mid - 44)}`;
    labels.push(
      `<path id="${id}-p${i}" d="${path}" fill="none"/>` +
        `<text class="sd-dial-lit" font-size="${font}" dy="0.9"><textPath href="#${id}-p${i}" startOffset="50%">${STAT_LABEL[stat]}</textPath></text>` +
        `<text class="sd-dial-ink" font-size="${font}"><textPath href="#${id}-p${i}" startOffset="50%">${STAT_LABEL[stat]}</textPath></text>`,
    );
  });
  const dividers = [0, 90, 180, 270].map((deg) => `<path d="M${at(c, bandIn, deg)} L${at(c, bandOut, deg)}"/>`).join("");
  const star: string[] = [];
  for (let k = 0; k < 8; k++) {
    const long = k % 2 === 0 ? bandIn - 18 : (bandIn - 18) * 0.55;
    const a = k * 45;
    star.push(`M${at(c, 0, 0)} L${at(c, long * 0.16, a - 22.5)} L${at(c, long, a)} L${at(c, long * 0.16, a + 22.5)} Z`);
  }
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
  <defs>
    <linearGradient id="${id}-rim" x1="0.15" y1="0.05" x2="0.85" y2="0.95">
      <stop offset="0" stop-color="#fbe9b0"/><stop offset="0.35" stop-color="#d6b264"/>
      <stop offset="0.7" stop-color="#9a7430"/><stop offset="1" stop-color="#4f360d"/>
    </linearGradient>
    <linearGradient id="${id}-bevel" x1="0.85" y1="0.95" x2="0.15" y2="0.05">
      <stop offset="0" stop-color="#f2d891"/><stop offset="0.5" stop-color="#a88238"/><stop offset="1" stop-color="#5a3e10"/>
    </linearGradient>
    <radialGradient id="${id}-band" cx="0.38" cy="0.3" r="0.8">
      <stop offset="0" stop-color="#e8cd85"/><stop offset="0.6" stop-color="#bf9a4c"/><stop offset="1" stop-color="#8a6526"/>
    </radialGradient>
    <radialGradient id="${id}-mater" cx="0.4" cy="0.32" r="0.75">
      <stop offset="0" stop-color="#25304a"/><stop offset="0.65" stop-color="#121829"/><stop offset="1" stop-color="#070a12"/>
    </radialGradient>
    <radialGradient id="${id}-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0.6" stop-color="#fff1c4" stop-opacity="0"/><stop offset="0.86" stop-color="#ffe29a" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#ffc25c" stop-opacity="0.95"/>
    </radialGradient>
  </defs>
  <circle cx="${c}" cy="${c + 5}" r="${R}" fill="rgb(5 3 1 / 0.55)"/>
  <circle cx="${c}" cy="${c}" r="${R}" fill="url(#${id}-rim)"/>
  <circle cx="${c}" cy="${c}" r="${R - 5}" fill="url(#${id}-bevel)"/>
  <circle cx="${c}" cy="${c}" r="${bandOut}" fill="url(#${id}-band)" stroke="#3a2808" stroke-width="1.5"/>
  ${sectors.join("")}
  <g class="sd-dial-rule">${dividers}</g>
  <g>${labels.join("")}</g>
  <circle cx="${c}" cy="${c}" r="${bandIn}" fill="url(#${id}-mater)" stroke="#2c1e05" stroke-width="2"/>
  <circle cx="${c}" cy="${c}" r="${bandIn - 1.5}" fill="none" stroke="rgb(255 231 170 / 0.35)" stroke-width="1"/>
  <g class="sd-dial-ticks">${ticks.join("")}</g>
  <g class="sd-dial-engraving">
    <circle cx="${c}" cy="${c}" r="${(bandIn - 18) * 0.72}"/>
    <circle cx="${c}" cy="${c}" r="${(bandIn - 18) * 0.42}"/>
    <path d="${star.join(" ")}"/>
  </g>
  <path d="M${at(c, R - 2, -70)} A${R - 2} ${R - 2} 0 0 1 ${at(c, R - 2, -10)}" fill="none" stroke="rgb(255 248 220 / 0.75)" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;
}

/** The rete, drawn pointing straight up; its wrapper turns it. */
function reteSvg(id: string, size: number, radius: number): string {
  const c = size / 2;
  const tip = radius - 40;
  const tail = radius * 0.34;
  const ringR = tip * 0.42;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
  <defs>
    <linearGradient id="${id}-rete" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff0bd"/><stop offset="0.45" stop-color="#d9b466"/><stop offset="1" stop-color="#7a561a"/>
    </linearGradient>
  </defs>
  <g transform="translate(1.5 3)" fill="rgb(4 2 0 / 0.5)">
    <path d="M${c} ${c - tip} L${c + 6} ${c - ringR - 4} L${c + 4} ${c + tail - 14} L${c} ${c + tail} L${c - 4} ${c + tail - 14} L${c - 6} ${c - ringR - 4} Z"/>
  </g>
  <g fill="url(#${id}-rete)" stroke="#3b2705" stroke-width="1.2" stroke-linejoin="round">
    <path d="M${c} ${c - tip} L${c + 6} ${c - ringR - 4} L${c + 4} ${c + tail - 14} L${c} ${c + tail} L${c - 4} ${c + tail - 14} L${c - 6} ${c - ringR - 4} Z"/>
    <circle cx="${c}" cy="${c + tail - 4}" r="8"/>
  </g>
  <circle cx="${c}" cy="${c - ringR}" r="9" fill="none" stroke="#3b2705" stroke-width="5"/>
  <circle cx="${c}" cy="${c - ringR}" r="9" fill="none" stroke="url(#${id}-rete)" stroke-width="3"/>
  <circle cx="${c}" cy="${c + tail - 4}" r="3" fill="#2a1b04"/>
  <path d="M${c} ${c - tip + 6} L${c} ${c - ringR - 12}" stroke="rgb(255 250 225 / 0.8)" stroke-width="1"/>
</svg>`;
}

/** The fixed boss over the rete's pivot. */
function bossSvg(id: string, size: number): string {
  const c = size / 2;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
  <defs>
    <radialGradient id="${id}-boss" cx="0.35" cy="0.3" r="0.8">
      <stop offset="0" stop-color="#fff3c8"/><stop offset="0.5" stop-color="#c9a253"/><stop offset="1" stop-color="#5c3f0e"/>
    </radialGradient>
  </defs>
  <circle cx="${c}" cy="${c + 2}" r="14" fill="rgb(4 2 0 / 0.5)"/>
  <circle cx="${c}" cy="${c}" r="14" fill="url(#${id}-boss)" stroke="#3b2705" stroke-width="1.5"/>
  <circle cx="${c}" cy="${c}" r="6" fill="none" stroke="#5c3f0e" stroke-width="1.5"/>
</svg>`;
}
