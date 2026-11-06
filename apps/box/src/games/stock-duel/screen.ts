// Stock Duel's screen, in the Slab look: a dark room with each player's colour pooling up from their side. Each
// player's hand turns on a Rolodex on their side (Player 1 left, Player 2 right); a tap plays the front card, which
// flies face down into its well on the tray in the middle. Once both cards are down the stat wheel spins to the stat,
// the cards turn over together, the winner's card lifts and the loser's sinks. First to two rounds; the final reveal
// stays under a slab naming the winner. The game draws the top band itself (the route's "full" pose): the players,
// their stakes and pips, the round and the pot.
//
// Before the match, while both stakes go into the pot, it shows the pre-market (premarket.ts) and rings the opening
// bell when they are confirmed on chain; the deal follows.
//
// It draws from `state.match.play` and animates the moment each state change brings. The drums follow the clock, so
// while anyone is picking a frame loop turns them and drains the rings; it stops as soon as nothing moves.
import { stakeOf } from "../../core/catalogue.ts";
import "./stock-duel.css";
import type { BoxState } from "../../core/types.ts";
import { shiftPoint, shiftRect, type Layout, type Point, type Rect } from "../../screen/shell/layout.ts";
import type { ViewFactory } from "../../screen/views/view.ts";
import type { DuelSeat } from "@egb/sdk";
import type { StockDuelState } from "./types.ts";
import { playerLabel, playerName } from "../../core/badges.ts";
import { el, place } from "../../screen/shell/dom.ts";
import { DUEL_SEATS, isDuelSeat } from "@egb/sdk";
import { DEAL_MS, frontIndex, frontRemainingMs } from "./rules.ts";
import { createScene, type ScenePlaces } from "./scene.ts";
import { createRolodex, type NoteTone, type Placement } from "./rolodex.ts";
import { createDial } from "./dial.ts";
import { createReveal, type RevealPlaces } from "./reveal.ts";
import { createStanding, type Player, type StandingPlaces } from "./score.ts";
import { createPremarket } from "./premarket.ts";

interface Geometry {
  readonly scene: ScenePlaces;
  readonly rolodex: readonly [Placement, Placement];
  readonly dial: { readonly centre: Point; readonly radius: number };
  readonly reveal: RevealPlaces;
  readonly standing: StandingPlaces;
  /** The pre-market slab, over the wells while the stakes go in. */
  readonly premarket: Rect;
}

// Landscape: the players and the round across the top band, a Rolodex down each side, and the tray between them with
// the stat wheel over the two wells.
const LANDSCAPE: Geometry = {
  scene: {
    width: 1280,
    height: 800,
    tray: { x: 424, y: 128, w: 432, h: 652 },
    glows: [{ x: 170, y: 640 }, { x: 1110, y: 640 }],
    reach: { rx: 520, ry: 460 },
  },
  rolodex: [{ x: 22, y: 128, scale: 1 }, { x: 874, y: 128, scale: 1 }],
  dial: { centre: { x: 640, y: 224 }, radius: 74 },
  reveal: {
    rests: [{ x: 436, y: 352, w: 200, h: 324 }, { x: 644, y: 352, w: 200, h: 324 }],
    call: { x: 452, y: 694, w: 376, h: 64 },
  },
  standing: {
    plates: [{ x: 24, y: 20, w: 392, h: 84 }, { x: 864, y: 20, w: 392, h: 84 }],
    mid: { x: 440, y: 20, w: 400, h: 84 },
    banner: { x: 444, y: 140, w: 392, h: 166 },
  },
  premarket: { x: 444, y: 358, w: 392, h: 326 },
};

// Portrait: the players across the top, the two Rolodexes side by side under them, and the tray along the bottom
// with the wheel over the wells.
const PORTRAIT: Geometry = {
  scene: {
    width: 720,
    height: 1080,
    tray: { x: 110, y: 584, w: 500, h: 486 },
    glows: [{ x: 120, y: 640 }, { x: 600, y: 640 }],
    reach: { rx: 420, ry: 420 },
  },
  rolodex: [{ x: 53, y: 146, scale: 0.68 }, { x: 405, y: 146, scale: 0.68 }],
  dial: { centre: { x: 360, y: 640 }, radius: 48 },
  reveal: {
    rests: [{ x: 152, y: 744, w: 200, h: 292 }, { x: 368, y: 744, w: 200, h: 292 }],
    call: { x: 130, y: 1038, w: 460, h: 40 },
  },
  standing: {
    plates: [{ x: 16, y: 16, w: 336, h: 72 }, { x: 368, y: 16, w: 336, h: 72 }],
    mid: { x: 110, y: 96, w: 500, h: 44 },
    banner: { x: 130, y: 590, w: 460, h: 112 },
  },
  premarket: { x: 130, y: 740, w: 460, h: 300 },
};

/** Each seat's player as the band shows them: its ENS name (the badge's own until read), or PLAYER n before one sits. */
function playersOf(state: BoxState): readonly [Player, Player] {
  return DUEL_SEATS.map((seat): Player => {
    const badge = state.seats[seat]?.badge;
    const ens = state.seats[seat]?.ens ?? null;
    return badge ? { name: playerName(badge, ens), label: playerLabel(badge, ens) } : { name: `PLAYER ${seat + 1}`, label: `PLAYER ${seat + 1}` };
  }) as unknown as readonly [Player, Player];
}

/** The deal drops one card on each drum in turn, the two drums half a beat apart. */
function dealDelays(seat: DuelSeat, cards: number, elapsedMs: number): number[] {
  const beat = (DEAL_MS - 600) / Math.max(1, cards);
  return Array.from({ length: cards }, (_, k) => k * beat + seat * (beat / 2) - elapsedMs);
}

/** How long a player's glow stays bright: a quick flare for a play, a longer one for a won round. */
const FLARE_PLAY_MS = 300;
const FLARE_WIN_MS = 1400;

/** The geometry for `layout`: on the wide stage, the landscape one moved to the middle with the scene drawn across. */
function geometryFor(layout: Layout): Geometry {
  if (layout.orientation === "portrait") return PORTRAIT;
  const dx = layout.inset;
  if (dx === 0) return LANDSCAPE;
  const g = LANDSCAPE;
  return {
    scene: { ...g.scene, width: layout.width, tray: shiftRect(g.scene.tray, dx), glows: [shiftPoint(g.scene.glows[0], dx), shiftPoint(g.scene.glows[1], dx)] },
    rolodex: [{ ...g.rolodex[0], x: g.rolodex[0].x + dx }, { ...g.rolodex[1], x: g.rolodex[1].x + dx }],
    dial: { ...g.dial, centre: shiftPoint(g.dial.centre, dx) },
    reveal: { rests: [shiftRect(g.reveal.rests[0], dx), shiftRect(g.reveal.rests[1], dx)], call: shiftRect(g.reveal.call, dx) },
    standing: {
      plates: [shiftRect(g.standing.plates[0], dx), shiftRect(g.standing.plates[1], dx)],
      mid: shiftRect(g.standing.mid, dx),
      banner: shiftRect(g.standing.banner, dx),
    },
    premarket: shiftRect(g.premarket, dx),
  };
}

export const stockDuelScreen: ViewFactory = (ctx) => {
  const geo = geometryFor(ctx.layout);
  const root = el("div", "sd");
  root.dataset.orientation = ctx.layout.orientation;
  place(root, { x: 0, y: 0, w: ctx.layout.width, h: ctx.layout.height });

  const scene = createScene(geo.scene);
  const dial = createDial(geo.dial.centre, geo.dial.radius, ctx.sound);
  const drums = [createRolodex(0, geo.rolodex[0], ctx.sound), createRolodex(1, geo.rolodex[1], ctx.sound)] as const;
  let players: readonly [Player, Player] = playersOf(ctx.link.state());
  const reveal = createReveal(geo.reveal, (seat: DuelSeat) => players[seat].label, ctx.sound);
  const standing = createStanding(geo.standing);
  const premarket = createPremarket(geo.premarket);
  root.append(scene.el, dial.el, reveal.el, drums[0].el, drums[1].el, premarket.el, ...standing.els);

  let shownPlayers = "";
  let last: StockDuelState | null = null;
  let matchId: number | null = null;
  let frame = 0;
  let alive = true;

  /** One frame of the pick: each drum turns to the card the clock puts in front, and its ring drains. */
  function tick(): void {
    frame = 0;
    const s = last;
    if (!alive || !s || s.phase !== "pick") return;
    const now = ctx.link.now();
    for (const seat of DUEL_SEATS) {
      drums[seat].turnTo(frontIndex(s, seat, now));
      drums[seat].drain(frontRemainingMs(s, seat, now) / s.dwellMs);
    }
    frame = requestAnimationFrame(tick);
  }
  function run(): void {
    if (!frame && alive) frame = requestAnimationFrame(tick);
  }

  /** What each plinth says: the waiting seat is told to tap and warned once its partner has played (its well says so
   * too); a seat whose card is down is told so until the reveal. */
  function notes(s: StockDuelState): void {
    for (const seat of DUEL_SEATS) {
      const picking = s.phase === "pick" && s.played[seat] === null;
      const down = (s.phase === "pick" || s.phase === "dial") && s.played[seat] !== null;
      const last = picking && s.deadline !== null;
      const text = picking ? (last ? "LAST TURN" : "TAP TO PLAY") : down ? "CARD DOWN" : "";
      const tone: NoteTone = picking ? (last ? "hot" : "tap") : "quiet";
      drums[seat].note(text, tone);
      reveal.waiting(seat, last);
    }
  }

  /** The band's players and stakes, written only when they change. Before the match, the stake being staked. */
  function band(state: BoxState): void {
    const stake = state.match?.stake ?? (state.phase === "stake" ? stakeOf(state.playFor, state.stake) : null);
    const playFor = state.match?.playFor ?? state.playFor;
    players = playersOf(state);
    const key = `${players[0].name}|${players[1].name}|${stake}|${playFor}`;
    if (key === shownPlayers) return;
    shownPlayers = key;
    standing.players(players, stake, playFor);
  }

  /** Draws a state as it stands, for a screen joining mid-match. Moments already under way carry on from now. */
  function draw(s: StockDuelState): void {
    const now = ctx.link.now();
    reveal.clear(false);
    for (const seat of DUEL_SEATS) {
      const front = frontIndex(s, seat, now);
      if (s.phase === "deal") drums[seat].deal(s.hands[seat], front, dealDelays(seat, s.hands[seat].length, now - s.phaseAt));
      else drums[seat].show(s.hands[seat], front, false, s.played[seat]);
      drums[seat].drain(s.phase === "pick" ? frontRemainingMs(s, seat, now) / s.dwellMs : 0);
    }
    const record = s.history[s.history.length - 1];
    if (s.phase === "pick" || s.phase === "dial") {
      for (const seat of DUEL_SEATS) if (s.played[seat] !== null) reveal.place(seat, s.auto[seat], null);
      reveal.recall(record ?? null, s.history.length);
    }
    if (s.phase === "dial" && s.stat !== null) void dial.spin(s.stat, now - s.phaseAt, s.rolls);
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
    const now = ctx.link.now();
    // Cards put down by this change: each lifts off its drum and slides face down onto the blotter.
    for (const seat of DUEL_SEATS) {
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
          reveal.recall(s.history[s.history.length - 1] ?? null, s.history.length);
          dial.rest();
          for (const seat of DUEL_SEATS) drums[seat].show(s.hands[seat], frontIndex(s, seat, now), true, null);
        }
        standing.set(s.score, s.round, false);
        return;
      case "dial":
        if (s.stat !== null) void dial.spin(s.stat, now - s.phaseAt, s.rolls);
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
        for (const seat of DUEL_SEATS) drums[seat].show(s.hands[seat], 0, true, null);
        standing.set(s.score, s.round, false);
        standing.finish(s.winner, true);
        scene.hold(s.winner);
        return;
    }
  }

  return {
    el: root,
    update(state, event) {
      if (state.phase === "stake") {
        // Both have signed: the stakes are on their way into the pot.
        band(state);
        if (event.type === "tap" && isDuelSeat(event.seat)) standing.tap(event.seat, event.accepted);
        premarket.show(state);
        return;
      }
      const match = state.match;
      if (!match || match.play.game !== "stock-duel") return;
      band(state);
      if (event.type === "tap" && isDuelSeat(event.seat)) standing.tap(event.seat, event.accepted);
      if (event.type === "phase" && event.from === "stake") {
        ctx.sound.play("bell");
        void premarket.open();
      }
      const s = match.play.state;
      if (s === last) return;
      const prev = last;
      last = s;
      if (prev === null || match.id !== matchId) draw(s);
      else step(prev, s);
      matchId = match.id;
      // While the wheel picks the stat, the rest of the room dims.
      root.classList.toggle("rolling", s.phase === "dial");
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
      premarket.dispose();
    },
  };
};
