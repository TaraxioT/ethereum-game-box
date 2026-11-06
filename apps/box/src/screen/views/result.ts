// Result: the winner's side lit and paid, the winner named by their player name. The result goes to Sepolia (it pays
// the pot, moves the title and scores the cup); once its receipt is in, what it did is read back from chain, never made
// up here: its lines scroll past under the banner ("+20 USDC", "now holds champion.stockduel.gamebox.eth",
// "mumbai-cup: 2nd, 6 pts"), and the win reveal (`win-reveal.ts`) puts up a card for each prize the winner took (the
// pot, the title, the cup), saying what it is on ENS and what it means. A draw sends both stakes back, and so does a
// void (a built game's rules failed) or a match called off with EXIT (settled as a draw); a free-play game shows no
// money. Rematch goes back to Stake with the same seats; Home returns to the library.
import type { BoxState, SeatState } from "../../core/types.ts";
import { badgeLabel } from "../../core/badges.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbPanel } from "../parts/panel.ts";
import { el, fitFont, place } from "../shell/dom.ts";
import { ensName, setEns } from "../shell/ens-name.ts";
import { rez } from "../shell/rez.ts";
import { pageLayout } from "./page-layout.ts";
import { honoursOf } from "../../core/honours.ts";
import { createSeatPanel } from "./seat-panel.ts";
import { createWinReveal } from "./win-reveal.ts";
import { winCards } from "./win-words.ts";

/** A seat's player name on chain, else its badge's label. */
function nameOf(seat: SeatState | undefined): string | null {
  if (!seat?.badge) return null;
  return seat.ens ?? badgeLabel(seat.badge);
}

export function resultView(ctx: ViewContext): View {
  const { layout, link, sound, calm } = ctx;
  const page = pageLayout(layout);
  const root = el("div", "page result");
  const panels = ([0, 1] as const).map((s) => {
    const panel = createSeatPanel(s);
    place(panel.el, page.seats[s]);
    root.append(panel.el);
    return panel;
  });

  const banner = document.createElement("egb-panel") as EgbPanel;
  banner.classList.add("page-plate", "result-banner");
  place(banner, page.plate);
  const bannerText = el("span", "result-banner-text");
  /** The lines read from chain after the result's receipt, scrolling past on one line. */
  const chainLines = ensName("", "result-lines");
  banner.append(bannerText, chainLines);
  const reveal = createWinReveal({ x: 0, y: 0, w: layout.width, h: layout.height }, sound, calm);
  /** The match whose settlement the reveal has shown (or that was in already when this screen came up). */
  let revealed: number | null = null;

  const keys = el("div", "page-keys");
  place(keys, page.keys);
  const home = document.createElement("egb-key") as EgbKey;
  home.setAttribute("variant", "ghost");
  home.textContent = "HOME";
  home.addEventListener("click", () => {
    sound.play("ui-back");
    link.send({ type: "home" });
  });
  const rematch = document.createElement("egb-key") as EgbKey;
  rematch.textContent = "REMATCH";
  rematch.addEventListener("click", () => {
    sound.play("ui-select");
    link.send({ type: "rematch" });
  });
  keys.append(home, rematch);
  root.append(banner, keys, reveal.el);

  function draw(state: BoxState): void {
    const m = state.match;
    if (!m?.outcome) return;
    const { winner } = m.outcome;
    const money = m.stake > 0;
    state.seats.forEach((s, i) => {
      if (m.voided) panels[i]?.set(s, money ? `VOID · ${m.stake} USDC BACK` : "VOID", "done");
      else if (m.calledOff) panels[i]?.set(s, money ? `CALLED OFF · ${m.stake} USDC BACK` : "CALLED OFF", "done");
      else if (winner === null) panels[i]?.set(s, money ? `DRAW · ${m.stake} USDC BACK` : "DRAW", "done");
      else if (winner === i) panels[i]?.set(s, money ? `WINNER · +${m.stake * 2} USDC${m.playFor === "title" ? " · TITLE" : ""}` : "WINNER", "win");
      else panels[i]?.set(s, money ? `−${m.stake} USDC` : "LOSE", "lose");
      panels[i]?.honours(honoursOf(s.ens, state.boards, link.now()));
    });
    const named = winner === null ? null : nameOf(state.seats[winner]);
    bannerText.textContent = m.voided
      ? "VOID · THE GAME FAILED"
      : m.calledOff
        ? money ? "CALLED OFF · STAKES RETURNED" : "CALLED OFF"
        : winner === null
          ? money ? "DRAW · STAKES RETURNED" : "DRAW"
          : `${named ?? `PLAYER ${winner + 1}`} WINS`;
    const onChain = money || m.playFor !== "usdc";
    const settled = m.settlement;
    setEns(chainLines, settled ? settled.lines.join("   ·   ") : onChain && !m.voided ? "reading the result from Sepolia…" : "");
    chainLines.classList.toggle("pending", !settled);
    bannerText.className = `result-banner-text ${winner === null ? "draw" : `seat-${winner}`}`;
    fitFont(bannerText, page.plate.w - 72, 40);
    // The prizes come up once, when the result's settlement arrives.
    if (settled && revealed !== m.id) {
      revealed = m.id;
      const game = state.games.find((g) => g.id === m.game);
      reveal.show(
        winCards({
          match: m,
          settlement: settled,
          game: game?.title ?? m.game,
          board: state.boards[m.game] ?? null,
          fallback: [nameOf(state.seats[0]) ?? "PLAYER 1", nameOf(state.seats[1]) ?? "PLAYER 2"],
          now: link.now(),
        }),
      );
    }
  }

  return {
    el: root,
    update(state, event) {
      // A screen that comes up on a result already read (a reload) doesn't announce it again.
      if (event.type === "init" && state.match?.settlement) revealed = state.match.id;
      draw(state);
      if (event.type === "init") void rez(banner, { delay: 380 });
    },
    dispose: reveal.dispose,
  };
}
