// One player's hand as a Rolodex: the cards stand upright on a graphite drum with the seat's colour in its end caps.
// Every card has an index tab sticking up from its top edge, each tab at its own place across the card, so all the
// hand's tickers show at once. The front card is face up: the stock's colour along its top, its ticker and name, a "?"
// that the draining ring runs round, and its four stats as bars ranked against the deck, so a player can wait for
// their strongest card. The drum indexes one card
// at a time: the front card turns back over the top and lands upright at the back, and the next card is at the front.
// A played card lifts off the drum toward the tray.
import type { Rect } from "../../screen/shell/layout.ts";
import type { Sound } from "../../screen/views/view.ts";
import type { DuelSeat } from "@egb/sdk";
import type { Stock } from "./types.ts";
import { SHOW_LAG_MS } from "./rules.ts";
import { calm, el } from "../../screen/shell/dom.ts";
import { STATS } from "./deck.ts";
import { statRow } from "./stat-bar.ts";

/** The Rolodex's drawn size, before it is scaled onto the stage. */
export const ROLODEX_W = 384;
export const ROLODEX_H = 640;

const CARDS_X = 42;
const CARD_TOP = 112;
const CARD_W = 300;
const CARD_H = 330;
/** How far each card behind the front stands above the one in front of it, so its top edge and tab show. */
const STEP = 26;
/** Each card further back is drawn this much smaller, for depth. */
const SHRINK = 0.035;
/** Tabs sit at four places across a card, one per card of a full hand. */
const TAB_SLOTS = 4;
const TAB_W = CARD_W / TAB_SLOTS;
/** How much darker each card further back is. */
const SHADE_PER_CARD = 0.24;
const SHADE_MAX = 0.5;
/** The ticker's widest run across the card, and its largest size. */
const TICKER_W = 176;
const TICKER_MAX = 44;
/** A drum step: the old front card tips over the top for half of it, the new one is in front at SHOW_LAG_MS. */
const TURN_MS = SHOW_LAG_MS * 2;
const DROP_MS = 420;
const LIFT_MS = 320;

/** What the plinth says: a call to tap, the last turn (lit), or a quiet line once the card is down. */
export type NoteTone = "tap" | "hot" | "quiet";

export interface Placement {
  /** The Rolodex's top-left corner on the stage, and its scale from the drawn size. */
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

export interface Rolodex {
  readonly el: HTMLElement;
  /** Puts the hand on the rail with `front` at the front. `played` is on the desk, not the rail. */
  show(hand: readonly Stock[], front: number, animate: boolean, played: Stock | null): void;
  /** The drum indexes to the hand's `front` card: one step turns the old front card over the top. */
  turnTo(front: number): void;
  /** The draining ring: the share of the front card's time still left (0 hides it). */
  drain(share: number): void;
  /** Deals the hand onto the rail, back card first; `delays` are each drop's start from now in ms, back card first. */
  deal(hand: readonly Stock[], front: number, delays: readonly number[]): void;
  /** The played card lifts off the rail. Returns where it stood, in stage pixels, for its flight to the desk. */
  lift(card: Stock): Rect;
  /** The plinth's line: what this seat can do now. "tap" and "hot" also light the front card's rim. */
  note(text: string, tone: NoteTone): void;
  dispose(): void;
}

interface Card {
  readonly el: HTMLElement;
  readonly shade: HTMLElement;
}

export function createRolodex(seat: DuelSeat, at: Placement, sound: Sound): Rolodex {
  const root = el("div", `sd-rx s${seat}`);
  root.style.left = `${at.x}px`;
  root.style.top = `${at.y}px`;
  root.style.width = `${ROLODEX_W}px`;
  root.style.height = `${ROLODEX_H}px`;
  root.style.transform = `scale(${at.scale})`;

  const cardsBox = el("div", "sd-rx-cards");
  const drum = el("div", "sd-rx-drum");
  drum.append(el("i", "sd-rx-axle"));
  const ring = createRing();
  const noteBox = el("div", "sd-rx-note");
  const noteEl = el("span");
  noteBox.append(noteEl);
  root.append(cardsBox, el("i", "sd-rx-rim"), ring.el, el("i", "sd-rx-foot"), drum, noteBox);

  const cards = new Map<string, Card>();
  /** Each card's tab place, fixed from the first time the card is seen, so a tab never jumps. */
  const slots = new Map<string, number>();
  let hand: readonly Stock[] = [];
  let front = 0;
  let onDesk: string | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function later(ms: number, fn: () => void): void {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  }

  function slotFor(stock: Stock): number {
    const known = slots.get(stock.ticker);
    if (known !== undefined) return known;
    const used = new Set(slots.values());
    let slot = 0;
    while (used.has(slot)) slot++;
    slots.set(stock.ticker, slot);
    return slot;
  }

  function cardFor(stock: Stock): Card {
    const existing = cards.get(stock.ticker);
    if (existing) return existing;
    const card = el("div", "sd-card");
    card.style.setProperty("--stock", stock.colour);
    card.style.setProperty("--stock-ink", inkOn(stock.colour));
    const tab = el("div", "sd-card-tab", stock.ticker);
    tab.style.left = `${(slotFor(stock) % TAB_SLOTS) * TAB_W + 2}px`;
    tab.style.width = `${TAB_W - 4}px`;
    const body = el("div", "sd-card-body");
    const ticker = el("b", "sd-card-ticker", stock.ticker);
    ticker.style.fontSize = `${tickerSize(stock.ticker)}px`;
    const stats = el("div", "sd-card-stats");
    stats.append(...STATS.map((stat) => statRow("div", stock, stat)));
    body.append(ticker, el("span", "sd-card-name", stock.name), stats, el("i", "sd-card-ask"));
    const shade = el("i", "sd-card-shade");
    card.append(tab, body, shade);
    cardsBox.append(card);
    const made = { el: card, shade };
    cards.set(stock.ticker, made);
    return made;
  }

  /** How far back a card stands. The played card has left the drum: the cards behind it close up. */
  function depthOf(index: number): number {
    const n = hand.length;
    if (n === 0) return 0;
    const depth = (index - front + n) % n;
    const gone = onDesk === null ? -1 : hand.findIndex((s) => s.ticker === onDesk);
    return gone >= 0 && depth > (gone - front + n) % n ? depth - 1 : depth;
  }

  function setDepth(card: Card, depth: number): void {
    card.el.style.transform = standing(depth);
    card.el.style.zIndex = String(10 - depth);
    card.shade.style.opacity = String(Math.min(SHADE_MAX, depth * SHADE_PER_CARD));
  }

  function layout(animate: boolean): void {
    cardsBox.classList.toggle("moving", animate && !calm());
    hand.forEach((stock, index) => {
      const card = cardFor(stock);
      card.el.classList.toggle("gone", stock.ticker === onDesk);
      setDepth(card, depthOf(index));
    });
  }

  function show(next: readonly Stock[], nextFront: number, animate: boolean, played: Stock | null): void {
    const keep = new Set(next.map((s) => s.ticker));
    for (const [ticker, card] of cards) {
      if (keep.has(ticker)) continue;
      card.el.getAnimations().forEach((a) => a.cancel());
      card.el.remove();
      cards.delete(ticker);
    }
    hand = next;
    front = next.length === 0 ? 0 : nextFront % next.length;
    onDesk = played?.ticker ?? null;
    layout(animate);
  }

  return {
    el: root,
    show,
    turnTo(nextFront) {
      const n = hand.length;
      if (n < 2 || nextFront === front) return;
      const old = hand[front];
      const stepped = nextFront === (front + 1) % n;
      front = nextFront % n;
      layout(true);
      const card = old ? cards.get(old.ticker) : undefined;
      if (!stepped || !card || calm()) return;
      // The old front card rises and tips back over the top of the drum, edge-on at the midpoint, then stands up
      // again at the back. It stays above the others until it is edge-on, then drops behind them.
      const back = -(n - 1) * STEP;
      const shrink = 1 - (n - 1) * SHRINK;
      card.el.style.zIndex = "20";
      card.el.animate(
        [
          { transform: "translate3d(0, 0, 0) scale(1) rotateX(0deg)", easing: "cubic-bezier(0.5, 0, 0.9, 0.6)" },
          { transform: `translate3d(0, ${back - 36}px, 0) scale(${(1 + shrink) / 2}) rotateX(82deg)`, offset: 0.5, easing: "cubic-bezier(0.1, 0.4, 0.3, 1)" },
          { transform: `translate3d(0, ${back}px, 0) scale(${shrink}) rotateX(0deg)` },
        ],
        { duration: TURN_MS },
      );
      later(TURN_MS / 2, () => {
        card.el.style.zIndex = String(10 - (n - 1));
      });
    },
    drain(share) {
      ring.set(share);
    },
    deal(next, nextFront, delays) {
      show(next, nextFront, false, null);
      const n = next.length;
      for (let k = 0; k < n; k++) {
        // k counts from the back card: the front card lands last, in front of the others.
        const stock = next[(front + n - 1 - k) % n];
        const delay = delays[k] ?? 0;
        if (!stock || delay + DROP_MS <= 0 || calm()) continue;
        const card = cardFor(stock);
        const depth = n - 1 - k;
        const shrink = 1 - depth * SHRINK;
        const drop = card.el.animate(
          [
            { transform: `translate3d(0, ${-depth * STEP - 150}px, 0) scale(${shrink})`, opacity: 0 },
            { transform: `translate3d(0, ${-depth * STEP + 6}px, 0) scale(${shrink})`, opacity: 1, offset: 0.75 },
            { transform: standing(depth), opacity: 1 },
          ],
          { duration: DROP_MS, delay: Math.max(0, delay), fill: "backwards", easing: "cubic-bezier(0.4, 0, 0.6, 1)" },
        );
        if (delay < 0) drop.currentTime = -delay;
        later(Math.max(0, delay + DROP_MS), () => sound.play("deal", { seat }));
      }
    },
    lift(card) {
      const index = hand.findIndex((s) => s.ticker === card.ticker);
      if (index >= 0 && index !== front) {
        front = index;
        layout(false);
      }
      ring.set(0);
      onDesk = card.ticker;
      const lifted = cards.get(card.ticker);
      if (lifted && !calm()) {
        lifted.el
          .animate([{ opacity: 1, transform: "translate3d(0, 0, 0)" }, { opacity: 0, transform: "translate3d(0, -64px, 0)" }], {
            duration: LIFT_MS,
            easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          })
          // Once it has left, the cards behind it step forward.
          .finished.then(() => layout(true), () => undefined);
      } else {
        layout(false);
      }
      return {
        x: at.x + CARDS_X * at.scale,
        y: at.y + CARD_TOP * at.scale,
        w: CARD_W * at.scale,
        h: CARD_H * at.scale,
      };
    },
    note(text, tone) {
      if (noteEl.textContent !== text) noteEl.textContent = text;
      if (noteEl.className !== tone) noteEl.className = tone;
      root.classList.toggle("picking", text !== "" && tone !== "quiet");
    },
    dispose() {
      timers.forEach(clearTimeout);
      timers.clear();
    },
  };
}

interface Ring {
  readonly el: HTMLElement;
  set(share: number): void;
}

/**
 * The draining ring, drawn with transforms only: two half-ring windows, each holding a half ring that rotates in
 * from the hidden side. The right window shows the first half of the arc, the left window the second.
 */
function createRing(): Ring {
  const ring = el("div", "sd-ring");
  const right = el("div", "sd-ring-half r");
  const left = el("div", "sd-ring-half l");
  const rightArc = el("i", "sd-ring-arc");
  const leftArc = el("i", "sd-ring-arc");
  right.append(rightArc);
  left.append(leftArc);
  ring.append(right, left, el("b", "sd-ring-q", "?"));
  let shown = -1;
  return {
    el: ring,
    set(share) {
      // Quarter-degree steps: enough to look smooth, few enough that most frames write nothing.
      const degrees = Math.round(Math.max(0, Math.min(1, share)) * 1440) / 4;
      if (degrees === shown) return;
      shown = degrees;
      ring.style.opacity = degrees > 0 ? "1" : "0";
      rightArc.style.transform = `rotate(${Math.min(180, degrees)}deg)`;
      leftArc.style.transform = `rotate(${Math.max(0, degrees - 180)}deg)`;
    },
  };
}

/** Where a card stands `depth` places behind the front: higher up the drum and a little smaller. */
function standing(depth: number): string {
  return `translate3d(0, ${-depth * STEP}px, 0) scale(${1 - depth * SHRINK})`;
}

/** The ticker's size: as large as fits across the card (Unbounded runs about 1.22 em a capital). */
function tickerSize(ticker: string): number {
  return Math.min(TICKER_MAX, Math.floor(TICKER_W / (ticker.length * 1.22)));
}

/** Near-black on a light brand colour, white on a dark one, for the tab's ticker and the face's header. */
export function inkOn(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#14110c" : "#ffffff";
}
