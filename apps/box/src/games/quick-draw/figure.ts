// One gunslinger against the low sun, drawn facing right in a 200×300 box (Player 2's is mirrored to face left).
// Each moving part is its own layer over the same box, so a step, a turn, a draw or a fall is a transform on one
// layer: the two legs (they swing at the hip), the body, the gun arm in each of its three poses (hand over the
// holster, gun raised to cock, gun out level), and the hat. Player 1 wears a long duster and a pinched cattleman's
// hat, Player 2 a short jacket, fringed chaps and a flat-crowned hat. A seat-coloured rim on the sun-facing edges, the
// hat band and the bandana carry the seat; brass catches the light on the buckle, the cartridge loops and the spurs.
import type { DuelSeat } from "@egb/sdk";
import { el, play, wait } from "../../screen/shell/dom.ts";

export interface Figure {
  readonly el: HTMLElement;
  /** Stands still, `offset` stage pixels from its mark, facing the other figure or away from it. */
  stand(offset: number, away: boolean): void;
  /** One pace from `from` to `to` (stage pixels from its mark), `ms` long; `lead` picks the leg that swings forward. */
  pace(from: number, to: number, ms: number, lead: 0 | 1): Promise<void>;
  /** Brings the legs together after the last pace. */
  plant(ms: number): Promise<void>;
  /** Turns round on the spot to face the other figure. */
  turn(ms: number): Promise<void>;
  /** Raises the revolver, thumbs the hammer back (`click` at that moment) and holsters it again. */
  cock(click: () => void): Promise<void>;
  /** Hurries the rest of the way to its mark and faces the other figure, the gun hand back over the holster. */
  arrive(ms: number): Promise<void>;
  /** Breathes and flexes the gun hand over the holster until the next pose. */
  breathe(): void;
  /** Back to the standoff pose at its mark: hand over the holster. */
  idle(): void;
  /** A small jolt when this seat's badge taps, so the player feels it land. */
  twitch(): void;
  /** Draws and fires: the arm comes up, a muzzle flash, a recoil, then smoke from the barrel. */
  win(): Promise<void>;
  /** Hit: rocks back, the hat flies, the knees go and the figure falls forward. */
  lose(): void;
}

const NS = "http://www.w3.org/2000/svg";
const VIEWBOX = "0 0 200 300";

/** How a shape is filled: `ink` is the silhouette (it carries the lit rim), the rest are details on it. */
type Tone = "ink" | "far" | "cloth" | "leather" | "brass" | "seat" | "steel" | "wood" | "line" | "glint" | "chain" | "finger";

interface Shape {
  readonly d: string;
  readonly tone?: Tone;
  /** A class of its own, for a part that moves inside its layer (the hammer). */
  readonly part?: string;
}

const ink = (d: string): Shape => ({ d });
const as = (tone: Tone, d: string, part?: string): Shape => (part ? { d, tone, part } : { d, tone });
const dot = (x: number, y: number, r: number): string => `M${x - r} ${y} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 Z`;

/** A leg, trousers and boot, standing from its hip at `x`: the boot points right, a spur at the heel. */
function leg(x: number, tone: "ink" | "far", chaps: boolean): Shape[] {
  const fill = (d: string): Shape => (tone === "ink" ? ink(d) : as("far", d));
  const at = (dx: number): number => x + dx;
  const shapes: Shape[] = [
    fill(`M${at(-11)} 176 L${at(11)} 176 L${at(12)} 214 L${at(10)} 252 L${at(9)} 272 L${at(-7)} 272 L${at(-8)} 252 L${at(-10)} 214 Z`),
    fill(`M${at(-8)} 266 L${at(10)} 266 L${at(11)} 279 Q${at(24)} 280 ${at(31)} 284 Q${at(34)} 288 ${at(33)} 291 L${at(-9)} 291 L${at(-9)} 283 Z`),
    as("line", `M${at(-5)} 275 L${at(9)} 275`),
    as("line", `M${at(1)} 186 L${at(1)} 262`),
    as("brass", `M${at(-17)} 283 L${at(-9)} 282 L${at(-9)} 286 L${at(-17)} 286.5 Z`),
    as("brass", dot(at(-19.5), 284.5, 3.6)),
  ];
  if (chaps) {
    shapes.push(
      as("leather", `M${at(-11)} 184 L${at(12)} 184 L${at(12)} 214 L${at(10)} 252 L${at(9)} 264 L${at(-7)} 264 L${at(-8)} 252 L${at(-10)} 214 Z`),
      as("line", Array.from({ length: 8 }, (_, i) => `M${at(11)} ${192 + i * 9} l5 3`).join(" ")),
    );
  }
  return shapes;
}

/** The parts both outfits share: the far arm, neck, head and bandana, the gunbelt and the holster. */
function person(seat: DuelSeat): Shape[] {
  const head: Shape[] = [
    as("far", "M86 64 L95 64 L94 " + (seat === 0 ? "82" : "92") + " L86 " + (seat === 0 ? "78" : "88") + " Z"), // hair at the back
    ink("M94 90 L108 90 L109 104 L93 104 Z"), // neck
    ink("M88 64 L116 64 Q119 72 118 77 L124 84 L119 86 Q119 92 114 95 L106 98 L96 98 Q88 90 88 64 Z"), // head, in profile
    as("line", dot(97, 79, 4.2)), // ear
    as("line", "M106 96 Q114 94 118 88"), // jaw
    as("line", "M109 74 L117 73"), // a squint under the brim
  ];
  if (seat === 0) head.push(as("far", "M111 86 Q118 84 122 88 Q116 91 111 89 Z")); // moustache
  else {
    head.push(as("far", "M108 95 L115 94 L112 102 Z")); // goatee
    head.push(as("cloth", "M118 88.5 L130 86.5 L130.4 89 L118.5 91 Z"), as("seat", "M129.6 86.2 h2.4 v3.2 h-2.4 Z")); // cigarillo
  }
  return [
    // The far arm, hanging behind the body.
    as("far", "M70 108 L82 114 L77 148 L73 172 L63 174 L60 168 L66 146 Z"),
    as("far", dot(67, 176, 6.5)),
    ...head,
    as("seat", "M91 96 L112 96 L117 106 L102 118 L87 106 Z"), // bandana
    as("seat", "M88 100 L77 111 L82 113 L91 104 Z"), // its knot
  ];
}

/** The gunbelt slung low across the hips, its loops of cartridges, the buckle and the holster on the gun side. */
const GUNBELT: Shape[] = [
  as("leather", "M63 168 L141 174 L141 184 L63 178 Z"),
  as("brass", Array.from({ length: 6 }, (_, i) => `M${68 + i * 5} ${169.6 + i * 0.4} h2.6 v6 h-2.6 Z`).join(" ")),
  as("brass", "M96 171 h11 v10 h-11 Z"),
  as("leather", "M99 174 h5 v4 h-5 Z"),
  as("leather", "M127 178 L142 176 L147 212 L134 214 Z"), // holster
  as("line", "M131 186 L144 184 M134 207 L147 205"),
];

const BODY: Record<DuelSeat, Shape[]> = {
  // A duster to the knee, open at the front over a lighter shirt and a buttoned vest.
  0: [
    ink("M70 106 Q98 96 130 104 L138 124 L140 176 L148 240 Q134 246 120 241 L114 196 L102 196 L96 241 Q78 246 60 240 L66 176 L68 124 Z"),
    as("cloth", "M110 104 L124 106 L122 170 L110 170 Z"),
    as("far", "M110 104 L116 106 L116 170 L110 170 Z"),
    as("brass", [dot(117.6, 122, 1.4), dot(117.6, 138, 1.4), dot(117.6, 154, 1.4)].join(" ")),
    as("line", "M110 104 L104 132 L110 172 M124 106 L127 132 L123 172 M68 200 L64 238 M136 200 L142 238"),
  ],
  // A short jacket over a vest, a watch chain across it.
  1: [
    ink("M70 106 Q98 96 130 104 L138 124 L138 186 L66 186 L68 124 Z"),
    as("cloth", "M110 104 L124 106 L120 150 L112 150 Z"),
    as("far", "M108 106 L114 106 L114 168 L108 168 Z"),
    as("chain", "M108 152 Q116 162 124 152"),
    as("brass", dot(124, 153, 2)),
    as("line", "M110 104 L104 130 L108 168 M124 106 L127 130 L122 168 M80 140 L92 140"),
  ],
};

const HAT: Record<DuelSeat, Shape[]> = {
  0: [
    ink("M50 62 Q64 68 84 66 L120 66 Q140 68 154 58 Q152 72 128 72 L78 72 Q56 72 50 62 Z"),
    ink("M74 66 L78 36 Q86 26 95 33 Q101 27 107 33 Q115 27 123 36 L127 66 Z"),
    as("seat", "M76 58 L125 58 L126 64 L75 64 Z"),
    as("line", "M101 32 L101 52"),
  ],
  1: [
    ink("M46 66 L154 64 L153 71 L48 72 Z"),
    ink("M76 66 L79 38 Q100 35 121 38 L124 66 Z"),
    as("seat", "M77 58 L123 58 L124 64 L76 64 Z"),
    as("brass", [dot(88, 61, 1.7), dot(100, 61, 1.7), dot(112, 61, 1.7)].join(" ")),
  ],
};

/** The gun arm hanging, the fingers spread over the revolver's grip in its holster. */
const ARM_IDLE: Shape[] = [
  as("wood", "M131 170 Q127 177 130 184 L140 183 L141 172 Z"), // the holstered gun's grip
  as("steel", "M137 168 l5 -3 l1.5 3.5 Z"), // its hammer
  ink("M118 104 L132 106 L142 132 L143 150 L133 152 L131 136 L120 120 Z"),
  as("line", "M133 147 L143 145"),
  ink("M132 150 L144 148 L146 160 L142 165 L134 164 L131 158 Z"),
  as("finger", "M135 163 l-1 6 M139 164 l0 6.5 M143 162 l1.4 6"),
];

/** The gun raised barrel-up by the shoulder, the thumb on the hammer. */
const ARM_CHECK: Shape[] = [
  ink("M118 104 L132 106 L144 144 L136 150 L122 122 Z"),
  ink("M134 146 L144 142 L156 124 L148 118 Z"),
  as("wood", "M147 116 L155 116 L153 131 L147 131 Z"),
  as("steel", "M146 106 L157 106 L157 118 L146 118 Z"), // cylinder
  as("steel", "M149 78 L154 78 L154 106 L149 106 Z"), // barrel
  as("glint", "M149.6 80 L149.6 116 M146 110 h11 M146 114 h11"),
  as("steel", "M155 108 L160 100 L163 102 L158 110 Z", "qd-fig-hammer"),
  ink("M144 116 L157 114 L159 126 L146 128 Z"), // hand
];

/** The gun arm out toward the other figure, the pistol level; the muzzle is at (200, 104). */
const ARM_DRAWN: Shape[] = [
  ink("M118 102 L134 100 L170 104 L171 118 L134 120 L121 116 Z"),
  as("line", "M164 104 L165 118"),
  as("wood", "M173 108 L182 108 L178 124 L170 122 Z"),
  as("steel", "M176 99 L188 99 L188 110 L176 110 Z"),
  as("steel", "M188 101 L200 101 L200 107 L188 107 Z"),
  as("steel", "M196.5 98.5 h2.5 v2.5 h-2.5 Z M175 99 l-4 -4 l2.4 -1 l4 4 Z"),
  as("glint", "M177 100 L199.5 101.5 M180 99.5 L180 109.5 M184 99.5 L184 109.5"),
  ink("M167 104 L180 105 L182 118 L170 120 Z"),
];

function svgLayer(className: string, shapes: readonly Shape[]): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", VIEWBOX);
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  // The rim: the silhouette again in the seat colour, nudged toward the sun and up, so a lit edge shows on that side.
  const rim = document.createElementNS(NS, "g");
  rim.setAttribute("class", "qd-fig-rim");
  rim.setAttribute("transform", "translate(2 -1.5)");
  for (const shape of shapes) {
    if (shape.tone !== undefined || shape.part) continue;
    const r = document.createElementNS(NS, "path");
    r.setAttribute("d", shape.d);
    rim.append(r);
  }
  svg.append(rim);
  for (const shape of shapes) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", shape.d);
    p.setAttribute("class", `qd-fig-${shape.tone ?? "ink"}${shape.part ? ` ${shape.part}` : ""}`);
    svg.append(p);
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

/** How far a leg swings each way from straight down, at the hip, in a pace. */
const SWING = 17;

export function createFigure(seat: DuelSeat): Figure {
  const root = el("div", `qd-fig qd-fig--p${seat + 1}`);
  // From the outside in: the walk (across the stage), the mirror (Player 2 faces left), the turn (facing away), the
  // pose (a breath, a fall). Each moves on its own element, so one never cancels another.
  const walk = el("div", "qd-fig-walk");
  const art = el("div", "qd-fig-art");
  const turnEl = el("div", "qd-fig-turn");
  const pose = el("div", "qd-fig-pose");
  const legFar = svgLayer("qd-fig-layer qd-fig-leg qd-fig-leg--far", leg(94, "far", seat === 1));
  const legNear = svgLayer("qd-fig-layer qd-fig-leg qd-fig-leg--near", leg(108, "ink", seat === 1));
  const body = svgLayer("qd-fig-layer", [...BODY[seat], ...GUNBELT, ...person(seat)]);
  const armIdle = svgLayer("qd-fig-layer qd-fig-arm qd-fig-arm-idle", ARM_IDLE);
  const armCheck = svgLayer("qd-fig-layer qd-fig-arm qd-fig-arm-check", ARM_CHECK);
  const armDrawn = svgLayer("qd-fig-layer qd-fig-arm qd-fig-arm-drawn", ARM_DRAWN);
  const hat = svgLayer("qd-fig-layer qd-fig-hat", HAT[seat]);
  const hammer = armCheck.querySelector(".qd-fig-hammer");
  const flash = spark();
  const smoke = el("div", "qd-fig-smoke");
  for (let i = 0; i < 3; i++) smoke.append(el("i", `qd-fig-puff qd-fig-puff--${i}`));
  pose.append(legFar, legNear, body, armIdle, armCheck, armDrawn, flash, smoke);
  // The hat rides on the turn, not the pose, so when the figure falls it flies off on its own.
  turnEl.append(pose, hat);
  art.append(turnEl);
  walk.append(art);
  root.append(walk);

  // Player 1 stands at the left facing right; a jolt leans away from the other figure.
  const away = seat === 0 ? -1 : 1;
  const legs = [legNear, legFar] as const;
  let breathing: Animation[] = [];
  /** Bumped by every move that takes the figure over, so a cock still under way stops where it is. */
  let moves = 0;

  function cancelAll(node: Element): void {
    for (const a of node.getAnimations()) a.cancel();
  }

  function stopBreathing(): void {
    for (const a of breathing) a.cancel();
    breathing = [];
  }

  /** Holds `node` at `frame` until something else moves it. */
  function hold(node: Element, frame: Keyframe): void {
    cancelAll(node);
    node.animate([frame], { duration: 1, fill: "forwards" });
  }

  return {
    el: root,

    stand(offset, facingAway) {
      for (const node of [walk, turnEl, ...legs]) cancelAll(node);
      hold(walk, { transform: `translateX(${offset}px)` });
      hold(turnEl, { transform: facingAway ? "scaleX(-1)" : "none" });
    },

    async pace(from, to, ms, lead) {
      const forward = lead === 0 ? legNear : legFar;
      const back = lead === 0 ? legFar : legNear;
      const mid = (from + to) / 2;
      // The body rises over the planted leg mid-stride and drops as the heel lands.
      void play(walk, [
        { transform: `translate(${from}px, 0)` },
        { transform: `translate(${mid}px, -5px)`, offset: 0.45 },
        { transform: `translate(${to}px, 1px)`, offset: 0.9 },
        { transform: `translate(${to}px, 0)` },
      ], { duration: ms, easing: "linear", fill: "forwards" });
      void play(back, [{ transform: `rotate(${-SWING}deg)` }, { transform: `rotate(${SWING}deg)` }], { duration: ms, easing: "ease-in-out", fill: "forwards" });
      await play(forward, [{ transform: `rotate(${SWING}deg)` }, { transform: `rotate(${-SWING}deg)` }], { duration: ms, easing: "ease-in-out", fill: "forwards" });
    },

    async plant(ms) {
      await Promise.all(legs.map((l) => play(l, [{ transform: "none" }], { duration: ms, easing: "ease-out", fill: "forwards" })));
    },

    async turn(ms) {
      const from = getComputedStyle(turnEl).transform;
      await play(turnEl, [
        { transform: from === "none" ? "scaleX(-1)" : from },
        { transform: "scaleX(0.08) translateY(-3px)", offset: 0.5 },
        { transform: "none" },
      ], { duration: ms, easing: "ease-in-out", fill: "forwards" });
    },

    async cock(click) {
      const move = ++moves;
      const stale = (): boolean => move !== moves;
      void play(armIdle, [{ opacity: 1 }, { opacity: 0 }], { duration: 80, fill: "forwards" });
      await play(armCheck, [
        { opacity: 0, transform: "rotate(40deg)" },
        { opacity: 1, transform: "rotate(-4deg)", offset: 0.75 },
        { opacity: 1, transform: "none" },
      ], { duration: 280, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" });
      await wait(220);
      if (stale()) return;
      click();
      if (hammer) void play(hammer, [{ transform: "none" }, { transform: "rotate(-38deg)" }], { duration: 90, easing: "ease-in", fill: "forwards" });
      await play(armCheck, [
        { opacity: 1, transform: "none" },
        { opacity: 1, transform: "rotate(-5deg)", offset: 0.3 },
        { opacity: 1, transform: "none" },
      ], { duration: 260, easing: "ease-out", fill: "forwards" });
      await wait(420);
      if (stale()) return;
      // Back into the holster: the raised gun swings down and the hand settles over it.
      await play(armCheck, [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "rotate(36deg)" },
      ], { duration: 240, easing: "ease-in", fill: "forwards" });
      if (stale()) return;
      if (hammer) cancelAll(hammer);
      cancelAll(armIdle);
      void play(armIdle, [{ transform: "rotate(-5deg)" }, { transform: "none" }], { duration: 220, easing: "ease-out" });
    },

    async arrive(ms) {
      moves++;
      for (const node of [armIdle, armCheck]) cancelAll(node);
      if (hammer) cancelAll(hammer);
      const at = (node: Element): string => getComputedStyle(node).transform;
      const walkFrom = at(walk);
      const turnFrom = at(turnEl);
      await Promise.all([
        ...legs.map((l) => play(l, [{ transform: at(l) }, { transform: "none" }], { duration: ms, easing: "ease-out", fill: "forwards" })),
        play(walk, [{ transform: walkFrom }, { transform: "none" }], { duration: ms, easing: "ease-out", fill: "forwards" }),
        play(turnEl, turnFrom === "none" ? [{ transform: "none" }] : [{ transform: turnFrom }, { transform: "scaleX(0.08)" }, { transform: "none" }], {
          duration: ms, easing: "ease-in-out", fill: "forwards",
        }),
      ]);
    },

    breathe() {
      stopBreathing();
      breathing = [
        pose.animate([{ transform: "none" }, { transform: "scaleY(1.012) translateY(-1px)" }, { transform: "none" }], {
          duration: 3400, iterations: Infinity, easing: "ease-in-out",
        }),
        // The gun hand flexes over the grip now and then.
        armIdle.animate([
          { transform: "none" },
          { transform: "none", offset: 0.7 },
          { transform: "rotate(-2.2deg)", offset: 0.78 },
          { transform: "rotate(0.8deg)", offset: 0.86 },
          { transform: "none", offset: 0.92 },
          { transform: "none" },
        ], { duration: 2900, iterations: Infinity, easing: "ease-in-out" }),
      ];
    },

    idle() {
      moves++;
      stopBreathing();
      for (const node of [root, walk, turnEl, pose, ...legs, armIdle, armCheck, armDrawn, hat, flash, smoke]) cancelAll(node);
      if (hammer) cancelAll(hammer);
      for (const puff of smoke.children) cancelAll(puff);
    },

    twitch() {
      void play(root, [
        { transform: "none" },
        { transform: `translate(${away * 5}px, -4px) rotate(${away * 1.2}deg)`, offset: 0.35 },
        { transform: "none" },
      ], { duration: 170, easing: "ease-out" });
    },

    async win() {
      stopBreathing();
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
      // Smoke curls up off the muzzle and thins out, each puff a little later and higher.
      [...smoke.children].forEach((puff, i) => {
        void play(puff, [
          { opacity: 0, transform: "translate(0, 0) scale(0.4)" },
          { opacity: 0.75 - i * 0.15, transform: `translate(${6 + i * 6}px, ${-10 - i * 8}px) scale(1)`, offset: 0.2 },
          { opacity: 0, transform: `translate(${18 + i * 12}px, ${-60 - i * 26}px) scale(${2.2 + i * 0.5})` },
        ], { duration: 1700 + i * 300, delay: 60 + i * 110, easing: "ease-out", fill: "forwards" });
      });
      await play(armDrawn, [
        { opacity: 1, transform: "none" },
        { opacity: 1, transform: "rotate(-13deg)", offset: 0.22 },
        { opacity: 1, transform: "none" },
      ], { duration: 380, easing: "ease-out", fill: "forwards" });
    },

    lose() {
      stopBreathing();
      // The pose sits inside the mirror, so its own frame always faces the other figure: back is negative x, and a
      // fall forward is a positive turn about the boots.
      void play(pose, [
        { transform: "none" },
        { transform: "translateX(-9px) rotate(-6deg)", offset: 0.12 },
        { transform: "translate(-4px, 16px) rotate(3deg) scaleY(0.94)", offset: 0.42 },
        { transform: "translate(-2px, 26px) rotate(9deg) scaleY(0.9)", offset: 0.58 },
        { transform: "translate(10px, -6px) rotate(84deg) scaleY(0.9)" },
      ], { duration: 1300, delay: 60, easing: "cubic-bezier(0.5, 0, 0.75, 0.6)", fill: "forwards" });
      // The hat is knocked off backward, tumbles and lands behind.
      void play(hat, [
        { transform: "none", opacity: 1 },
        { transform: "translate(-30px, -56px) rotate(-70deg)", opacity: 1, offset: 0.35 },
        { transform: "translate(-58px, 286px) rotate(-190deg)", opacity: 1, offset: 0.92 },
        { transform: "translate(-60px, 278px) rotate(-184deg)", opacity: 1 },
      ], { duration: 1200, delay: 40, easing: "cubic-bezier(0.3, 0.5, 0.6, 1)", fill: "forwards" });
    },
  };
}
