// Stock Duel's built screen, in the Slab look: a dark room with each player's colour pooling up from their side, thick
// graphite cards lit from above and chunky Unbounded type. Each hand stands as a column of cards; the card in front
// lifts with a rim in the seat's colour and moves down the column with the drum's clock. At the reveal both played
// cards come to the middle under a white chip naming the stat the badges chose, the winner's lifted and lit; the
// score sits at the top, and a slab names the winner at the end.
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
  gap: 2.4vmin 3vmin; padding: 3vmin 4vmin; font-family: var(--body); color: #f4f6fb;
  --slab: linear-gradient(180deg, #2b2f3a, #1d2029 55%, #171920); --edge: inset 0 1px 0 rgb(255 255 255 / .14), inset 0 -2px 0 rgb(0 0 0 / .5);
  background: radial-gradient(55% 70% at 0% 100%, rgb(255 155 61 / .2), transparent 70%), radial-gradient(55% 70% at 100% 100%, rgb(63 217 255 / .18), transparent 70%),
    linear-gradient(180deg, #11131b, #0b0d12 60%, #08090d); }
.p1 { --seat: var(--p1); --seat-rgb: 255 155 61; } .p2 { --seat: var(--p2); --seat-rgb: 63 217 255; }
.sd-top { grid-column: 1 / -1; display: flex; align-items: center; justify-content: center; gap: 2.4vmin; }
.sd-name { font: 700 clamp(14px, 2.6vmin, 22px) var(--body); color: var(--seat); }
.sd-num { min-width: 1.2em; padding: .5vmin 1.4vmin; border-radius: 1.4vmin; text-align: center; font: 900 clamp(22px, 5.4vmin, 46px)/1 var(--display); color: #12100c;
  background: var(--seat); box-shadow: inset 0 2px 0 rgb(255 255 255 / .45), 0 .8vmin 2vmin rgb(var(--seat-rgb) / .45); }
.sd-round { padding: 1vmin 2.4vmin; border-radius: 999px; background: var(--slab); box-shadow: var(--edge); font: 900 clamp(14px, 2.8vmin, 24px) var(--display); letter-spacing: .03em; }
.sd-hand { display: grid; align-content: center; gap: 1.4vmin; min-height: 0; }
.sd-card { position: relative; display: grid; grid-template-columns: .9vmin 1fr; column-gap: 1.8vmin; align-items: center; padding: 1.3vmin 1.8vmin 1.3vmin 0;
  border-radius: 1.8vmin; background: var(--slab); box-shadow: inset 0 1px 0 rgb(255 255 255 / .16), 0 0 0 1px rgb(0 0 0 / .55), 0 1vmin 2vmin rgb(0 0 0 / .45);
  opacity: .55; transition: transform 260ms var(--ease-out), opacity 260ms; }
.sd-card::before { content: ""; grid-row: 1 / 4; align-self: stretch; border-radius: 1.8vmin 0 0 1.8vmin; background: var(--band); }
.sd-card b { font: 900 clamp(15px, 3.6vmin, 32px) / 1 var(--display); letter-spacing: -.01em; }
.sd-card span { grid-column: 2; font: 600 clamp(12px, 1.9vmin, 16px) var(--body); color: #a3a9b8; }
.sd-card::after { content: ""; position: absolute; inset: 0; border-radius: 1.8vmin; box-shadow: 0 0 0 2px var(--seat), 0 0 2vmin rgb(var(--seat-rgb) / .5); opacity: 0; transition: opacity 260ms; }
.sd-hand.p2 .sd-card { transform-origin: right center; }
.sd-card.front { opacity: 1; transform: translateX(1.6vmin) scale(1.04); }
.sd-hand.p2 .sd-card.front { transform: translateX(-1.6vmin) scale(1.04); }
.sd-card.front::after { opacity: 1; }
.sd-card.played { opacity: .2; }
.sd-mid { display: grid; align-content: center; justify-items: center; gap: 2.4vmin; min-height: 0; }
.sd-stat { padding: 1vmin 2.4vmin; border-radius: 999px; font: 900 clamp(14px, 3vmin, 26px) var(--display); letter-spacing: .03em; color: #12141b;
  background: linear-gradient(160deg, #fff, #e4e8f2 60%, #b9c0d0); box-shadow: inset 0 1px 0 #fff, 0 0 2.4vmin rgb(255 255 255 / .4); }
.sd-duel { display: flex; gap: 3vmin; }
.sd-duel .sd-card { opacity: 1; min-width: 26vmin; grid-template-rows: auto auto auto; }
.sd-duel .sd-card em { grid-column: 2; font: 900 clamp(16px, 3.6vmin, 32px) var(--display); font-style: normal; letter-spacing: -.02em; }
.sd-duel .sd-card.won { transform: translateY(-1.4vmin) scale(1.05); }
.sd-duel .sd-card.won em { color: var(--seat); }
.sd-duel .sd-card.won::after { opacity: 1; }
.sd-duel .sd-card.lost { opacity: .5; }
.sd-call { font: 900 clamp(14px, 3vmin, 26px) var(--display); color: var(--seat, #f4f6fb); }
.sd-banner { padding: 2vmin 4vmin; border-radius: 2.6vmin; background: var(--slab); font: 900 clamp(18px, 4.6vmin, 40px) var(--display); color: var(--seat, #f4f6fb);
  box-shadow: var(--edge), 0 0 0 3px var(--seat, #fff), 0 0 2.4vmin rgb(var(--seat-rgb, 255 255 255) / .5); }
.sd [hidden] { display: none !important; }
.sd.calm * { animation: none !important; transition: none !important; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
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
    const round = el("div", "sd-round");
    const nums = [el("b", "sd-num p1"), el("b", "sd-num p2")] as const;
    const top = el("div", "sd-top");
    top.append(el("span", "sd-name p1", init.seats[0].name ?? "P1"), nums[0], round, nums[1], el("span", "sd-name p2", init.seats[1].name ?? "P2"));
    const hands = [el("div", "sd-hand p1"), el("div", "sd-hand p2")] as const;
    const mid = el("div", "sd-mid");
    const stat = el("div", "sd-stat");
    const duel = el("div", "sd-duel");
    const call = el("div", "sd-call");
    const banner = el("div", "sd-banner");
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
      nums[0].textContent = String(state.score[0]);
      nums[1].textContent = String(state.score[1]);
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
            const node = card(stock, `p${seat + 1}${last.winner === null ? "" : last.winner === seat ? " won" : " lost"}`);
            node.append(el("em", "", formatStat(last.stat, stock[last.stat])));
            return node;
          }),
        );
        call.className = `sd-call${last.winner === null ? "" : ` p${last.winner + 1}`}`;
        call.textContent = last.winner === null ? "TIE · REPLAY" : `${init.seats[last.winner].name ?? `PLAYER ${last.winner + 1}`} TAKES IT`;
        if (!init.calm && state.phase === "reveal") {
          [...duel.children].forEach((c, i) => c.animate([{ opacity: 0, transform: "rotateY(90deg)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: i * 90, easing: "ease-out", fill: "backwards" }));
        }
      }
      banner.hidden = state.phase !== "over";
      banner.className = `sd-banner${state.winner === null ? "" : ` p${state.winner + 1}`}`;
      banner.textContent = state.winner === null ? "A DRAW · STAKES BACK" : `${init.seats[state.winner].name ?? `PLAYER ${state.winner + 1}`} WINS`;
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
