// The round's two played cards on the desk. A played card arrives face down: its back is cream manuscript paper folded
// like a sealed envelope, with AUTO stamped on it when the card was played for the player. At the reveal both cards
// turn over together and show their faces: aged paper with ink rules, the company, the stock's colour as an ink band,
// and all four stats with the round's stat set large. Then the winner's card takes a green wax seal stamped FINALIZED
// and the loser's a red one stamped SLASHED; a tie shows TIE · REPLAY and no seals.
import type { Rect } from "../../screen/shell/layout.ts";
import type { Seat } from "../seat.ts";
import type { RoundRecord, StatKey, Stock } from "./types.ts";
import { calm, el, place, play, wait } from "../../screen/shell/dom.ts";
import { formatStat, STAT_LABEL, STATS } from "./deck.ts";

const FLY_MS = 560;
const FLIP_MS = 720;
/** The pause between the cards landing face up and the seals coming down. */
const SEAL_AFTER_MS = 420;
const SEAL_MS = 520;

export interface Reveal {
  readonly el: HTMLElement;
  /** A played card lands face down on its seat's rest, flying from `from` (stage pixels), or simply lying there. */
  place(seat: Seat, auto: boolean, from: Rect | null): void;
  /** Both cards turn over together and show the round; resolves once the seals are down. */
  flip(record: RoundRecord, animate: boolean): Promise<void>;
  /** The round's cards leave the desk. */
  clear(animate: boolean): void;
  dispose(): void;
}

interface Slot {
  readonly wrap: HTMLElement;
  readonly card: HTMLElement;
  readonly face: HTMLElement;
  readonly back: HTMLElement;
}

export function createReveal(rests: readonly [Rect, Rect]): Reveal {
  const root = el("div", "sd-reveal");
  const tie = el("div", "sd-tie", "TIE · REPLAY");
  const [a, b] = rests;
  tie.style.left = `${(a.x + a.w + b.x) / 2}px`;
  tie.style.top = `${a.y + a.h / 2}px`;
  // Each seat's rest: a tooled outline on the blotter where its played card lies.
  for (const r of rests) {
    const mark = el("i", "sd-rest");
    place(mark, r);
    root.append(mark);
  }
  root.append(tie);

  const slots: [Slot | null, Slot | null] = [null, null];
  let alive = true;
  let shown: RoundRecord | null = null;

  function make(seat: Seat, auto: boolean): Slot {
    const r = rests[seat];
    const wrap = el("div", `sd-slot s${seat}`);
    place(wrap, r);
    const card = el("div", "sd-rc down");
    const back = el("div", "sd-rc-back");
    back.append(el("i", "sd-rc-flap"), el("i", "sd-rc-wax"));
    if (auto) back.append(el("span", "sd-rc-auto", "AUTO"));
    const face = el("div", "sd-rc-face");
    card.append(back, face);
    wrap.append(card);
    root.append(wrap);
    const slot = { wrap, card, face, back };
    slots[seat] = slot;
    return slot;
  }

  function fill(slot: Slot, stock: Stock, stat: StatKey): void {
    slot.face.style.setProperty("--stock", stock.colour);
    const head = el("header", "sd-rc-head");
    head.append(el("b", "sd-rc-ticker", stock.ticker), el("span", "sd-rc-name", stock.name));
    const feature = el("div", "sd-rc-feature");
    feature.append(el("span", "sd-rc-label", STAT_LABEL[stat]), el("b", "sd-rc-value", formatStat(stat, stock[stat])));
    const rows = el("ul", "sd-rc-rows");
    for (const key of STATS) {
      if (key === stat) continue;
      const row = el("li");
      row.append(el("span", "sd-rc-label", STAT_LABEL[key]), el("b", "sd-rc-num", formatStat(key, stock[key])));
      rows.append(row);
    }
    slot.face.replaceChildren(head, el("i", "sd-rc-band"), feature, rows);
  }

  function seal(seat: Seat, won: boolean, animate: boolean): void {
    const slot = slots[seat];
    if (!slot) return;
    slot.card.classList.toggle("lost", !won);
    const mark = el("div", `sd-seal ${won ? "won" : "lost"}`);
    mark.innerHTML = sealSvg(`sd-seal-${seat}`, won ? "FINALIZED" : "SLASHED", won);
    slot.wrap.append(mark);
    if (!animate) return;
    // The seal comes down onto the paper, squashes as the wax spreads, and settles.
    void play(
      mark,
      [
        { transform: "translateY(-70px) scale(1.7)", opacity: 0 },
        { transform: "translateY(0) scale(0.86, 0.8)", opacity: 1, offset: 0.62 },
        { transform: "translateY(0) scale(1.06, 1.02)", opacity: 1, offset: 0.82 },
        { transform: "translateY(0) scale(1)", opacity: 1 },
      ],
      { duration: SEAL_MS, easing: "cubic-bezier(0.5, 0, 0.6, 1)" },
    );
  }

  return {
    el: root,
    place(seat, auto, from) {
      if (slots[seat]) return;
      const slot = make(seat, auto);
      if (!from || calm()) return;
      const r = rests[seat];
      const dx = from.x + from.w / 2 - (r.x + r.w / 2);
      const dy = from.y + from.h / 2 - (r.y + r.h / 2);
      const s = from.w / r.w;
      // It lifts off the drum, arcs up a little and comes down on its rest.
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
    async flip(record, animate) {
      if (shown === record) return;
      shown = record;
      const pair = ([0, 1] as const).map((seat) => {
        const slot = slots[seat] ?? make(seat, false);
        fill(slot, record.cards[seat], record.stat);
        return slot;
      });
      const motion = animate && !calm();
      for (const slot of pair) slot.card.classList.remove("down");
      if (motion) {
        await Promise.all(
          pair.map((slot) =>
            play(slot.card, [{ transform: "rotateY(180deg)" }, { transform: "rotateY(0deg)" }], {
              duration: FLIP_MS,
              easing: "cubic-bezier(0.35, 0, 0.25, 1)",
            }),
          ),
        );
        await wait(SEAL_AFTER_MS);
        if (!alive || shown !== record) return;
      }
      if (record.winner === null) {
        tie.classList.add("on");
        if (motion) {
          await play(tie, [{ transform: "translate(-50%, -50%) scale(1.4)", opacity: 0 }, { transform: "translate(-50%, -50%) scale(1)", opacity: 1 }], {
            duration: SEAL_MS,
            easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
          });
        }
        return;
      }
      seal(record.winner, true, motion);
      seal(record.winner === 0 ? 1 : 0, false, motion);
      if (motion) await wait(SEAL_MS);
    },
    clear(animate) {
      shown = null;
      tie.classList.remove("on");
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

/** A wax seal: an uneven blob of wax, a pressed rim, the stamp's word round the top and a mark in the middle. */
function sealSvg(id: string, word: string, won: boolean): string {
  const size = 120;
  const c = size / 2;
  const points: string[] = [];
  for (let k = 0; k < 30; k++) {
    const a = (k / 30) * Math.PI * 2;
    const r = 54 + Math.sin(k * 2.7) * 2.6 + Math.cos(k * 1.3) * 1.8;
    points.push(`${(c + r * Math.cos(a)).toFixed(1)} ${(c + r * Math.sin(a)).toFixed(1)}`);
  }
  const blob = points.join(" ");
  const [hi, mid, lo] = won ? ["#9be3a0", "#2f8f45", "#123d1c"] : ["#ff9a8a", "#b3261e", "#4d0c08"];
  // The word runs clockwise along an arc over the top, 105 degrees either side of it.
  const t = 35;
  const sx = (c - t * Math.sin((105 * Math.PI) / 180)).toFixed(1);
  const ex = (c + t * Math.sin((105 * Math.PI) / 180)).toFixed(1);
  const ey = (c - t * Math.cos((105 * Math.PI) / 180)).toFixed(1);
  const mark = won
    ? `<path d="M${c - 12} ${c + 8} L${c - 3} ${c + 17} L${c + 14} ${c - 2}" fill="none" stroke-width="5.5"/>`
    : `<path d="M${c - 10} ${c - 1} L${c + 10} ${c + 19} M${c + 10} ${c - 1} L${c - 10} ${c + 19}" fill="none" stroke-width="5.5"/>`;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
  <defs>
    <radialGradient id="${id}-wax" cx="0.36" cy="0.3" r="0.8">
      <stop offset="0" stop-color="${hi}"/><stop offset="0.45" stop-color="${mid}"/><stop offset="1" stop-color="${lo}"/>
    </radialGradient>
    <path id="${id}-arc" d="M${sx} ${ey} A${t} ${t} 0 1 1 ${ex} ${ey}"/>
  </defs>
  <polygon points="${blob}" transform="translate(1.5 3)" fill="rgb(20 8 2 / 0.45)"/>
  <polygon points="${blob}" fill="url(#${id}-wax)"/>
  <circle cx="${c}" cy="${c}" r="46" fill="none" stroke="${lo}" stroke-width="2.5" opacity="0.8"/>
  <circle cx="${c}" cy="${c}" r="44.5" fill="none" stroke="${hi}" stroke-width="1" opacity="0.55"/>
  <text class="sd-seal-word" fill="${lo}" font-size="14"><textPath href="#${id}-arc" startOffset="50%">${word}</textPath></text>
  <g stroke="${lo}" stroke-linecap="round" stroke-linejoin="round">${mark}</g>
  <path d="M${c - 36} ${c - 30} A48 48 0 0 1 ${c + 6} ${c - 47}" fill="none" stroke="rgb(255 255 255 / 0.45)" stroke-width="2" stroke-linecap="round"/>
</svg>`;
}
