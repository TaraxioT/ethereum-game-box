// One gunslinger in flat silhouette, drawn facing right in a 200×300 box (Player 2's is mirrored to face left).
// Three stacked layers share the box: the body, the gun arm at the holster and the gun arm drawn, so a pose swap is
// an opacity change and a recoil is a transform, both on their own layer. A seat-coloured rim on the sun-facing
// edges, the hat band and the bandana carry the seat.
import type { Seat } from "../seat.ts";
import { el, play } from "../../screen/shell/dom.ts";

export interface Figure {
  readonly el: HTMLElement;
  /** Back to the standoff pose: hand over the holster. */
  idle(): void;
  /** A small jolt when this seat's badge taps, so the player feels it land. */
  twitch(): void;
  /** Draws and fires: the arm comes up, a muzzle flash, a recoil. */
  win(): Promise<void>;
  /** Sags back on its heels. */
  lose(): void;
}

const NS = "http://www.w3.org/2000/svg";
const VIEWBOX = "0 0 200 300";

/** The body without the gun arm: hat, head, bandana, duster, the far arm, legs, boots and the holster. */
const BODY = [
  "M46 61 Q100 47 154 58 Q153 65 140 65 L62 67 Q49 67 46 61 Z", // brim
  "M71 58 L75 29 Q88 22 100 27 Q112 21 125 28 L129 58 Z", // crown, dented
  "M84 64 L118 64 L116 85 Q100 93 86 85 Z", // head under the brim
  "M91 86 L109 86 L111 97 L89 97 Z", // neck
  "M70 104 Q100 93 132 104 L141 152 L152 240 Q124 248 106 241 L101 204 L97 241 Q78 248 50 240 L61 152 Z", // duster
  "M70 110 L55 172 L65 176 L82 124 Z", // far arm, hanging
  "M77 238 L71 282 L89 282 L95 238 Z", // far leg
  "M106 238 L116 282 L134 282 L123 238 Z", // near leg
  "M62 280 L92 280 L94 291 L57 291 Z", // far boot
  "M112 280 L141 281 L148 291 L112 291 Z", // near boot
  "M127 170 L141 167 L144 198 L133 200 Z", // holster
];

/** The gun arm hanging, the hand hovering over the holster. */
const ARM_IDLE = ["M122 103 L139 109 L145 166 L133 171 L127 121 Z", "M131 166 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0 Z"];

/** The gun arm out toward the other figure, the pistol level; the muzzle is at (200, 110). */
const ARM_DRAWN = [
  "M121 101 L136 98 L184 106 L185 121 L134 124 L124 120 Z",
  "M180 104 L200 106 L200 114 L180 114 Z", // barrel
  "M180 110 L192 112 L189 128 L179 126 Z", // grip
];

/** The seat's colour bits on the body: the hat band and the bandana. */
const SEAT_MARKS = ["M73 50 L127 50 L128 56 L72 56 Z", "M86 92 L114 92 L119 103 L100 113 L81 103 Z"];

function svgLayer(className: string, shapes: readonly string[], marks: readonly string[] = []): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", VIEWBOX);
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  // The rim: the same shapes in the seat colour, nudged toward the sun and up, so a 2 px lit edge shows on that side.
  const rim = document.createElementNS(NS, "g");
  rim.setAttribute("class", "qd-fig-rim");
  rim.setAttribute("transform", "translate(2 -1.5)");
  const body = document.createElementNS(NS, "g");
  body.setAttribute("class", "qd-fig-body");
  for (const d of shapes) {
    const r = document.createElementNS(NS, "path");
    r.setAttribute("d", d);
    rim.append(r);
    const b = document.createElementNS(NS, "path");
    b.setAttribute("d", d);
    body.append(b);
  }
  svg.append(rim, body);
  if (marks.length > 0) {
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "qd-fig-mark");
    for (const d of marks) {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d);
      g.append(p);
    }
    svg.append(g);
  }
  return svg;
}

/** An eight-point spark for the muzzle flash. */
function spark(): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "-50 -50 100 100");
  svg.setAttribute("class", "qd-fig-flash");
  svg.setAttribute("aria-hidden", "true");
  const points = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    const r = i % 2 === 0 ? (i % 4 === 0 ? 48 : 30) : 11;
    return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
  }).join(" ");
  const outer = document.createElementNS(NS, "polygon");
  outer.setAttribute("points", points);
  outer.setAttribute("class", "qd-fig-flash-outer");
  const core = document.createElementNS(NS, "circle");
  core.setAttribute("r", "12");
  core.setAttribute("class", "qd-fig-flash-core");
  svg.append(outer, core);
  return svg;
}

export function createFigure(seat: Seat): Figure {
  const root = el("div", `qd-fig qd-fig--p${seat + 1}`);
  const art = el("div", "qd-fig-art");
  const pose = el("div", "qd-fig-pose");
  const body = svgLayer("qd-fig-layer", BODY, SEAT_MARKS);
  const armIdle = svgLayer("qd-fig-layer qd-fig-arm-idle", ARM_IDLE);
  const armDrawn = svgLayer("qd-fig-layer qd-fig-arm-drawn", ARM_DRAWN);
  const flash = spark();
  pose.append(body, armIdle, armDrawn, flash);
  art.append(pose);
  root.append(art);

  // Player 1 stands at the left facing right; a jolt or a sag leans away from the other figure.
  const away = seat === 0 ? -1 : 1;

  function cancelAll(node: Element): void {
    for (const a of node.getAnimations()) a.cancel();
  }

  return {
    el: root,

    idle() {
      for (const node of [root, pose, armIdle, armDrawn, flash]) cancelAll(node);
    },

    twitch() {
      void play(root, [
        { transform: "none" },
        { transform: `translate(${away * 5}px, -4px) rotate(${away * 1.2}deg)`, offset: 0.35 },
        { transform: "none" },
      ], { duration: 170, easing: "ease-out" });
    },

    async win() {
      void play(armIdle, [{ opacity: 1 }, { opacity: 0 }], { duration: 60, fill: "forwards" });
      await play(armDrawn, [
        { opacity: 0, transform: "rotate(68deg)" },
        { opacity: 1, transform: "rotate(-6deg)", offset: 0.7 },
        { opacity: 1, transform: "none" },
      ], { duration: 190, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" });
      void play(flash, [
        { opacity: 1, transform: "scale(0.3)" },
        { opacity: 1, transform: "scale(1.25) rotate(12deg)", offset: 0.35 },
        { opacity: 0, transform: "scale(1.5) rotate(20deg)" },
      ], { duration: 280, easing: "ease-out" });
      await play(armDrawn, [
        { opacity: 1, transform: "none" },
        { opacity: 1, transform: "rotate(-13deg)", offset: 0.22 },
        { opacity: 1, transform: "none" },
      ], { duration: 380, easing: "ease-out", fill: "forwards" });
    },

    lose() {
      // The pose layer sits inside the mirror, so its own frame always faces the other figure: back is negative.
      void play(pose, [
        { opacity: 1, transform: "none" },
        { opacity: 0.78, transform: "translateY(10px) rotate(-7deg) scaleY(0.96)" },
      ], { duration: 520, easing: "cubic-bezier(0.34, 1.3, 0.64, 1)", fill: "forwards" });
    },
  };
}
