// Quick Draw's built screen: a standoff at dusk. A metal sign reads WAIT… while the light slowly goes, then turns over
// to a brass DRAW!; each seat's reaction time comes up on its LCD, and a brass plate names the winner.
//
// The sign flips on the Box's clock at the state's drawAt (the offset to it is kept from every message's `now`), not
// when the next state arrives, so it turns at the moment the rules judge from. Built once; updates only set text,
// attributes and classes. Only transform and opacity animate; under `calm` everything shows its end state.
import type { ToFrame } from "@egb/sdk";
import type { GameScreen } from "@egb/sdk/screen";
import { MAX_WAIT_MS, reactionMs, type QuickDrawState } from "./rules.ts";

type Init = Extract<ToFrame, { t: "init" }>;
type Update = Extract<ToFrame, { t: "update" }>;

const STYLE = `
.qd { position: absolute; inset: 0; overflow: hidden; display: grid; grid-template-rows: 1fr auto auto; align-items: center; justify-items: center;
  padding: 4% 5% 5%; gap: 3vmin; font-family: var(--display); color: var(--fg);
  background: radial-gradient(120% 70% at 50% 100%, #ff9b3d 0%, #b8452c 22%, #4a1d4f 52%, #160b2b 80%), var(--room); }
.qd-sun { position: absolute; left: 50%; bottom: -28vmin; width: 70vmin; height: 70vmin; margin-left: -35vmin; border-radius: 50%;
  background: radial-gradient(circle, #ffe0a0 0%, #ffb547 45%, rgb(255 155 61 / 0) 70%); opacity: .9; }
.qd-ridge { position: absolute; left: 0; right: 0; bottom: 0; height: 22%; background: #120a1f;
  clip-path: polygon(0 40%, 12% 30%, 22% 42%, 35% 18%, 48% 36%, 60% 24%, 74% 40%, 86% 20%, 100% 34%, 100% 100%, 0 100%); }
.qd-dusk { position: absolute; inset: 0; background: #07040f; opacity: 0; pointer-events: none; }
.qd.calm .qd-dusk.on { opacity: .3; }
.qd-sign { position: relative; font-size: clamp(28px, 9vmin, 96px); letter-spacing: .18em; }
.qd-sign.drawn { animation: qd-flip 420ms var(--ease-spring); }
@keyframes qd-flip { from { transform: perspective(600px) rotateX(-90deg); } to { transform: none; } }
.qd-seats { position: relative; width: 100%; display: flex; justify-content: space-between; gap: 4vmin; }
.qd-seat { display: grid; justify-items: center; gap: 1.6vmin; min-width: 28%; }
.qd-name { font-size: clamp(14px, 3.4vmin, 30px); letter-spacing: .14em; }
.qd-seat.p1 .qd-name { color: var(--p1); }
.qd-seat.p2 .qd-name { color: var(--p2); }
.qd-seat egb-seg { font-size: clamp(26px, 8vmin, 72px); }
.qd-note { font: 600 clamp(12px, 2.6vmin, 22px) var(--mono); color: var(--fg-2); letter-spacing: .08em; min-height: 1.4em; }
.qd-seat.won .qd-name { text-shadow: 0 0 10px currentColor; }
.qd-banner { position: relative; font-size: clamp(16px, 4.6vmin, 44px); opacity: 0; transform: translateY(2vmin); transition: opacity 300ms, transform 420ms var(--ease-spring); }
.qd-banner.on { opacity: 1; transform: none; }
.qd.calm * { animation: none !important; transition: none !important; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function part(tag: "egb-plate" | "egb-seg", className: string, attrs: Record<string, string> = {}): HTMLElement & { value?: string } {
  const node = document.createElement(tag);
  node.className = className;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

const screen: GameScreen = {
  mount(root, init: Init) {
    const style = document.createElement("style");
    style.textContent = STYLE;
    const stage = el("div", `qd${init.calm ? " calm" : ""}`);
    const dusk = el("div", "qd-dusk");
    const sign = part("egb-plate", "qd-sign", { variant: "metal" });
    const seats = el("div", "qd-seats");
    const columns = init.seats.map((seat, i) => {
      const column = el("div", `qd-seat p${i + 1}`);
      const seg = part("egb-seg", "", { digits: "4" });
      const note = el("div", "qd-note");
      column.append(el("div", "qd-name", seat.name ?? `PLAYER ${i + 1}`), seg, note);
      seats.append(column);
      return { column, seg, note };
    });
    const banner = part("egb-plate", "qd-banner");
    stage.append(el("div", "qd-sun"), el("div", "qd-ridge"), dusk, sign, seats, banner);
    root.append(style, stage);

    let offset = init.now - Date.now();
    const boxNow = () => Date.now() + offset;
    let flipTimer: ReturnType<typeof setTimeout> | undefined;
    let dimming: Animation | null = null;
    let shownStandoff = 0;

    /** WAIT… or DRAW! on the sign; turning to DRAW! brings the light back up. */
    function showSign(drawn: boolean): void {
      if (sign.classList.contains("drawn") === drawn) return;
      sign.textContent = drawn ? "DRAW!" : "WAIT…";
      sign.setAttribute("variant", drawn ? "brass" : "metal");
      sign.classList.toggle("drawn", drawn);
      if (drawn) {
        dimming?.cancel();
        dusk.classList.remove("on");
      }
    }

    /** The light goes down over the longest wait from the standoff's start, the same for every match. */
    function dim(startedAt: number): void {
      dimming?.cancel();
      dusk.classList.add("on");
      if (init.calm) return;
      dimming = dusk.animate([{ opacity: 0 }, { opacity: 0.55 }], { duration: MAX_WAIT_MS, fill: "forwards" });
      dimming.currentTime = Math.max(0, boxNow() - startedAt);
    }

    function draw(state: QuickDrawState): void {
      if (state.standoff !== shownStandoff) {
        shownStandoff = state.standoff;
        sign.classList.add("drawn");
        showSign(false);
        if (state.phase === "wait") dim(state.startedAt);
      }
      clearTimeout(flipTimer);
      if (state.phase === "wait") flipTimer = setTimeout(() => showSign(true), Math.max(0, state.drawAt - boxNow()));
      // After a false start the sign never turned: it stays on WAIT….
      else showSign(state.phase === "draw" || state.reason !== "early");
      columns.forEach(({ column, seg, note }, i) => {
        const seat = i as 0 | 1;
        const ms = reactionMs(state, seat);
        seg.value = ms === null ? "" : String(Math.min(ms, 9999));
        const tapped = state.taps[seat] !== null;
        note.textContent = state.phase !== "done" ? (tapped ? "TAPPED" : "") : ms !== null ? "MS" : tapped ? "TOO EARLY" : state.reason === "slow" ? "NO DRAW" : "HELD FIRE";
        column.classList.toggle("won", state.phase === "done" && state.winner === seat);
      });
      if (state.phase === "done") {
        banner.textContent = state.winner === null ? "A DRAW · STAKES BACK" : `PLAYER ${state.winner + 1} WINS`;
        banner.setAttribute("variant", state.winner === null ? "metal" : "brass");
        banner.classList.add("on");
      }
    }

    draw(init.state as QuickDrawState);
    return {
      update(message: Update) {
        // A message only ever arrives late: the largest offset seen is the closest to the Box's clock.
        offset = Math.max(offset, message.now - Date.now());
        // An accepted tap jolts its seat, so the player feels it land.
        if (message.event.type === "tap" && !init.calm) {
          columns[message.event.seat]?.column.animate([{ transform: "none" }, { transform: "translateY(-1.2vmin)" }, { transform: "none" }], { duration: 220, easing: "ease-out" });
        }
        draw(message.state as QuickDrawState);
      },
    };
  },
};

export default screen;
