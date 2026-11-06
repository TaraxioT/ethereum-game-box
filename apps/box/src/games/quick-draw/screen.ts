// Quick Draw's screen: a western standoff at dusk. Two seat-coloured gunslingers face each other across a long
// horizon with a flip-plate sign on a post between them. While the sign reads WAIT… the light slowly dims and the
// sun and the vignette beat like a heart; when it turns to DRAW the horizon flashes; at the end the winner fires, the
// loser sags, a brass plate under each shows the reaction time and a carved plank names the winner.
//
// The dimming runs from the standoff's start over the longest possible wait, and the heartbeat quickens once the
// shortest wait has passed. Both are the same for every match, so neither gives away when the draw comes.
//
// Before that, while both stakes go into the pot (the routes bring this screen up on the second signature), the two
// stand back to back by the sign, pace ten paces apart as the sign counts them, turn, and each raises a revolver and
// thumbs its hammer back. A brass wire plate over the sign follows the transaction. The standoff begins when the
// stakes are confirmed on chain, never before: if that comes before the walk is done, the two hurry to their marks.
import { stakeOf } from "../../core/catalogue.ts";
import "./quick-draw.css";
import type { BoxEvent, BoxState } from "../../core/types.ts";
import { shiftRect, type Layout, type Orientation, type Rect } from "../../screen/shell/layout.ts";
import type { View, ViewFactory } from "../../screen/views/view.ts";
import { el, place, play, wait } from "../../screen/shell/dom.ts";
import { other, type DuelSeat } from "@egb/sdk";
import { MAX_WAIT_MS, MIN_WAIT_MS, reactionMs } from "./rules.ts";
import type { QuickDrawPhase, QuickDrawState } from "./types.ts";
import { createScene, type SceneSpec } from "./scene.ts";
import { createSign } from "./sign.ts";
import { createFigure } from "./figure.ts";
import { latestOpen, OPEN_STEPS, openLine, openStepIndex } from "../../screen/views/open-tx.ts";
import type { Tx } from "../../core/types.ts";

interface Geometry {
  readonly scene: SceneSpec;
  /** The sign's board and its post, down to the ground. */
  readonly sign: Rect;
  readonly figures: readonly [Rect, Rect];
  readonly plates: readonly [Rect, Rect];
  readonly banner: Rect;
  /** The wire plate that follows the stakes going in, over the sign. */
  readonly wire: Rect;
}

// The Box's overlay holds the top ~130 px (landscape) / ~150 px (portrait); everything here stands below it.
const GEOMETRY: Record<Orientation, Geometry> = {
  landscape: {
    scene: { width: 1280, height: 800, horizon: 560, sun: { x: 640, y: 574, r: 232 } },
    sign: { x: 420, y: 212, w: 440, h: 504 },
    figures: [{ x: 30, y: 318, w: 260, h: 390 }, { x: 990, y: 318, w: 260, h: 390 }],
    plates: [{ x: 40, y: 712, w: 240, h: 66 }, { x: 1000, y: 712, w: 240, h: 66 }],
    banner: { x: 340, y: 594, w: 600, h: 92 },
    wire: { x: 400, y: 136, w: 480, h: 64 },
  },
  portrait: {
    scene: { width: 720, height: 1080, horizon: 720, sun: { x: 360, y: 734, r: 232 } },
    sign: { x: 140, y: 340, w: 440, h: 520 },
    figures: [{ x: 0, y: 660, w: 220, h: 330 }, { x: 500, y: 660, w: 220, h: 330 }],
    plates: [{ x: 12, y: 994, w: 200, h: 66 }, { x: 508, y: 994, w: 200, h: 66 }],
    banner: { x: 40, y: 560, w: 640, h: 92 },
    wire: { x: 110, y: 256, w: 500, h: 64 },
  },
};

/** The geometry for `layout`: on the wide stage, the landscape one moved to the middle with the land drawn across. */
function geometryFor(layout: Layout): Geometry {
  const g = GEOMETRY[layout.orientation];
  const dx = layout.inset;
  if (dx === 0) return g;
  return {
    scene: { ...g.scene, width: layout.width, sun: { ...g.scene.sun, x: g.scene.sun.x + dx } },
    sign: shiftRect(g.sign, dx),
    figures: [shiftRect(g.figures[0], dx), shiftRect(g.figures[1], dx)],
    plates: [shiftRect(g.plates[0], dx), shiftRect(g.plates[1], dx)],
    banner: shiftRect(g.banner, dx),
    wire: shiftRect(g.wire, dx),
  };
}

/** How dark the light gets: by the shortest wait, by the longest, just after the draw, and once it's over. */
const DIM_AT_MIN = 0.3;
const DIM_AT_MAX = 0.55;
const DIM_DRAWN = 0.04;
const DIM_DONE = 0.14;

/** One heartbeat, lub-dub: the sun swells a touch and the vignette closes in, twice, then rests. */
const BEAT_MS = 1100;
const QUICKER = 1.4;
const BEAT_SUN: Keyframe[] = [
  { transform: "scale(1)" },
  { transform: "scale(1.028)", offset: 0.1 },
  { transform: "scale(1)", offset: 0.22 },
  { transform: "scale(1.016)", offset: 0.32 },
  { transform: "scale(1)", offset: 0.48 },
  { transform: "scale(1)" },
];
const BEAT_VIGNETTE: Keyframe[] = [
  { opacity: 0.5, transform: "scale(1)" },
  { opacity: 0.9, transform: "scale(0.985)", offset: 0.1 },
  { opacity: 0.55, transform: "scale(1)", offset: 0.22 },
  { opacity: 0.8, transform: "scale(0.99)", offset: 0.32 },
  { opacity: 0.5, transform: "scale(1)", offset: 0.48 },
  { opacity: 0.5, transform: "scale(1)" },
];

/** The walk-out: ten paces apart from back to back, a turn, and each checks the gun, Player 2 a beat after. */
const PACES = 10;
const PACE_MS = 540;
const FIRST_PACE_MS = 700;
const TURN_MS = 320;
const COCK_GAP_MS = 380;
/** How close the two stand back to back, either side of the sign's post (stage pixels between their middles). */
const BACK_TO_BACK = 96;
/** How long the two take to reach their marks when the stakes land before the walk is done. */
const HURRY_MS = 380;

/** What a seat's plate reads at the end. */
function verdict(s: QuickDrawState, seat: DuelSeat): { readonly ms: number } | { readonly word: string; readonly early: boolean } {
  const tap = s.taps[seat];
  if (tap !== null && tap < s.drawAt) return { word: "TOO EARLY", early: true };
  const ms = reactionMs(s, seat);
  if (ms !== null) return { ms };
  // No tap: the other player either jumped the gun (this one held) or drew first (this one was too slow).
  return { word: s.reason === "early" ? "HELD FIRE" : "TOO SLOW", early: false };
}

function quickDraw(state: BoxState): QuickDrawState | null {
  const playing = state.match?.play;
  return playing && playing.game === "quick-draw" ? playing.state : null;
}

export const quickDrawScreen: ViewFactory = (ctx): View => {
  const g = geometryFor(ctx.layout);
  const root = el("div", "qd");

  const scene = createScene(g.scene);
  const figures = [createFigure(0), createFigure(1)] as const;
  place(figures[0].el, g.figures[0]);
  place(figures[1].el, g.figures[1]);

  const dim = el("div", "qd-dim");
  const vignette = el("div", "qd-vignette");
  const flash = el("div", "qd-flash");
  place(flash, { x: 0, y: 0, w: g.scene.width, h: g.scene.horizon });
  const flashLine = el("div", "qd-flash-line");
  place(flashLine, { x: 0, y: g.scene.horizon - 1, w: g.scene.width, h: 3 });

  const sign = createSign();
  place(sign.el, g.sign);

  const makePlate = (seat: DuelSeat): HTMLElement => {
    const plate = el("div", `qd-plate qd-plate--p${seat + 1}`);
    place(plate, g.plates[seat]);
    return plate;
  };
  const plates = [makePlate(0), makePlate(1)] as const;

  const banner = el("div", "qd-banner qd-wood");
  place(banner, g.banner);
  const bannerText = el("span", "qd-banner-text");
  banner.append(el("span", "qd-banner-nail qd-banner-nail--l"), bannerText, el("span", "qd-banner-nail qd-banner-nail--r"));

  // The wire: a brass plate on a bracket that taps out the stakes' transaction while the two walk out.
  const wire = el("div", "qd-wire");
  place(wire, g.wire);
  const wireHead = el("span", "qd-wire-head");
  const wireSteps = el("span", "qd-wire-steps");
  const stepEls = OPEN_STEPS.map(({ label }) => {
    const item = el("span", "qd-wire-step", label);
    wireSteps.append(item);
    return item;
  });
  const wireLine = el("span", "qd-wire-line");
  wire.append(wireHead, wireSteps, wireLine);

  // A tumbleweed blows across behind the walk, once.
  const weed = el("div", "qd-weed");
  place(weed, { x: -80, y: g.scene.horizon + 18, w: 56, h: 56 });

  // The figures stand in front of the sign: they start back to back at its post.
  root.append(scene.el, weed, dim, vignette, flash, flashLine, sign.el, ...figures.map((f) => f.el), ...plates, banner, wire);

  let shown: QuickDrawPhase | null = null;
  let drawn = false;
  let alive = true;
  let heart: Animation[] = [];
  let quicken: ReturnType<typeof setTimeout> | undefined;
  let dimming: Animation | null = null;
  /** The walk-out: `walking` while it runs (a newer phase stops it), `walked` once it began on this screen. */
  let walking = false;
  let walked = false;
  let wireTx: Tx | null = null;
  let wireSince = 0;
  let wireTicker: ReturnType<typeof setInterval> | null = null;

  /** How far each figure's mark is from where it stands back to back by the sign (stage pixels). */
  const startOffsets = ([0, 1] as const).map((seat) => {
    const r = g.figures[seat];
    const middle = g.sign.x + g.sign.w / 2 + (seat === 0 ? -BACK_TO_BACK / 2 : BACK_TO_BACK / 2);
    return middle - (r.x + r.w / 2);
  });

  function drawWire(): void {
    if (wireTx) wireLine.textContent = openLine(wireTx, wireSince);
  }

  function showWire(state: BoxState): void {
    const open = latestOpen(state);
    if (!open || open.step === "failed") return;
    if (!wireTx || wireTx.id !== open.id) wireSince = Date.now();
    wireTx = open;
    wireHead.textContent = `${stakeOf(state.playFor, state.stake) * 2} USDC GOING INTO THE POT`;
    const at = openStepIndex(open);
    stepEls.forEach((item, i) => {
      item.toggleAttribute("done", i <= at);
      item.toggleAttribute("current", i === at + 1);
    });
    drawWire();
    wireTicker ??= setInterval(drawWire, 1000);
    if (!wire.classList.contains("is-up")) {
      wire.classList.add("is-up");
      void play(wire, [{ opacity: 0, transform: "translateY(-14px)" }, { opacity: 1, transform: "none" }], { duration: 360, easing: "ease-out" });
    }
  }

  function hideWire(): void {
    if (wireTicker !== null) clearInterval(wireTicker);
    wireTicker = null;
    if (!wire.classList.contains("is-up")) return;
    wire.classList.remove("is-up");
    void play(wire, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-10px)" }], { duration: 300, easing: "ease-in" });
  }

  /** The walk-out, from back to back by the sign to the cocked guns. Stops wherever it is once `walking` drops. */
  async function walkOut(): Promise<void> {
    walking = true;
    walked = true;
    sign.reset();
    if (ctx.calm) {
      for (const f of figures) f.stand(0, false);
      sign.say("READY");
      return;
    }
    figures.forEach((f, seat) => f.stand(startOffsets[seat] ?? 0, true));
    sign.say("PACES");
    void play(weed, [
      { transform: "translate(0, 0) rotate(0deg)" },
      { transform: `translate(${g.scene.width * 0.3}px, -22px) rotate(300deg)`, offset: 0.28 },
      { transform: `translate(${g.scene.width * 0.55}px, 0) rotate(560deg)`, offset: 0.5 },
      { transform: `translate(${g.scene.width * 0.8}px, -14px) rotate(820deg)`, offset: 0.74 },
      { transform: `translate(${g.scene.width + 160}px, 0) rotate(1120deg)` },
    ], { duration: 9000, delay: 900, easing: "linear" });
    await wait(FIRST_PACE_MS);
    for (let pace = 1; pace <= PACES; pace++) {
      if (!walking || !alive) return;
      const paces = figures.map((f, seat) => {
        const start = startOffsets[seat] ?? 0;
        const from = start * (1 - (pace - 1) / PACES);
        const to = start * (1 - pace / PACES);
        return f.pace(from, to, PACE_MS, (pace % 2) as 0 | 1);
      });
      // The heels land just before the pace ends: the count and the step sound with them.
      setTimeout(() => {
        if (!walking || !alive) return;
        ctx.sound.play("pace");
        sign.say(String(pace));
      }, PACE_MS * 0.86);
      await Promise.all(paces);
    }
    if (!walking || !alive) return;
    await Promise.all(figures.map((f) => f.plant(160)));
    if (!walking || !alive) return;
    sign.say("TURN");
    await Promise.all(figures.map((f) => f.turn(TURN_MS)));
    await wait(260);
    if (!walking || !alive) return;
    await Promise.all(figures.map(async (f, seat) => {
      await wait(seat * COCK_GAP_MS);
      if (!walking || !alive) return;
      await f.cock(() => ctx.sound.play("cock", { seat: seat as DuelSeat }));
    }));
    if (!walking || !alive) return;
    sign.say("READY");
    for (const f of figures) f.breathe();
  }

  /** The stakes are in: the walk-out stops, and the two get to their marks if they aren't there yet. */
  async function endWalk(): Promise<void> {
    hideWire();
    if (!walking) return;
    walking = false;
    if (ctx.calm) return;
    await Promise.all(figures.map((f) => f.arrive(HURRY_MS)));
  }

  function stopHeart(): void {
    clearTimeout(quicken);
    for (const a of heart) a.cancel();
    heart = [];
  }

  /** Eases the light to `to`, from wherever the dimming has got to. */
  function light(to: number, ms: number): void {
    const from = Number(getComputedStyle(dim).opacity);
    dimming?.cancel();
    dim.style.opacity = String(to);
    dimming = ctx.calm ? null : dim.animate([{ opacity: from }, { opacity: to }], { duration: ms, easing: "ease-out" });
  }

  function standoff(s: QuickDrawState): void {
    drawn = false;
    sign.reset();
    void endWalk().then(() => {
      if (!alive || shown !== "wait") return;
      for (const f of figures) {
        f.idle();
        f.breathe();
      }
    });
    for (const node of [...plates, banner]) for (const a of node.getAnimations()) a.cancel();
    stopHeart();
    dimming?.cancel();
    const elapsed = Math.min(Math.max(ctx.link.now() - s.startedAt, 0), MAX_WAIT_MS);
    if (ctx.calm) {
      dimming = null;
      dim.style.opacity = String(DIM_AT_MIN);
      return;
    }
    dim.style.opacity = String(DIM_AT_MAX);
    dimming = dim.animate(
      [{ opacity: 0 }, { opacity: DIM_AT_MIN, offset: MIN_WAIT_MS / MAX_WAIT_MS }, { opacity: DIM_AT_MAX }],
      { duration: MAX_WAIT_MS, easing: "linear" },
    );
    dimming.currentTime = elapsed;
    heart = [
      scene.sun.animate(BEAT_SUN, { duration: BEAT_MS, iterations: Infinity }),
      vignette.animate(BEAT_VIGNETTE, { duration: BEAT_MS, iterations: Infinity }),
    ];
    const quick = (): void => {
      for (const a of heart) a.updatePlaybackRate(QUICKER);
    };
    if (elapsed >= MIN_WAIT_MS) quick();
    else quicken = setTimeout(quick, MIN_WAIT_MS - elapsed);
  }

  async function draw(instant: boolean): Promise<void> {
    if (drawn) return;
    drawn = true;
    stopHeart();
    light(DIM_DRAWN, 140);
    if (!instant) {
      void play(flash, [{ opacity: 0 }, { opacity: 0.85, offset: 0.12 }, { opacity: 0 }], { duration: 620, easing: "ease-out" });
      void play(flashLine, [
        { opacity: 0, transform: "scaleX(0.12)" },
        { opacity: 1, transform: "scaleX(1)", offset: 0.25 },
        { opacity: 0, transform: "scaleX(1)" },
      ], { duration: 760, easing: "ease-out" });
    }
    await sign.flip(instant);
  }

  function fillPlate(seat: DuelSeat, s: QuickDrawState): void {
    const plate = plates[seat];
    const v = verdict(s, seat);
    const value = el("span", "qd-plate-value");
    if ("ms" in v) value.append(el("span", "qd-plate-ms", String(Math.round(v.ms))), el("span", "qd-plate-unit", "MS"));
    else value.append(el("span", `qd-plate-word${v.early ? " is-early" : ""}`, v.word));
    plate.replaceChildren(el("span", "qd-plate-label", `PLAYER ${seat + 1}`), value);
    plate.classList.toggle("is-winner", s.winner === seat);
  }

  async function finish(s: QuickDrawState, instant: boolean): Promise<void> {
    stopHeart();
    if (s.reason === "first") await draw(instant);
    else {
      light(DIM_DONE, 360);
      if (!instant) sign.rattle();
    }
    if (!alive) return;
    fillPlate(0, s);
    fillPlate(1, s);
    const w = s.winner;
    if (w !== null) {
      banner.classList.toggle("qd-banner--p1", w === 0);
      banner.classList.toggle("qd-banner--p2", w === 1);
      bannerText.textContent = `PLAYER ${w + 1} WINS`;
    }
    if (!instant) await wait(120);
    if (!alive) return;
    if (s.reason === "first") light(DIM_DONE, 600);
    if (w !== null) {
      void figures[w].win();
      figures[other(w)].lose();
    }
    plates.forEach((plate, i) => {
      void play(plate, [
        { opacity: 0, transform: "translateY(-18px) rotate(-3deg)" },
        { opacity: 1, transform: "none" },
      ], { duration: 420, delay: 260 + i * 90, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", fill: "forwards" });
    });
    if (w !== null) {
      void play(banner, [
        { opacity: 0, transform: "translateY(-56px) rotate(-5deg)" },
        { opacity: 1, transform: "translateY(4px) rotate(0.8deg)", offset: 0.7 },
        { opacity: 1, transform: "none" },
      ], { duration: 560, delay: 420, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" });
    }
  }

  function show(s: QuickDrawState, instant: boolean): void {
    if (s.phase === shown) return;
    shown = s.phase;
    if (s.phase === "wait") standoff(s);
    else if (s.phase === "draw") void draw(instant);
    else void finish(s, instant);
  }

  return {
    el: root,

    update(state: BoxState, event: BoxEvent) {
      if (state.phase === "stake") {
        // Both have signed: the stakes are on their way into the pot.
        if (event.type === "tap" && event.accepted) figures[event.seat].twitch();
        showWire(state);
        if (!walked) void walkOut();
        return;
      }
      const s = quickDraw(state);
      if (!s) return;
      if (event.type === "tap" && event.accepted) figures[event.seat].twitch();
      if (event.type === "cue" && event.cue === "draw" && shown === "wait") {
        shown = "draw";
        void draw(false);
      }
      show(s, event.type === "init");
    },

    dispose() {
      alive = false;
      walking = false;
      if (wireTicker !== null) clearInterval(wireTicker);
      stopHeart();
      for (const a of root.getAnimations({ subtree: true })) a.cancel();
    },
  };
};
