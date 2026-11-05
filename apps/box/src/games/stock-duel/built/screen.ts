// Stock Duel's built screen: a study at night, a brass lamp on Player 1's side and a cyan one on Player 2's. Each hand
// stands as a column of cards; the card in front is lifted and lit in the seat's colour and moves down the column
// with the drum's clock. At the reveal both played cards come to the middle under the stat the badges chose, the
// higher number ringed; the tally sits at the top, and a brass plate names the winner at the end.
//
// The front card is the one at the Box's clock less SHOW_LAG_MS, the same card a tap plays. One requestAnimationFrame
// loop runs, only during the pick, and touches the DOM only when a front card changes. Only transform and opacity
// animate; under `calm` everything shows its end state.
import type { ToFrame } from "@egb/sdk";
import type { GameScreen } from "@egb/sdk/screen";
import { formatStat, STAT_LABEL, type Stock } from "./deck.ts";
import { frontIndex, SHOW_LAG_MS, type StockDuelState } from "./rules.ts";

type Init = Extract<ToFrame, { t: "init" }>;
type Update = Extract<ToFrame, { t: "update" }>;

const STYLE = `
.sd { position: absolute; inset: 0; overflow: hidden; display: grid; grid-template-columns: 1fr minmax(0, 1.25fr) 1fr; grid-template-rows: auto 1fr;
  gap: 2.4vmin 3vmin; padding: 3vmin 4vmin; font-family: var(--body); color: var(--fg);
  background: radial-gradient(60% 70% at 0% 100%, rgb(255 155 61 / .22), transparent 70%), radial-gradient(60% 70% at 100% 100%, rgb(63 217 255 / .18), transparent 70%),
    linear-gradient(180deg, #1d1230 0%, #160b2b 55%, #0e0820 100%); }
.sd-top { grid-column: 1 / -1; display: flex; align-items: center; justify-content: center; gap: 3vmin; }
.sd-top egb-plate { font-size: clamp(13px, 2.6vmin, 22px); }
.sd-tally { display: flex; align-items: center; gap: 1.4vmin; font: 700 clamp(14px, 2.8vmin, 24px) var(--display); }
.sd-tally egb-seg { font-size: clamp(22px, 6vmin, 52px); }
.sd-tally .p1 { color: var(--p1); } .sd-tally .p2 { color: var(--p2); }
.sd-hand { display: grid; align-content: center; gap: 1.4vmin; min-height: 0; }
.sd-card { position: relative; display: grid; grid-template-columns: .7vmin 1fr; column-gap: 1.6vmin; align-items: center; padding: 1.2vmin 1.8vmin 1.2vmin 0;
  border-radius: 1.2vmin; background: linear-gradient(180deg, #2d2356, #211943); box-shadow: inset 0 1px 0 rgb(255 255 255 / .12), 0 0 0 1.5px #0b0718, 0 6px 12px rgb(3 1 10 / .5);
  opacity: .55; transition: transform 260ms var(--ease-out), opacity 260ms; }
.sd-card::before { content: ""; grid-row: 1 / 3; align-self: stretch; border-radius: 1.2vmin 0 0 1.2vmin; background: var(--band); }
.sd-card b { font: 800 clamp(15px, 3.6vmin, 32px) / 1 var(--display); letter-spacing: .06em; }
.sd-card span { grid-column: 2; font-size: clamp(11px, 1.9vmin, 16px); color: var(--fg-3); }
.sd-card::after { content: ""; position: absolute; inset: -2px; border-radius: 1.4vmin; box-shadow: 0 0 0 2px var(--seat), 0 0 10px var(--seat); opacity: 0; transition: opacity 260ms; }
.sd-hand.p1 { --seat: var(--p1); } .sd-hand.p2 { --seat: var(--p2); }
.sd-hand.p2 .sd-card { transform-origin: right center; }
.sd-card.front { opacity: 1; transform: translateX(1.6vmin) scale(1.04); }
.sd-hand.p2 .sd-card.front { transform: translateX(-1.6vmin) scale(1.04); }
.sd-card.front::after { opacity: 1; }
.sd-card.played { opacity: .2; }
.sd-mid { display: grid; align-content: center; justify-items: center; gap: 2.4vmin; min-height: 0; }
.sd-stat { font-size: clamp(14px, 3vmin, 26px); }
.sd-duel { display: flex; gap: 3vmin; }
.sd-duel .sd-card { opacity: 1; min-width: 26vmin; grid-template-rows: auto auto auto; }
.sd-duel .sd-card em { grid-column: 2; font: 700 clamp(14px, 3.2vmin, 28px) var(--mono); font-style: normal; color: var(--lcd-amber); }
.sd-duel .sd-card.won::after { opacity: 1; }
.sd-duel .sd-card.p1 { --seat: var(--p1); } .sd-duel .sd-card.p2 { --seat: var(--p2); }
.sd-call { font-size: clamp(13px, 2.6vmin, 22px); }
.sd-banner { font-size: clamp(16px, 4.4vmin, 40px); }
.sd [hidden] { display: none !important; }
.sd.calm * { animation: none !important; transition: none !important; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function part(tag: "egb-plate" | "egb-seg", attrs: Record<string, string> = {}, text = ""): HTMLElement & { value?: string } {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.textContent = text;
  return node;
}

function card(stock: Stock, extra = ""): HTMLElement {
  const node = el("div", `sd-card ${extra}`.trim());
  node.style.setProperty("--band", stock.colour);
  node.append(el("b", "", stock.ticker), el("span", "", stock.name));
  return node;
}

const screen: GameScreen = {
  mount(root, init: Init) {
    const style = document.createElement("style");
    style.textContent = STYLE;
    const stage = el("div", `sd${init.calm ? " calm" : ""}`);
    const round = part("egb-plate", { variant: "metal" });
    const tally = el("div", "sd-tally");
    const segs = [part("egb-seg", { digits: "1" }), part("egb-seg", { digits: "1" })] as const;
    tally.append(el("span", "p1", init.seats[0].name ?? "P1"), segs[0], el("span", "", "·"), segs[1], el("span", "p2", init.seats[1].name ?? "P2"));
    const top = el("div", "sd-top");
    top.append(round, tally);
    const hands = [el("div", "sd-hand p1"), el("div", "sd-hand p2")] as const;
    const mid = el("div", "sd-mid");
    const stat = part("egb-plate", { variant: "brass", class: "sd-stat" });
    const duel = el("div", "sd-duel");
    const call = part("egb-plate", { variant: "metal", class: "sd-call" });
    const banner = part("egb-plate", { variant: "brass", class: "sd-banner" });
    mid.append(stat, duel, call, banner);
    stage.append(top, hands[0], mid, hands[1]);
    root.append(style, stage);

    let offset = init.now - Date.now();
    const boxNow = () => Date.now() + offset;
    let state = init.state as StockDuelState;
    const shownHand = ["", ""];
    const shownFront = [-1, -1];
    let loop = 0;
    let shownRounds = 0;

    /** Rebuilds a hand's cards only when the hand itself changed (a new round or the deal). */
    function drawHand(seat: 0 | 1, animate: boolean): void {
      const key = state.hands[seat].map((s) => s.ticker).join(" ");
      if (shownHand[seat] === key) return;
      shownHand[seat] = key;
      shownFront[seat] = -1;
      hands[seat].replaceChildren(...state.hands[seat].map((s) => card(s)));
      if (!animate || init.calm) return;
      [...hands[seat].children].forEach((c, i) =>
        c.animate([{ opacity: 0, transform: "translateY(-3vmin)" }, { opacity: 0.55, transform: "none" }], { duration: 320, delay: i * 120 + seat * 60, easing: "ease-out", fill: "backwards" }),
      );
    }

    function drawFronts(): void {
      for (const seat of [0, 1] as const) {
        const front = frontIndex(state, seat, Math.max(state.phaseAt, boxNow() - SHOW_LAG_MS));
        const played = state.played[seat];
        if (front === shownFront[seat] && !played) continue;
        shownFront[seat] = front;
        [...hands[seat].children].forEach((c, i) => {
          const isPlayed = played !== null && state.hands[seat][i] === played;
          c.classList.toggle("front", !played && state.phase !== "reveal" && i === front);
          c.classList.toggle("played", isPlayed);
        });
      }
    }

    function frame(): void {
      drawFronts();
      loop = state.phase === "pick" ? requestAnimationFrame(frame) : 0;
    }

    function draw(animate: boolean): void {
      drawHand(0, animate);
      drawHand(1, animate);
      round.textContent = state.phase === "over" ? "FINAL" : `ROUND ${state.round}`;
      segs[0].value = String(state.score[0]);
      segs[1].value = String(state.score[1]);
      shownFront[0] = shownFront[1] = -1;
      drawFronts();
      if (state.phase === "pick" && !loop) loop = requestAnimationFrame(frame);

      const last = state.history[state.history.length - 1];
      const showing = (state.phase === "reveal" || state.phase === "over") && last !== undefined;
      stat.hidden = duel.hidden = call.hidden = !showing;
      if (showing && last && shownRounds !== state.history.length) {
        shownRounds = state.history.length;
        stat.textContent = STAT_LABEL[last.stat];
        duel.replaceChildren(
          ...last.cards.map((stock, seat) => {
            const node = card(stock, `p${seat + 1}${last.winner === seat ? " won" : ""}`);
            node.append(el("em", "", formatStat(last.stat, stock[last.stat])));
            return node;
          }),
        );
        call.textContent = last.winner === null ? "TIE · REPLAY" : `PLAYER ${last.winner + 1} TAKES IT`;
        if (!init.calm && state.phase === "reveal") {
          [...duel.children].forEach((c, i) => c.animate([{ opacity: 0, transform: "rotateY(90deg)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: i * 90, easing: "ease-out", fill: "backwards" }));
        }
      }
      banner.hidden = state.phase !== "over";
      banner.textContent = state.winner === null ? "A DRAW · STAKES BACK" : `PLAYER ${state.winner + 1} WINS`;
    }

    draw(true);
    return {
      update(message: Update) {
        offset = Math.max(offset, message.now - Date.now());
        const before = state;
        state = message.state as StockDuelState;
        draw(state.phase !== before.phase || state.round !== before.round);
      },
    };
  },
};

export default screen;
