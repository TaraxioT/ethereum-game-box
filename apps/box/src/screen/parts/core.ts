// <egb-core>: the world computer. A black glass sphere seated in a thick gunmetal collar on a thin base ring, a lavender
// neon line between them; inside the glass the Ethereum mark, front on, lit from behind. The glass has volume: a dark
// depth that lifts toward its edge, the board's neon caught along its lower curve, a caustic pool under the mark, a
// curved window reflection across the top, a hard specular point and a Fresnel rim brighter at the foot.
//
// Size: attributes `glass` and `collar` (radii in px). The drawing centres itself on the element's box (which fills
// its parent by default), so the shell places it by the core's centre. Attribute `dark`: everything that gives light
// is off (the boot holds it so until `ignite()`).
//
// It holds still. `swell()`: the glass and its light swell once (a
// transaction landed, a block sealed). `coin()`: the mark turns once like a coin (a game loads). `ignite()`: from
// dark, light comes up in the glass, then the mark, then the rim (~900 ms).
import { ethMarkSvg } from "./eth-mark.ts";
import { motion, pick, settled, shadow, sheet } from "./part.ts";

/** The board's neon reflected in the glass: arcs hugging its lower curve, on a 200 × 200 grid round 100,100. Each is
 * a colour, a radius, from/to in degrees clockwise from the top, a width and an opacity. */
const ARCS: readonly [string, number, number, number, number, number][] = [
  ["var(--neon-gold)", 94, 204, 248, 2.4, 0.8],
  ["var(--neon-lav)", 90, 214, 262, 2, 0.8],
  ["var(--p1)", 86, 200, 232, 1.6, 0.55],
  ["var(--neon-mint)", 94, 112, 156, 2.4, 0.75],
  ["var(--neon-gold)", 90, 98, 146, 2, 0.6],
  ["var(--p2)", 86, 128, 160, 1.6, 0.55],
  ["var(--neon-lav)", 95.5, 166, 194, 1.8, 0.6],
  ["var(--neon-lav)", 95.5, 288, 318, 1.8, 0.5],
  ["var(--neon-lav)", 95.5, 42, 72, 1.8, 0.5],
];

const at = (r: number, deg: number): string => {
  const a = ((deg - 90) * Math.PI) / 180;
  return `${(100 + Math.cos(a) * r).toFixed(2)} ${(100 + Math.sin(a) * r).toFixed(2)}`;
};

const REFLECTIONS = `<svg class="refl" viewBox="0 0 200 200" aria-hidden="true"><g fill="none" stroke-linecap="round">${ARCS.map(
  ([c, r, a, b, w, o]) => `<path d="M${at(r, a)}A${r} ${r} 0 0 1 ${at(r, b)}" style="stroke:${c}" stroke-width="${w}" opacity="${o}"/>`,
).join("")}</g></svg>`;

const styles = sheet(`
:host { display: block; position: relative; width: 100%; height: 100%; pointer-events: none; }
.core { position: absolute; inset: 0; --g: 132px; --c: 166px; }
.ring {
  position: absolute; border-radius: 50%;
  left: calc(50% - var(--r)); top: calc(50% - var(--r)); width: calc(var(--r) * 2); height: calc(var(--r) * 2);
}

/* Its contact shadow on the board. */
.shadow { --r: calc(var(--c) + 24px); transform: translateY(10px); background: radial-gradient(closest-side, rgb(4 2 12 / 0.72) 70%, rgb(4 2 12 / 0.32) 86%, transparent); }
/* The base ring: a thin dark metal ring the collar stands on. */
.base {
  --r: calc(var(--c) + 9px);
  background: linear-gradient(160deg, #474076, #1f1939 55%, #130e28);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.2), inset 0 -1.5px 0 rgb(0 0 0 / 0.5), 0 0 0 1.5px #08050f, 0 6px 12px rgb(3 1 10 / 0.5);
}
/* The neon line between the base ring and the collar: a 1.5 px lavender line with a short glow. */
.neon {
  --r: calc(var(--c) + 4.5px);
  border: 1.5px solid #d3c2ff;
  box-shadow: 0 0 0 1px rgb(173 143 255 / 0.35), 0 0 8px rgb(173 143 255 / 0.45), inset 0 0 6px rgb(173 143 255 / 0.4);
}
/* The collar: thick gunmetal, lit from the top left, a sheen where the key light catches it and a weaker one
   opposite. */
.collar {
  --r: var(--c);
  background:
    conic-gradient(from 270deg, transparent 0deg, rgb(255 255 255 / 0.17) 45deg, transparent 100deg, transparent 170deg, rgb(255 255 255 / 0.06) 225deg, transparent 280deg),
    linear-gradient(150deg, #958dc4 0%, #655d97 16%, #453c72 42%, #2d2552 70%, #1d1738 100%);
  box-shadow: inset 0 2px 0 rgb(255 255 255 / 0.38), inset 2px 0 0 rgb(255 255 255 / 0.08), inset 0 -3px 0 rgb(0 0 0 / 0.5), 0 0 0 1.5px #0a0618;
}
/* The collar's inner wall, falling to the glass: it faces away from the light, so it is dark at the top left and lit
   at the bottom right. */
.wall {
  --r: calc(var(--g) + 12px);
  background: linear-gradient(150deg, #110c24 0%, #221b43 45%, #4b4280 85%, #6c63a3 100%);
  box-shadow: 0 -1.5px 0 rgb(0 0 0 / 0.4), 0 1.5px 0 rgb(255 255 255 / 0.22);
}
.groove { --r: calc(var(--g) + 4px); background: #06040d; box-shadow: inset 0 2px 4px rgb(0 0 0 / 0.9); }

/* The glass: a true circle, everything inside clipped to it. It, its light and its pool, which swell on every block,
   and the mark, which turns, stay on layers of their own: an element the browser lifts onto a layer only while it
   animates makes the GPU raster the glass and everything over it again as the motion starts and again as it ends,
   which on the Pi costs a 130 ms frame and an 80 ms one per block. */
.glass { --r: var(--g); overflow: hidden; will-change: transform; }
.glass > * { position: absolute; }
.depth {
  inset: 0; border-radius: 50%;
  background:
    radial-gradient(70% 38% at 50% 100%, rgb(132 98 255 / 0.3), transparent 72%),
    radial-gradient(circle at 46% 38%, #1d1642 0%, #130d2c 36%, #0a0718 64%, #0d0920 82%, #221a46 94%, #3a3168 100%);
}
/* The mark's light: a soft volume round it. */
.light {
  will-change: opacity;
  left: 12.5%; top: 4.5%; width: 75%; height: 85%; border-radius: 50%; opacity: 0.8;
  background: radial-gradient(closest-side, rgb(214 192 255 / 0.5), rgb(160 124 255 / 0.2) 50%, rgb(120 84 240 / 0.06) 78%, transparent);
}
/* The caustic the mark's light focuses on the sphere's floor. */
.pool {
  will-change: opacity;
  left: 22%; top: 79%; width: 56%; height: 13%; border-radius: 50%;
  background: radial-gradient(closest-side, rgb(236 222 255 / 0.42), rgb(178 148 255 / 0.18) 50%, transparent);
}
.refl { inset: 0; width: 100%; height: 100%; }
/* The mark, a little above centre. It turns about its upright axis for coin(). */
.gem { left: 25.3%; top: 14.5%; width: 49.4%; height: 64.5%; will-change: transform; }
.float { position: absolute; inset: 0; }
.float svg { display: block; width: 100%; height: 100%; }
/* The room on the front surface: a curved window across the top, crisp along its upper edge and fading down. */
.window {
  left: 14%; top: 3%; width: 72%; height: 40%; border-radius: 50%;
  background: linear-gradient(180deg, rgb(246 242 255 / 0.5), rgb(222 208 255 / 0.16) 32%, rgb(200 184 255 / 0.03) 66%, transparent);
  box-shadow: inset 0 1.5px 0 rgb(255 255 255 / 0.28);
  -webkit-mask-image: radial-gradient(80% 95% at 50% 120%, transparent 62%, #000 80%);
  mask-image: radial-gradient(80% 95% at 50% 120%, transparent 62%, #000 80%);
}
/* The specular point, high on the left, and a fainter one to the right. */
.spec { left: 24%; top: 12.5%; width: 11%; height: 5%; border-radius: 50%; transform: rotate(-30deg); background: radial-gradient(closest-side, #fff 25%, rgb(255 255 255 / 0.55) 60%, transparent); }
.spec::after { content: ""; position: absolute; left: 430%; top: -40%; width: 45%; height: 70%; border-radius: 50%; transform: rotate(52deg); background: radial-gradient(closest-side, rgb(255 255 255 / 0.6), transparent); }
/* Fresnel: the ball's edge falls off to black, then catches the room as a thin lavender line, brightest at the foot
   and along the lit top left. */
.rim {
  inset: 0; border-radius: 50%;
  background: radial-gradient(closest-side, transparent 74%, rgb(5 3 14 / 0.4) 91%, rgb(5 3 14 / 0.18) 97%, transparent);
  box-shadow:
    inset 0 0 0 1.5px rgb(214 198 255 / 0.45), inset 0 -10px 10px -8px rgb(238 228 255 / 0.55),
    inset 5px 7px 10px -8px rgb(255 255 255 / 0.38), inset 0 0 10px rgb(150 120 255 / 0.14);
}

/* Dark (before ignite): the core stands unlit. */
:host([dark]) :is(.neon, .light, .pool, .refl, .gem, .window, .spec, .rim) { opacity: 0; }
`);

const COIN_MS = 900;

export class EgbCore extends HTMLElement {
  static readonly observedAttributes = ["glass", "collar"];
  readonly #core: HTMLElement;
  readonly #glass: HTMLElement;
  readonly #light: HTMLElement;
  readonly #pool: HTMLElement;
  readonly #gem: HTMLElement;
  /** What ignite brings up after the mark: the glass's reflections and rim, and the neon line. */
  readonly #rim: HTMLElement[];
  #turning: Animation | null = null;
  #igniting: Promise<void> | null = null;

  constructor() {
    super();
    const root = shadow(
      this,
      styles,
      `<div class="core">
        <i class="ring shadow"></i><i class="ring base"></i><i class="ring neon"></i><i class="ring collar"></i>
        <i class="ring wall"></i><i class="ring groove"></i>
        <div class="ring glass">
          <i class="depth"></i><i class="light"></i><i class="pool"></i>${REFLECTIONS}
          <div class="gem"><div class="float">${ethMarkSvg({ backlight: true })}</div></div>
          <i class="window"></i><i class="spec"></i><i class="rim"></i>
        </div>
      </div>`,
    );
    this.#core = pick(root, ".core");
    this.#glass = pick(root, ".glass");
    this.#light = pick(root, ".light");
    this.#pool = pick(root, ".pool");
    this.#gem = pick(root, ".gem");
    this.#rim = [".refl", ".window", ".spec", ".rim", ".neon"].map((s) => pick(root, s));
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    const px = Number(value);
    const prop = name === "glass" ? "--g" : "--c";
    if (value !== null && px > 0) this.#core.style.setProperty(prop, `${px}px`);
    else this.#core.style.removeProperty(prop);
  }

  /** The glass and the mark's light swell once and settle. */
  swell(): void {
    if (this.hasAttribute("dark")) return;
    const ease = { duration: 620, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
    motion(this.#glass, [{ transform: "none" }, { transform: "scale(1.025)", offset: 0.28 }, { transform: "none" }], ease);
    motion(this.#light, [{}, { opacity: 1, offset: 0.25 }, {}], ease);
    motion(this.#pool, [{}, { opacity: 0.6, offset: 0.25 }, {}], ease);
  }

  /** The mark turns once about its upright axis, like a coin, and comes back face on. */
  coin(): void {
    if (this.#turning?.playState === "running") return;
    this.#turning = motion(this.#gem, [{ transform: "perspective(900px) rotateY(0deg)" }, { transform: "perspective(900px) rotateY(360deg)" }], {
      duration: COIN_MS, easing: "cubic-bezier(0.45, 0, 0.25, 1)",
    });
  }

  /** From dark: light comes up in the glass, then the mark, then the rim. Resolves when the core is lit. */
  ignite(): Promise<void> {
    if (this.#igniting) return this.#igniting;
    if (!this.hasAttribute("dark")) return Promise.resolve();
    this.removeAttribute("dark");
    const up = (node: Element, delay: number, duration: number, from: Keyframe = { opacity: 0 }): Animation | null =>
      motion(node, [from, {}], { delay, duration, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "backwards" });
    this.#igniting = settled([
      up(this.#light, 0, 420),
      up(this.#pool, 80, 420),
      up(this.#gem, 260, 380, { opacity: 0, transform: "scale(0.92)" }),
      ...this.#rim.map((node, i) => up(node, 560 + i * 20, 300)),
    ]).then(() => {
      this.#igniting = null;
    });
    return this.#igniting;
  }
}
