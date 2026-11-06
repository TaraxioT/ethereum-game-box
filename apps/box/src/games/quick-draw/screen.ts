// Quick Draw's screen: a western standoff at dusk, best of three. Two seat-coloured gunslingers face each other across
// a long horizon with a flip-plate sign on a post between them.
//
// Every round says plainly what to do. A brass plate up top keeps the round and each player's rounds won (two pips
// each). The sign counts each round in (3, 2, 1) while a call strip under it reads ROUND n · GET READY; then the sign
// reads WAIT… and the strip DON'T TAP YET. A decoy may flash on the sign in red (DRAG, DRAT…): the strip turns red
// with NOT YET! and a red DON'T! hangs over both gunslingers. When the sign turns over to its gold DRAW face the land
// flashes, rays burst behind the sign, the strip turns green with TAP NOW! and a green TAP! bounces over both heads.
// A good draw fires and the other falls; a foul (a tap before DRAW) blows up the fouler's gun in the hand and the
// round goes to the other player. The strip then names who took the round, the plates under the figures show the
// reaction times, and the next round is counted in. The first to two rounds wins: a carved plank names them.
//
// While the sign reads WAIT… the light slowly dims and the sun and the vignette beat like a heart. The dimming runs
// over the longest possible wait and the heartbeat quickens once the shortest has passed, the same every round, so
// neither gives away when the draw comes. The countdown is to the start of the wait, never to the draw.
//
// Before that, while both stakes go into the pot (the routes bring this screen up on the second signature), the two
// stand back to back by the sign, pace ten paces apart as the sign counts them, turn, and each raises a revolver and
// thumbs its hammer back. A brass wire plate over the sign follows the transaction. If the stakes are still on their
// way after that (on Sepolia they take longer than the walk), the two keep moving on their marks: a slow step back and
// in again, a gun checked, a hat touched, a tumbleweed now and then while the sun sinks; the sign holds a word that
// follows the transaction (HOLD…, SENT…, BLOCK). The first round is counted in when the stakes are confirmed on chain,
// never before; if they land before the walk is done, the two hurry to their marks.
import { stakeOf } from "../../core/catalogue.ts";
import "./quick-draw.css";
import type { BoxEvent, BoxState } from "../../core/types.ts";
import { shiftRect, type Layout, type Orientation, type Rect } from "../../screen/shell/layout.ts";
import type { View, ViewFactory } from "../../screen/views/view.ts";
import { el, place, play, wait } from "../../screen/shell/dom.ts";
import { other, type Seat } from "@egb/sdk";
import { DECOY_MS, fouler, MAX_WAIT_MS, MIN_WAIT_MS, reactionMs, ROUNDS_TO_WIN } from "./rules.ts";
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
  /** The round and the rounds won, up top (where the wire was). */
  readonly hud: Rect;
  /** The call strip: what to do now, in words. */
  readonly call: Rect;
  /** Over each gunslinger's head: TAP! on the draw, DON'T! on a decoy. */
  readonly bubbles: readonly [Rect, Rect];
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
    hud: { x: 430, y: 148, w: 420, h: 54 },
    call: { x: 290, y: 596, w: 700, h: 96 },
    bubbles: [{ x: 70, y: 226, w: 180, h: 80 }, { x: 1030, y: 226, w: 180, h: 80 }],
  },
  portrait: {
    scene: { width: 720, height: 1080, horizon: 720, sun: { x: 360, y: 734, r: 232 } },
    sign: { x: 140, y: 340, w: 440, h: 520 },
    figures: [{ x: 0, y: 660, w: 220, h: 330 }, { x: 500, y: 660, w: 220, h: 330 }],
    plates: [{ x: 12, y: 994, w: 200, h: 66 }, { x: 508, y: 994, w: 200, h: 66 }],
    banner: { x: 40, y: 560, w: 640, h: 92 },
    wire: { x: 110, y: 256, w: 500, h: 64 },
    hud: { x: 150, y: 160, w: 420, h: 60 },
    call: { x: 20, y: 232, w: 680, h: 96 },
    bubbles: [{ x: 20, y: 576, w: 180, h: 80 }, { x: 520, y: 576, w: 180, h: 80 }],
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
    hud: shiftRect(g.hud, dx),
    call: shiftRect(g.call, dx),
    bubbles: [shiftRect(g.bubbles[0], dx), shiftRect(g.bubbles[1], dx)],
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

/** What the sign holds while the stakes are still on their way after the walk-out: one word per `OPEN_STEPS` step. */
const HOLD_WORDS: readonly string[] = ["HOLD…", "SENT…", "BLOCK", "BLOCK"];
/** How far each steps back off its mark and in again while it waits (stage pixels), and how long a step takes. */
const MILL_STEP = 26;
const MILL_STEP_MS = 760;
/** The pause between the waiting moves, and every how many moves an idle beat (a gun check, a hat) comes. */
const MILL_REST_MS = 900;
const MILL_BEAT_EVERY = 3;
/** A tumbleweed blows through every this many waiting moves. */
const MILL_WEED_EVERY = 8;
/** How far the sun sinks over a long wait (stage pixels), and over how long. */
const SUN_SINK = 26;
const SUN_SINK_MS = 40_000;
/** The rays behind the sign's board: how far out from its middle they reach. */
const RAYS = 860;

/** The call strip's tones: neutral while counting and waiting, red on a decoy, green on the draw. */
type Tone = "count" | "wait" | "decoy" | "draw" | "won" | "foul" | "again";

/** What a seat's plate reads once a round is decided. */
function verdict(s: QuickDrawState, seat: Seat): { readonly ms: number } | { readonly word: string; readonly early: boolean } {
  const tap = s.taps[seat];
  if (tap !== null && tap < s.drawAt) return { word: "FOUL!", early: true };
  const ms = reactionMs(s, seat);
  if (ms !== null) return { ms };
  // No tap: the other player fouled (this one held), nobody drew, or the other drew first (this one was too slow).
  return { word: s.reason === "early" ? "HELD FIRE" : s.reason === "slow" ? "NO DRAW" : "TOO SLOW", early: false };
}

/** The phase, standoff by standoff: a new standoff is a new scene even when its phase name repeats. */
const keyOf = (s: QuickDrawState): string => `${s.standoff}:${s.phase}`;

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

  const makePlate = (seat: Seat): HTMLElement => {
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

  // The round and the rounds won: PLAYER 1's pips, ROUND n / BEST OF 3, PLAYER 2's pips.
  const hud = el("div", "qd-hud");
  place(hud, g.hud);
  /** Each seat's pips, in the order they fill: outward from the seat's tag. */
  const pipRow = (seat: Seat): { readonly row: HTMLElement; readonly dots: readonly HTMLElement[] } => {
    const row = el("span", `qd-hud-pips qd-hud-pips--p${seat + 1}`);
    const dots = Array.from({ length: ROUNDS_TO_WIN }, () => el("i", "qd-hud-pip"));
    const tag = el("span", "qd-hud-tag", `P${seat + 1}`);
    if (seat === 0) row.append(tag, ...dots);
    else row.append(...[...dots].reverse(), tag);
    return { row, dots };
  };
  const pips = [pipRow(0), pipRow(1)] as const;
  const hudRound = el("span", "qd-hud-round");
  const hudBest = el("span", "qd-hud-best", "BEST OF 3");
  const hudMiddle = el("span", "qd-hud-middle");
  hudMiddle.append(hudRound, hudBest);
  hud.append(pips[0].row, hudMiddle, pips[1].row);

  // The call: what to do now, in big words, coloured by what it means.
  const call = el("div", "qd-call");
  place(call, g.call);
  const callBig = el("span", "qd-call-big");
  const callSmall = el("span", "qd-call-small");
  call.append(callBig, callSmall);

  // Over each head: TAP! on the draw, DON'T! on a decoy.
  const bubbles = ([0, 1] as const).map((seat) => {
    const bubble = el("div", `qd-bubble qd-bubble--p${seat + 1}`);
    place(bubble, g.bubbles[seat]);
    return bubble;
  });

  // Rays burst behind the sign's board when it turns to DRAW.
  const rays = el("div", "qd-rays");
  place(rays, { x: g.sign.x + g.sign.w / 2 - RAYS, y: g.sign.y + 88 - RAYS, w: RAYS * 2, h: RAYS * 2 });

  // A tumbleweed blows across behind the walk, once.
  const weed = el("div", "qd-weed");
  place(weed, { x: -80, y: g.scene.horizon + 18, w: 56, h: 56 });

  // The figures stand in front of the sign: they start back to back at its post.
  root.append(scene.el, weed, dim, vignette, flash, flashLine, rays, sign.el, ...figures.map((f) => f.el), ...plates, call, ...bubbles, banner, wire, hud);

  /** The standoff and phase on screen (`keyOf`), and its phase. */
  let shownKey = "";
  let shown: QuickDrawPhase | null = null;
  let drawn = false;
  /** Timers for the moments inside a phase (the count's beats, the decoys): cleared when the phase moves on. */
  let later: ReturnType<typeof setTimeout>[] = [];
  let alive = true;
  let heart: Animation[] = [];
  let quicken: ReturnType<typeof setTimeout> | undefined;
  let dimming: Animation | null = null;
  /** The walk-out: `walking` while it runs or the two wait on their marks after it (a newer phase stops it), `walked`
   *  once it began on this screen. */
  let walking = false;
  let walked = false;
  /** The sign follows the transaction (the walk is done, the stakes aren't in), and the word it holds. */
  let holding = false;
  let held = "";
  let sinking: Animation | null = null;
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

  /** While holding, the sign says how far the stakes have got. */
  function holdSign(): void {
    if (!holding) return;
    const word = HOLD_WORDS[Math.max(0, wireTx ? openStepIndex(wireTx) : 0)] ?? HOLD_WORDS[0] ?? "";
    if (word === held) return;
    held = word;
    sign.say(word);
  }

  /** A tumbleweed blows across the land behind the two, once. */
  function blowWeed(delay: number): void {
    void play(weed, [
      { transform: "translate(0, 0) rotate(0deg)" },
      { transform: `translate(${g.scene.width * 0.3}px, -22px) rotate(300deg)`, offset: 0.28 },
      { transform: `translate(${g.scene.width * 0.55}px, 0) rotate(560deg)`, offset: 0.5 },
      { transform: `translate(${g.scene.width * 0.8}px, -14px) rotate(820deg)`, offset: 0.74 },
      { transform: `translate(${g.scene.width + 160}px, 0) rotate(1120deg)` },
    ], { duration: 9000, delay, easing: "linear" });
  }

  /** One idle beat for a figure while the two wait: a gun checked (with its click) or the hat touched. The gun check
   *  settles the hand, so the breathing starts again after it. */
  async function idleBeat(seat: Seat, n: number): Promise<void> {
    const f = figures[seat];
    await ((n + seat) % 2 === 0 ? f.cock(() => ctx.sound.play("cock", { seat })) : f.tipHat());
    if (walking && alive) f.breathe();
  }

  /** After the walk-out, until the stakes are in: each steps back off its mark and in again, slowly, with an idle beat
   *  every few moves and a tumbleweed now and then, while the sun sinks. Stops wherever it is once `walking` drops. */
  async function mill(): Promise<void> {
    sinking = scene.sun.animate([{ translate: "0 0" }, { translate: `0 ${SUN_SINK}px` }], { duration: SUN_SINK_MS, easing: "linear", fill: "forwards" });
    for (let n = 1; walking && alive; n++) {
      // Back off the mark (away from the other figure), then in again: Player 2's back is to the right.
      await Promise.all(figures.map((f, seat) => f.pace(0, seat === 0 ? -MILL_STEP : MILL_STEP, MILL_STEP_MS, 0)));
      if (!walking || !alive) return;
      await Promise.all(figures.map((f, seat) => f.pace(seat === 0 ? -MILL_STEP : MILL_STEP, 0, MILL_STEP_MS, 1)));
      if (!walking || !alive) return;
      await Promise.all(figures.map((f) => f.plant(200)));
      if (n % MILL_WEED_EVERY === 0) blowWeed(0);
      // The beat comes to one figure, then the other a little later, so the two never move as one.
      if (n % MILL_BEAT_EVERY === 0) {
        await Promise.all(([0, 1] as const).map(async (seat) => {
          await wait(seat * 520);
          if (walking && alive) await idleBeat(seat, n / MILL_BEAT_EVERY);
        }));
      }
      await wait(MILL_REST_MS);
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
      holding = true;
      holdSign();
      return;
    }
    figures.forEach((f, seat) => f.stand(startOffsets[seat] ?? 0, true));
    sign.say("PACES");
    blowWeed(900);
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
      await f.cock(() => ctx.sound.play("cock", { seat: seat as Seat }));
    }));
    if (!walking || !alive) return;
    // Ready to draw, but the stakes aren't in yet: the sign follows them, and the two wait on their marks.
    holding = true;
    holdSign();
    for (const f of figures) f.breathe();
    await mill();
  }

  /** The stakes are in: the walk-out (or the wait after it) stops, and the two get to their marks if they aren't there
   *  yet. The sun stays where it sank to. */
  async function endWalk(): Promise<void> {
    hideWire();
    holding = false;
    sinking?.pause();
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

  /** Runs `fn` when the Box's clock reaches `time` (at once if it has), unless the phase has moved on by then. */
  function at(time: number, fn: () => void): void {
    later.push(setTimeout(() => {
      if (alive) fn();
    }, Math.max(0, time - ctx.link.now())));
  }

  function clearLater(): void {
    for (const t of later) clearTimeout(t);
    later = [];
  }

  /** Eases the light to `to`, from wherever the dimming has got to. */
  function light(to: number, ms: number): void {
    const from = Number(getComputedStyle(dim).opacity);
    dimming?.cancel();
    dim.style.opacity = String(to);
    dimming = ctx.calm ? null : dim.animate([{ opacity: from }, { opacity: to }], { duration: ms, easing: "ease-out" });
  }

  /** The call strip says `big` and `small` in `tone`, with a knock when the words change. */
  function say(tone: Tone, big: string, small: string): void {
    const same = call.dataset["tone"] === tone && callBig.textContent === big && callSmall.textContent === small;
    call.dataset["tone"] = tone;
    callBig.textContent = big;
    callSmall.textContent = small;
    if (!call.classList.contains("is-up")) {
      call.classList.add("is-up");
      void play(call, [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: "ease-out" });
    } else if (!same) {
      void play(call, [{ transform: "scale(1)" }, { transform: "scale(1.06)", offset: 0.35 }, { transform: "scale(1)" }], { duration: 260, easing: "ease-out" });
    }
  }

  function hideCall(): void {
    if (!call.classList.contains("is-up")) return;
    call.classList.remove("is-up");
    void play(call, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease-in" });
  }

  /** Both bubbles show `word` in `tone` (bouncing), or go away. */
  function bubble(tone: "draw" | "decoy" | null, word = ""): void {
    for (const b of bubbles) {
      for (const a of b.getAnimations()) a.cancel();
      b.dataset["tone"] = tone ?? "";
      b.textContent = word;
      b.classList.toggle("is-up", tone !== null);
      if (tone && !ctx.calm) {
        b.animate([
          { transform: "translateY(10px) scale(0.6)" },
          { transform: "translateY(-6px) scale(1.12)", offset: 0.4 },
          { transform: "none" },
        ], { duration: 260, easing: "ease-out" });
        if (tone === "draw") {
          b.animate([{ transform: "none" }, { transform: "translateY(-8px) scale(1.06)" }, { transform: "none" }], { duration: 420, delay: 260, iterations: Infinity, easing: "ease-in-out" });
        }
      }
    }
  }

  /** The round and each seat's rounds won; a pip just won pops. */
  function showHud(s: QuickDrawState): void {
    hudRound.textContent = s.phase === "done" ? "FINAL" : `ROUND ${s.round}`;
    ([0, 1] as const).forEach((seat) => {
      pips[seat].dots.forEach((dot, i) => {
        const won = i < s.score[seat];
        if (won && !dot.classList.contains("is-won") && !ctx.calm) {
          void play(dot, [{ transform: "scale(0.2)" }, { transform: "scale(1.7)", offset: 0.5 }, { transform: "none" }], { duration: 480, easing: "ease-out" });
        }
        dot.classList.toggle("is-won", won);
      });
    });
    if (!hud.classList.contains("is-up")) {
      hud.classList.add("is-up");
      void play(hud, [{ opacity: 0, transform: "translateY(-14px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "ease-out" });
    }
  }

  function clearPlates(): void {
    for (const node of [...plates, banner]) for (const a of node.getAnimations()) a.cancel();
  }

  /** A round is counted in: everyone back on their marks, the sign counts 3, 2, 1, the call says get ready. */
  function countIn(s: QuickDrawState): void {
    drawn = false;
    stopHeart();
    clearPlates();
    bubble(null);
    for (const a of rays.getAnimations()) a.cancel();
    sign.reset();
    showHud(s);
    say("count", `ROUND ${s.round}`, "GET READY · TAP YOUR BADGE ON DRAW!");
    if (s.standoff === 1) {
      // The first round: the walk-out (or the wait after it) ends and the two take their marks.
      void endWalk().then(() => {
        if (!alive || shown !== "count") return;
        for (const f of figures) {
          f.idle();
          f.breathe();
        }
      });
    } else {
      // A later round: the fallen and the scorched stand up on their marks again.
      for (const f of figures) {
        f.idle();
        f.breathe();
        if (!ctx.calm) void play(f.el, [{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: "ease-out" });
      }
    }
    light(0, 500);
    for (const n of [3, 2, 1]) {
      const beat = s.startedAt - n * 1000;
      if (ctx.link.now() >= beat + 1000) continue;
      at(beat, () => {
        if (shown !== "count") return;
        sign.say(String(n));
        ctx.sound.play("count", { pitch: (3 - n) / 2 });
      });
    }
  }

  /** The wait: WAIT… on the sign, DON'T TAP on the strip, the light dimming, the heartbeat, and any decoys. */
  function standoff(s: QuickDrawState): void {
    drawn = false;
    sign.reset();
    showHud(s);
    say("wait", "WAIT…", "DON'T TAP YET · ONLY ON DRAW");
    // Joined in the middle of a match (the screen reloaded): the two stand on their marks.
    if (!walked) for (const f of figures) {
      f.idle();
      f.breathe();
    }
    clearPlates();
    stopHeart();
    dimming?.cancel();
    const now = ctx.link.now();
    for (const decoy of s.decoys) {
      if (now >= decoy.at + DECOY_MS) continue;
      at(decoy.at, () => {
        if (shown !== "wait" || drawn) return;
        sign.decoy(decoy.word);
        say("decoy", "NOT YET!", `${decoy.word} IS NOT DRAW · DON'T TAP`);
        bubble("decoy", "DON'T!");
        if (!ctx.calm) void play(vignette, [{ opacity: 0.5 }, { opacity: 1, offset: 0.2 }, { opacity: 0.5 }], { duration: DECOY_MS, easing: "ease-out" });
      });
      at(decoy.at + DECOY_MS, () => {
        if (shown !== "wait" || drawn) return;
        sign.reset();
        say("wait", "WAIT…", "DON'T TAP YET · ONLY ON DRAW");
        bubble(null);
      });
    }
    const elapsed = Math.min(Math.max(now - s.startedAt, 0), MAX_WAIT_MS);
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

  /** DRAW: the sign turns to gold, the land flashes, rays burst, the strip goes green and TAP! bounces overhead. */
  async function draw(instant: boolean): Promise<void> {
    if (drawn) return;
    drawn = true;
    stopHeart();
    clearLater();
    light(DIM_DRAWN, 140);
    say("draw", "DRAW! TAP NOW!", "FIRST BADGE TO TAP WINS THE ROUND");
    bubble("draw", "TAP!");
    if (!instant && !ctx.calm) {
      void play(flash, [{ opacity: 0 }, { opacity: 0.85, offset: 0.12 }, { opacity: 0 }], { duration: 620, easing: "ease-out" });
      void play(flashLine, [
        { opacity: 0, transform: "scaleX(0.12)" },
        { opacity: 1, transform: "scaleX(1)", offset: 0.25 },
        { opacity: 0, transform: "scaleX(1)" },
      ], { duration: 760, easing: "ease-out" });
      rays.animate([
        { opacity: 0, transform: "scale(0.3) rotate(0deg)" },
        { opacity: 1, transform: "scale(1) rotate(8deg)", offset: 0.2 },
        { opacity: 0.75, transform: "scale(1.05) rotate(40deg)" },
      ], { duration: 4000, easing: "ease-out", fill: "forwards" });
    } else {
      rays.animate([{ opacity: 0.75 }], { duration: 1, fill: "forwards" });
    }
    await sign.flip(instant);
  }

  function fillPlate(seat: Seat, s: QuickDrawState): void {
    const plate = plates[seat];
    const v = verdict(s, seat);
    const value = el("span", "qd-plate-value");
    if ("ms" in v) value.append(el("span", "qd-plate-ms", String(Math.round(v.ms))), el("span", "qd-plate-unit", "MS"));
    else value.append(el("span", `qd-plate-word${v.early ? " is-early" : ""}`, v.word));
    plate.replaceChildren(el("span", "qd-plate-label", `PLAYER ${seat + 1}`), value);
    plate.classList.toggle("is-winner", s.took === seat);
  }

  /** What the strip says once the standoff is decided. */
  function sayDecided(s: QuickDrawState): void {
    const foul = fouler(s);
    const took = s.took;
    if (foul !== null && took !== null) say("foul", "FOUL! GUN BLEW UP", `PLAYER ${foul + 1} TAPPED BEFORE DRAW · ROUND TO PLAYER ${took + 1}`);
    else if (took !== null) say("won", `PLAYER ${took + 1} TAKES ROUND ${s.round}`, `${Math.round(reactionMs(s, took) ?? 0)} MS · FIRST TO 2 WINS`);
    else if (s.reason === "heat") say("again", "DEAD HEAT", "SAME MILLISECOND · ROUND AGAIN");
    else say("again", "NOBODY DREW", "ROUND AGAIN");
  }

  /** A standoff is decided: the shot or the blown-up gun, the plates, the strip, the pips; at the end, the plank. */
  async function decided(s: QuickDrawState, instant: boolean): Promise<void> {
    stopHeart();
    clearLater();
    const foul = fouler(s);
    const turned = s.reason === "first" || s.reason === "slow" || (s.reason === "heat" && (s.taps[0] ?? 0) >= s.drawAt);
    if (turned) await draw(instant);
    else {
      light(DIM_DONE, 360);
      // A foul says so on the sign, in red.
      if (foul !== null) sign.decoy("FOUL");
      else if (!instant) sign.rattle();
    }
    if (!alive) return;
    bubble(null);
    sayDecided(s);
    showHud(s);
    fillPlate(0, s);
    fillPlate(1, s);
    if (!instant) await wait(120);
    if (!alive) return;
    if (turned) light(DIM_DONE, 600);
    if (foul !== null) {
      void figures[foul].explode();
      if (!instant && !ctx.calm) {
        void play(root, [
          { transform: "none" }, { transform: "translate(-9px, 4px)", offset: 0.15 }, { transform: "translate(8px, -5px)", offset: 0.3 },
          { transform: "translate(-5px, 3px)", offset: 0.5 }, { transform: "translate(3px, -1px)", offset: 0.7 }, { transform: "none" },
        ], { duration: 460, delay: 100, easing: "ease-out" });
      }
    } else if (s.took !== null && s.reason === "first") {
      void figures[s.took].win();
      figures[other(s.took)].lose();
    }
    plates.forEach((plate, i) => {
      void play(plate, [
        { opacity: 0, transform: "translateY(-18px) rotate(-3deg)" },
        { opacity: 1, transform: "none" },
      ], { duration: 420, delay: 260 + i * 90, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", fill: "forwards" });
    });
    if (s.phase !== "done") return;
    // The match is over: the plank names the winner over the strip.
    const w = s.winner;
    banner.classList.toggle("qd-banner--p1", w === 0);
    banner.classList.toggle("qd-banner--p2", w === 1);
    banner.classList.toggle("qd-banner--none", w === null);
    bannerText.textContent = w === null ? `NO WINNER ${s.score[0]}–${s.score[1]}` : `PLAYER ${w + 1} WINS ${s.score[w]}–${s.score[other(w)]}`;
    if (!instant) await wait(1100);
    if (!alive) return;
    hideCall();
    void play(banner, [
      { opacity: 0, transform: "translateY(-56px) rotate(-5deg)" },
      { opacity: 1, transform: "translateY(4px) rotate(0.8deg)", offset: 0.7 },
      { opacity: 1, transform: "none" },
    ], { duration: 560, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" });
  }

  function show(s: QuickDrawState, instant: boolean): void {
    const key = keyOf(s);
    if (key === shownKey) return;
    shownKey = key;
    shown = s.phase;
    clearLater();
    switch (s.phase) {
      case "count":
        return countIn(s);
      case "wait":
        return standoff(s);
      case "draw":
        void draw(instant);
        return;
      case "round":
      case "done":
        void decided(s, instant);
    }
  }

  return {
    el: root,

    update(state: BoxState, event: BoxEvent) {
      if (state.phase === "stake") {
        // Both have signed: the stakes are on their way into the pot.
        if (event.type === "tap" && event.accepted) figures[event.seat].twitch();
        showWire(state);
        holdSign();
        if (!walked) void walkOut();
        return;
      }
      const s = quickDraw(state);
      if (!s) return;
      if (event.type === "tap" && event.accepted) figures[event.seat].twitch();
      if (event.type === "cue" && event.cue === "draw" && shown === "wait") {
        shownKey = `${s.standoff}:draw`;
        shown = "draw";
        void draw(false);
      }
      show(s, event.type === "init");
    },

    dispose() {
      alive = false;
      walking = false;
      clearLater();
      if (wireTicker !== null) clearInterval(wireTicker);
      stopHeart();
      for (const a of root.getAnimations({ subtree: true })) a.cancel();
    },
  };
};
