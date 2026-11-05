// One player's hand as a classic Rolodex: a black-and-brass drum on a stand with the cards standing on its rail.
// Every card has an index tab sticking up from its top edge, each tab at its own place across the card, so all the
// hand's tickers show at once. The front card is upright and face up: the stock's colour band, its ticker and name,
// a draining ring for the time it has left at the front, and a big "?" where the stats go (hand cards never show a
// number). The drum indexes one card at a time: the front card turns back over the top and lands upright at the
// back, and the next card is at the front. A played card lifts off the rail toward the desk.
import type { Rect } from "../../screen/shell/layout.ts";
import type { Sound } from "../../screen/views/view.ts";
import type { Seat } from "@egb/sdk";
import type { Stock } from "./types.ts";
import { SHOW_LAG_MS } from "./rules.ts";
import { calm, el } from "../../screen/shell/dom.ts";

/** The Rolodex's drawn size, before it is scaled onto the stage. */
export const ROLODEX_W = 300;
export const ROLODEX_H = 366;

const CARDS_X = 35;
const CARD_TOP = 60;
const CARD_W = 230;
const CARD_H = 220;
/** How far each card behind the front stands above the one in front of it, so its top edge and tab show. */
const STEP = 13;
/** Tabs sit at four places across a card, one per card of a full hand. */
const TAB_SLOTS = 4;
const TAB_W = CARD_W / TAB_SLOTS;
/** How much darker each card further back is. */
const SHADE_PER_CARD = 0.2;
/** A drum step: the old front card tips over the top for half of it, the new one is in front at SHOW_LAG_MS. */
const TURN_MS = SHOW_LAG_MS * 2;
const DROP_MS = 420;
const LIFT_MS = 320;

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
  /** The plinth's line: what this seat can do now. `hot` lights it. */
  note(text: string, hot: boolean): void;
  dispose(): void;
}

interface Card {
  readonly el: HTMLElement;
  readonly shade: HTMLElement;
}

export function createRolodex(seat: Seat, at: Placement, sound: Sound): Rolodex {
  const root = el("div", `sd-rx s${seat}`);
  root.style.left = `${at.x}px`;
  root.style.top = `${at.y}px`;
  root.style.width = `${ROLODEX_W}px`;
  root.style.height = `${ROLODEX_H}px`;
  root.style.transform = `scale(${at.scale})`;

  const stand = el("div", "sd-rx-stand");
  stand.append(el("i", "sd-rx-leg l"), el("i", "sd-rx-leg r"), el("i", "sd-rx-base"));
  const cardsBox = el("div", "sd-rx-cards");
  const drum = el("div", "sd-rx-drum");
  drum.append(el("i", "sd-rx-band"), el("i", "sd-rx-knob l"), el("i", "sd-rx-knob r"));
  const ring = createRing();
  const noteEl = el("div", "sd-rx-note");
  stand.append(noteEl);
  root.append(stand, cardsBox, drum, ring.el);

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
    const ask = el("div", "sd-card-ask");
    ask.append(el("span", "sd-card-q", "?"));
    body.append(el("i", "sd-card-band"), el("b", "sd-card-ticker", stock.ticker), el("span", "sd-card-name", stock.name), ask);
    const shade = el("i", "sd-card-shade");
    card.append(tab, body, shade);
    cardsBox.append(card);
    const made = { el: card, shade };
    cards.set(stock.ticker, made);
    return made;
  }

  function depthOf(index: number): number {
    const n = hand.length;
    return n === 0 ? 0 : (index - front + n) % n;
  }

  function setDepth(card: Card, depth: number): void {
    card.el.style.transform = `translate3d(0, ${-depth * STEP}px, 0)`;
    card.el.style.zIndex = String(10 - depth);
    card.shade.style.opacity = String(Math.min(0.75, depth * SHADE_PER_CARD));
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
      card.el.style.zIndex = "20";
      card.el.animate(
        [
          { transform: "translate3d(0, 0, 0) rotateX(0deg)", easing: "cubic-bezier(0.5, 0, 0.9, 0.6)" },
          { transform: `translate3d(0, ${back - 36}px, 0) rotateX(82deg)`, offset: 0.5, easing: "cubic-bezier(0.1, 0.4, 0.3, 1)" },
          { transform: `translate3d(0, ${back}px, 0) rotateX(0deg)` },
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
        const rest = `translate3d(0, ${-depth * STEP}px, 0)`;
        const drop = card.el.animate(
          [
            { transform: `translate3d(0, ${-depth * STEP - 150}px, 0)`, opacity: 0 },
            { transform: `translate3d(0, ${-depth * STEP + 6}px, 0)`, opacity: 1, offset: 0.75 },
            { transform: rest, opacity: 1 },
          ],
          { duration: DROP_MS, delay: Math.max(0, delay), fill: "backwards", easing: "cubic-bezier(0.4, 0, 0.6, 1)" },
        );
        if (delay < 0) drop.currentTime = -delay;
        later(Math.max(0, delay + DROP_MS), () => sound.play("tick"));
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
          .finished.then(() => lifted.el.classList.toggle("gone", onDesk === card.ticker), () => undefined);
      } else {
        lifted?.el.classList.add("gone");
      }
      return {
        x: at.x + CARDS_X * at.scale,
        y: at.y + CARD_TOP * at.scale,
        w: CARD_W * at.scale,
        h: CARD_H * at.scale,
      };
    },
    note(text, hot) {
      if (noteEl.textContent !== text) noteEl.textContent = text;
      noteEl.classList.toggle("hot", hot);
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
  ring.append(el("i", "sd-ring-track"), right, left, el("i", "sd-ring-hub"));
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

/** Dark ink on a light brand colour, cream on a dark one, for the tab's ticker. */
function inkOn(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1c1308" : "#fff6e6";
}
