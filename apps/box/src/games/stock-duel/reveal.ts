// The round's two played cards on the tray. Each seat has a dark well its card lands in; while a seat is on its last
// turn its well says so. A played card arrives face down: a slab in the seat's colour with a big "?", and AUTO on it
// when the card was played for the player. At the reveal both cards turn over together and show their faces: the
// stock's colour across the top with the ticker and company, the round's stat set large and the other three below,
// each with a bar ranking it against the deck.
// Then the winner's card lifts with a rim of its seat's colour and a "+1 ROUND" badge, the loser's sinks and dims,
// and the line under the cards names who took it. A tie says TIE · REPLAY and moves neither card. During the next
// pick that line recalls the last round. It sounds as it moves: a paper whoosh as the cards turn, a blip for each step
// of the round's number counting up, then the winner's fanfare from its side (or the neutral fall of a tie).
import type { Rect } from "../../screen/shell/layout.ts";
import type { Sound } from "../../screen/views/view.ts";
import type { Seat } from "@egb/sdk";
import type { RoundRecord, StatKey, Stock } from "./types.ts";
import { calm, el, fitFont, place, play, wait } from "../../screen/shell/dom.ts";
import { formatStat, STAT_LABEL, STATS } from "./deck.ts";
import { inkOn } from "./rolodex.ts";
import { bar, statRow } from "./stat-bar.ts";

const FLY_MS = 560;
const FLIP_MS = 720;
/** The pause between the cards landing face up and the round's outcome: the round's number counts up in it. */
const OUTCOME_AFTER_MS = 420;
/** How many steps the number counts up in. */
const COUNT_STEPS = 8;
const OUTCOME_MS = 520;

/** How the result line names each stat. */
const STAT_PHRASE: Readonly<Record<StatKey, string>> = {
  price: "price",
  avgPrice: "average price",
  change24h: "24-hour move",
  liquidity: "liquidity",
};

/** Where the winner's card lifts to and the loser's sinks to. */
const WON = "translateY(-18px) scale(1.05)";
const LOST: readonly [string, string] = ["translateY(10px) rotate(-2.5deg) scale(0.97)", "translateY(10px) rotate(2.5deg) scale(0.97)"];

/** The face's padding either side of the round's number. */
const VALUE_INSET = 32;

/** Shrinks a line from its styled size until it fits `width` stage pixels. */
function fitToSize(node: HTMLElement, width: number): void {
  node.style.fontSize = "";
  fitFont(node, width, Number.parseFloat(getComputedStyle(node).fontSize));
}

export interface RevealPlaces {
  /** Each seat's well on the tray. */
  readonly rests: readonly [Rect, Rect];
  /** The line under the cards. */
  readonly call: Rect;
}

export interface Reveal {
  readonly el: HTMLElement;
  /** A played card lands face down on its seat's well, flying from `from` (stage pixels), or simply lying there. */
  place(seat: Seat, auto: boolean, from: Rect | null): void;
  /** The seat's well says it is on its last turn (its partner has played), or goes quiet. */
  waiting(seat: Seat, on: boolean): void;
  /** Both cards turn over together and show the round; resolves once its outcome is shown. */
  flip(record: RoundRecord, animate: boolean): Promise<void>;
  /** The line under the cards recalls a finished round (`play` is its 1-based number), or goes blank for null. */
  recall(record: RoundRecord | null, play: number): void;
  /** The round's cards leave the tray. */
  clear(animate: boolean): void;
  dispose(): void;
}

interface Slot {
  readonly wrap: HTMLElement;
  readonly lift: HTMLElement;
  readonly card: HTMLElement;
  readonly face: HTMLElement;
}

/** `label(seat)` is the player's short name (`KAI`), for the result line and the last-turn note. */
export function createReveal(places: RevealPlaces, label: (seat: Seat) => string, sound: Sound): Reveal {
  const root = el("div", "sd-reveal");
  const wells = places.rests.map((r, seat) => {
    const well = el("div", `sd-rest s${seat}`);
    place(well, r);
    const note = el("div", "sd-rest-wait");
    well.append(el("span", "sd-rest-seat", `P${seat + 1}`), note);
    root.append(well);
    return { well, note };
  });
  const call = el("div", "sd-call");
  place(call, places.call);
  root.append(call);

  const slots: [Slot | null, Slot | null] = [null, null];
  let alive = true;
  let shown: RoundRecord | null = null;

  function make(seat: Seat, auto: boolean): Slot {
    const wrap = el("div", `sd-slot s${seat}`);
    place(wrap, places.rests[seat]);
    const lift = el("div", "sd-rc-lift");
    const card = el("div", "sd-rc down");
    const back = el("div", "sd-rc-back");
    back.append(el("b", "sd-rc-q", "?"));
    if (auto) back.append(el("span", "sd-rc-auto", "AUTO"));
    const face = el("div", "sd-rc-face");
    card.append(back, face);
    lift.append(el("i", "sd-rc-glow"), card, el("span", "sd-rc-badge", "+1 ROUND"));
    wrap.append(lift);
    root.append(wrap);
    const slot = { wrap, lift, card, face };
    slots[seat] = slot;
    return slot;
  }

  function fill(slot: Slot, stock: Stock, stat: StatKey): void {
    slot.face.style.setProperty("--stock", stock.colour);
    slot.face.style.setProperty("--stock-ink", inkOn(stock.colour));
    const head = el("header", "sd-rc-head");
    head.append(el("b", "sd-rc-ticker", stock.ticker), el("span", "sd-rc-name", stock.name));
    const feature = el("div", "sd-rc-feature");
    const value = el("b", "sd-rc-value", formatStat(stat, stock[stat]));
    feature.append(el("span", "sd-rc-label", STAT_LABEL[stat]), value, bar(stat, stock[stat]));
    const rows = el("ul", "sd-rc-rows");
    for (const key of STATS) if (key !== stat) rows.append(statRow("li", stock, key));
    slot.face.replaceChildren(head, feature, rows, el("i", "sd-rc-dim"));
    // A long number ($1,002.35) shrinks to fit across the card.
    fitToSize(value, places.rests[0].w - VALUE_INSET);
  }

  /** The round's number on both cards counts up from nothing to its value, a rising blip a step. */
  async function countUp(record: RoundRecord, pair: readonly Slot[]): Promise<void> {
    const values = pair.map((slot) => slot.face.querySelector<HTMLElement>(".sd-rc-value"));
    for (let k = 1; k <= COUNT_STEPS; k++) {
      if (!alive || shown !== record) return;
      const share = k / COUNT_STEPS;
      values.forEach((value, seat) => {
        if (value) value.textContent = formatStat(record.stat, record.cards[seat as Seat][record.stat] * share);
      });
      sound.play("count", { pitch: share });
      await wait(OUTCOME_AFTER_MS / COUNT_STEPS);
    }
  }

  /** The winner's card lifts and lights; the loser's sinks and dims. */
  function outcome(seat: Seat, won: boolean, animate: boolean): Promise<void> {
    const slot = slots[seat];
    if (!slot) return Promise.resolve();
    slot.wrap.classList.add(won ? "won" : "lost");
    const to = won ? WON : LOST[seat];
    slot.lift.style.transform = to;
    if (!animate) return Promise.resolve();
    return play(slot.lift, [{ transform: "none" }, { transform: to }], { duration: OUTCOME_MS, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
  }

  function say(kind: "recall" | "result" | null, seat: Seat | null, html: Node[]): void {
    call.className = `sd-call${kind ? ` ${kind} on` : ""}${seat === null ? "" : ` s${seat}`}`;
    call.replaceChildren(...html);
  }

  function result(record: RoundRecord): Node[] {
    const [a, b] = record.cards.map((stock) => formatStat(record.stat, stock[record.stat]));
    const phrase = STAT_PHRASE[record.stat];
    if (record.winner === null) return [el("b", "", "TIE · REPLAY"), el("span", "", `Level at ${a} on the ${phrase}: the next cards replay it`)];
    const [won, lost] = record.winner === 0 ? [a, b] : [b, a];
    return [el("b", "", `${label(record.winner)} TAKES IT`), el("span", "", `${won} beats ${lost} on the ${phrase}`)];
  }

  return {
    el: root,
    place(seat, auto, from) {
      wells[seat]?.well.classList.remove("waiting");
      if (slots[seat]) return;
      const slot = make(seat, auto);
      if (!from || calm()) return;
      const r = places.rests[seat];
      const dx = from.x + from.w / 2 - (r.x + r.w / 2);
      const dy = from.y + from.h / 2 - (r.y + r.h / 2);
      const s = from.w / r.w;
      // It lifts off the drum, arcs up a little and comes down in its well.
      void play(
        slot.wrap,
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0 },
          { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 46}px) scale(${(s + 1) / 2})`, opacity: 1, offset: 0.45 },
          { transform: "translate(0, 0) scale(1)", opacity: 1 },
        ],
        { duration: FLY_MS, easing: "cubic-bezier(0.3, 0.7, 0.3, 1)" },
      );
    },
    waiting(seat, on) {
      const w = wells[seat];
      if (!w) return;
      if (on && !w.note.firstChild) w.note.append(el("b", "", "LAST TURN"), `${label(seat)} plays next, or the front card plays itself`);
      w.well.classList.toggle("waiting", on);
    },
    async flip(record, animate) {
      if (shown === record) return;
      shown = record;
      say(null, null, []);
      const pair = ([0, 1] as const).map((seat) => {
        wells[seat]?.well.classList.remove("waiting");
        const slot = slots[seat] ?? make(seat, false);
        fill(slot, record.cards[seat], record.stat);
        return slot;
      });
      const motion = animate && !calm();
      for (const slot of pair) slot.card.classList.remove("down");
      if (motion) {
        // The number starts from nothing and counts up once the faces are round.
        for (const slot of pair) {
          const value = slot.face.querySelector<HTMLElement>(".sd-rc-value");
          if (value) value.textContent = formatStat(record.stat, 0);
        }
        sound.play("flip");
        await Promise.all(
          pair.map((slot) =>
            play(slot.card, [{ transform: "rotateY(180deg)" }, { transform: "rotateY(0deg)" }], {
              duration: FLIP_MS,
              easing: "cubic-bezier(0.35, 0, 0.25, 1)",
            }),
          ),
        );
        await countUp(record, pair);
        if (!alive || shown !== record) return;
      }
      if (motion) sound.play(record.winner === null ? "tie" : "round-won", { seat: record.winner });
      if (record.winner !== null) {
        await Promise.all([outcome(record.winner, true, motion), outcome(record.winner === 0 ? 1 : 0, false, motion)]);
        if (!alive || shown !== record) return;
      }
      const lines = result(record);
      say("result", record.winner, lines);
      // A long name shrinks to fit the line rather than run off the tray.
      if (lines[0] instanceof HTMLElement) fitToSize(lines[0], places.call.w);
      if (motion) await play(call, [{ transform: "scale(1.25)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 360, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
    },
    recall(record, n) {
      if (!record) return say(null, null, []);
      const [a, b] = record.cards.map((stock) => `${stock.ticker} ${formatStat(record.stat, stock[record.stat])}`);
      const head = el("b", "", `ROUND ${n} · ${STAT_LABEL[record.stat]}${record.winner === null ? " · TIE" : ""}`);
      if (record.winner === null) return say("recall", null, [head, document.createTextNode(`${a} and ${b}, level`)]);
      const [won, lost] = record.winner === 0 ? [a, b] : [b, a];
      const line = el("span");
      line.append(el("em", "", won), ` beat ${lost}`);
      say("recall", record.winner, [head, line]);
    },
    clear(animate) {
      shown = null;
      say(null, null, []);
      slots.forEach((slot, seat) => {
        if (!slot) return;
        slots[seat] = null;
        if (!animate || calm()) {
          slot.wrap.remove();
          return;
        }
        void play(slot.wrap, [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(36px)", opacity: 0 }], {
          duration: 360,
          easing: "cubic-bezier(0.5, 0, 0.75, 0)",
          fill: "forwards",
        }).then(() => slot.wrap.remove());
      });
    },
    dispose() {
      alive = false;
    },
  };
}
