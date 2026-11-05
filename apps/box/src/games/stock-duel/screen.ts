// Stock Duel's screen: a painted study that comes alive. Each player's hand turns on a Rolodex on their side of the
// desk (Player 1 left in warm lamplight, Player 2 right in cyan); a tap plays the front card, which slides face down
// onto the blotter. Once both cards are down the brass astrolabe picks the stat, the cards turn over together, and
// wax seals finalize the winner and slash the loser. First to two rounds; the final reveal stays under a brass banner.
//
// It draws from `state.match.play` and animates the moment each state change brings. The drums follow the clock, so
// while anyone is picking a frame loop turns them and drains the rings; it stops as soon as nothing moves.
import "./stock-duel.css";
import type { Layout, Point, Rect } from "../../screen/shell/layout.ts";
import type { ViewFactory } from "../../screen/views/view.ts";
import type { Seat } from "../seat.ts";
import type { StockDuelState } from "./types.ts";
import { el, place } from "../../screen/shell/dom.ts";
import { SEATS } from "../seat.ts";
import { DEAL_MS, frontIndex, frontRemainingMs } from "./rules.ts";
import { createScene, type ScenePlaces } from "./scene.ts";
import { createRolodex, type Placement } from "./rolodex.ts";
import { createDial } from "./dial.ts";
import { createReveal } from "./reveal.ts";
import { createStanding, type StandingPlaces } from "./score.ts";

interface Geometry {
  readonly scene: ScenePlaces;
  readonly rolodex: readonly [Placement, Placement];
  readonly dial: { readonly centre: Point; readonly radius: number };
  /** Where each seat's played card lies on the blotter. */
  readonly rests: readonly [Rect, Rect];
  readonly standing: StandingPlaces;
}

// Landscape: the Rolodexes stand at the two ends of the desk, the astrolabe hangs on the wall between them, and the
// played cards lie on the blotter under it. The top 130 px stay clear for the Box's overlay.
const LANDSCAPE: Geometry = {
  scene: {
    width: 1280,
    height: 800,
    desk: 452,
    blotter: { x: 372, y: 440, w: 536, h: 340 },
    lamps: [{ x: 78, y: 182 }, { x: 1202, y: 182 }],
    pools: [
      { centre: { x: 210, y: 560 }, rx: 330, ry: 250 },
      { centre: { x: 1070, y: 560 }, rx: 330, ry: 250 },
    ],
  },
  rolodex: [{ x: 25, y: 255, scale: 1.2 }, { x: 895, y: 255, scale: 1.2 }],
  dial: { centre: { x: 640, y: 285 }, radius: 128 },
  rests: [{ x: 403, y: 458, w: 230, h: 290 }, { x: 647, y: 458, w: 230, h: 290 }],
  standing: {
    tallies: [{ x: 55, y: 712, w: 300, h: 46 }, { x: 925, y: 712, w: 300, h: 46 }],
    round: { x: 555, y: 418, w: 170, h: 32 },
    banner: { x: 290, y: 222, w: 700, h: 124 },
  },
};

// Portrait: the two Rolodexes side by side at the top, the astrolabe in the middle with the tallies either side, and
// the played cards along the bottom. The top 150 px stay clear for the Box's overlay.
const PORTRAIT: Geometry = {
  scene: {
    width: 720,
    height: 1080,
    desk: 540,
    blotter: { x: 96, y: 772, w: 528, h: 330 },
    lamps: [{ x: 50, y: 158 }, { x: 670, y: 158 }],
    pools: [
      { centre: { x: 180, y: 460 }, rx: 250, ry: 300 },
      { centre: { x: 540, y: 460 }, rx: 250, ry: 300 },
    ],
  },
  rolodex: [{ x: 30, y: 188, scale: 1 }, { x: 390, y: 188, scale: 1 }],
  dial: { centre: { x: 360, y: 650 }, radius: 96 },
  rests: [{ x: 124, y: 786, w: 230, h: 290 }, { x: 366, y: 786, w: 230, h: 290 }],
  standing: {
    tallies: [{ x: 20, y: 628, w: 226, h: 46 }, { x: 474, y: 628, w: 226, h: 46 }],
    round: { x: 288, y: 752, w: 144, h: 30 },
    banner: { x: 30, y: 586, w: 660, h: 124 },
  },
};

/** The deal drops one card on each drum in turn, the two drums half a beat apart. */
function dealDelays(seat: Seat, cards: number, elapsedMs: number): number[] {
  const beat = (DEAL_MS - 600) / Math.max(1, cards);
  return Array.from({ length: cards }, (_, k) => k * beat + seat * (beat / 2) - elapsedMs);
}

/** How long a lamp stays bright: a quick flare for a play, a longer one for a won round. */
const FLARE_PLAY_MS = 300;
const FLARE_WIN_MS = 1400;

export const stockDuelScreen: ViewFactory = (ctx) => {
  const geo: Geometry = ctx.layout.orientation === "portrait" ? PORTRAIT : LANDSCAPE;
  const root = el("div", "sd");
  root.dataset.orientation = ctx.layout.orientation;
  place(root, { x: 0, y: 0, w: ctx.layout.width, h: ctx.layout.height });

  const scene = createScene(geo.scene);
  const dial = createDial(geo.dial.centre, geo.dial.radius);
  const drums = [createRolodex(0, geo.rolodex[0], ctx.sound), createRolodex(1, geo.rolodex[1], ctx.sound)] as const;
  const reveal = createReveal(geo.rests);
  const standing = createStanding(geo.standing);
  root.append(scene.el, dial.el, reveal.el, drums[0].el, drums[1].el, ...standing.els);

  let last: StockDuelState | null = null;
  let matchId: number | null = null;
  let frame = 0;
  let alive = true;

  /** One frame of the pick: each drum turns to the card the clock puts in front, and its ring drains. */
  function tick(): void {
    frame = 0;
    const s = last;
    if (!alive || !s || s.phase !== "pick") return;
    const now = Date.now();
    for (const seat of SEATS) {
      drums[seat].turnTo(frontIndex(s, seat, now));
      drums[seat].drain(frontRemainingMs(s, seat, now) / s.dwellMs);
    }
    frame = requestAnimationFrame(tick);
  }
  function run(): void {
    if (!frame && alive) frame = requestAnimationFrame(tick);
  }

  /** What each plinth says: the waiting seat is told to tap, and warned once its partner has played. */
  function notes(s: StockDuelState): void {
    for (const seat of SEATS) {
      const picking = s.phase === "pick" && s.played[seat] === null;
      const text = picking ? (s.deadline !== null ? "LAST TURN" : "TAP TO PLAY") : "";
      drums[seat].note(text, picking && s.deadline !== null);
    }
  }

  /** Draws a state as it stands, for a screen joining mid-match. Moments already under way carry on from now. */
  function draw(s: StockDuelState): void {
    const now = Date.now();
    reveal.clear(false);
    for (const seat of SEATS) {
      const front = frontIndex(s, seat, now);
      if (s.phase === "deal") drums[seat].deal(s.hands[seat], front, dealDelays(seat, s.hands[seat].length, now - s.phaseAt));
      else drums[seat].show(s.hands[seat], front, false, s.played[seat]);
      drums[seat].drain(s.phase === "pick" ? frontRemainingMs(s, seat, now) / s.dwellMs : 0);
    }
    const record = s.history[s.history.length - 1];
    if (s.phase === "pick" || s.phase === "dial") {
      for (const seat of SEATS) if (s.played[seat] !== null) reveal.place(seat, s.auto[seat], null);
    }
    if (s.phase === "dial" && s.stat !== null) void dial.spin(s.stat, now - s.phaseAt);
    else if ((s.phase === "reveal" || s.phase === "over") && record) {
      dial.show(record.stat);
      void reveal.flip(record, false);
    } else dial.rest();
    standing.set(s.score, s.round, false);
    if (s.phase === "over") {
      standing.finish(s.winner, false);
      scene.hold(s.winner);
    }
  }

  /** Animates what changed between two states of the same match. */
  function step(prev: StockDuelState, s: StockDuelState): void {
    const now = Date.now();
    // Cards put down by this change: each lifts off its drum and slides face down onto the blotter.
    for (const seat of SEATS) {
      const card = s.played[seat];
      if (prev.played[seat] !== null || card === null) continue;
      reveal.place(seat, s.auto[seat], drums[seat].lift(card));
      scene.flare(seat, FLARE_PLAY_MS);
    }
    if (prev.phase === s.phase) return;
    switch (s.phase) {
      case "deal":
        draw(s);
        return;
      case "pick":
        if (prev.phase !== "deal") {
          reveal.clear(true);
          dial.rest();
          for (const seat of SEATS) drums[seat].show(s.hands[seat], frontIndex(s, seat, now), true, null);
        }
        standing.set(s.score, s.round, false);
        return;
      case "dial":
        if (s.stat !== null) void dial.spin(s.stat, now - s.phaseAt);
        return;
      case "reveal": {
        const record = s.history[s.history.length - 1];
        if (!record) return;
        dial.show(record.stat);
        void reveal.flip(record, true).then(() => {
          if (!alive) return;
          standing.set(s.score, s.round, true);
          if (record.winner !== null) scene.flare(record.winner, FLARE_WIN_MS);
        });
        return;
      }
      case "over":
        for (const seat of SEATS) drums[seat].show(s.hands[seat], 0, true, null);
        standing.set(s.score, s.round, false);
        standing.finish(s.winner, true);
        scene.hold(s.winner);
        return;
    }
  }

  return {
    el: root,
    update(state) {
      const match = state.match;
      if (!match || match.play.game !== "stock-duel") return;
      const s = match.play.state;
      if (s === last) return;
      const prev = last;
      last = s;
      if (prev === null || match.id !== matchId) draw(s);
      else step(prev, s);
      matchId = match.id;
      notes(s);
      if (s.phase === "pick") run();
    },
    dispose() {
      alive = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      for (const drum of drums) drum.dispose();
      dial.dispose();
      reveal.dispose();
    },
  };
};
