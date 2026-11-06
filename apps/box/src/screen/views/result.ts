// Result: the winner's side lit and paid, the winner named by their player name. The result goes to Sepolia (it pays
// the pot, moves the title and scores the cup); once its receipt is in, what it did is read back from chain, never made
// up here: its lines scroll past under the banner ("+20 USDC", "now holds champion.stockduel.gamebox.eth",
// "mumbai-cup: 2nd, 6 pts"), and the win reveal (`win-reveal.ts`) puts up a card for each prize the winner took (the
// pot, the title, the cup), saying what it is on ENS and what it means. A draw sends both stakes back, and so does a
// void (a built game's rules failed) or a match called off with EXIT (settled as a draw); a free-play game shows no
// money. A store game's result is the verifier's: each seat's share of the split, or every stake back. Rematch goes
// back to Stake with the same seats; Home returns to the library.
import type { BoxState, Judged, SeatState } from "../../core/types.ts";
import { badgeLabel } from "../../core/badges.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbPanel } from "../parts/panel.ts";
import { el, fitFont, place } from "../shell/dom.ts";
import { ensName, setEns } from "../shell/ens-name.ts";
import { playerSeats } from "../../core/seats.ts";
import { rez } from "../shell/rez.ts";
import { pageLayout } from "./page-layout.ts";
import { honoursOf } from "../../core/honours.ts";
import { createSeatRow, seatsInPlay } from "./seat-row.ts";
import { splitWords } from "./judged.ts";
import { createWinReveal } from "./win-reveal.ts";
import { winCards } from "./win-words.ts";

/** A seat's player name on chain, else its badge's label. */
function nameOf(seat: SeatState | undefined): string | null {
  if (!seat?.badge) return null;
  return seat.ens ?? badgeLabel(seat.badge);
}

export function resultView(ctx: ViewContext): View {
  const { layout, link, sound, calm } = ctx;
  const page = pageLayout(layout, seatsInPlay(link.state()));
  const root = el("div", "page result");
  const row = createSeatRow(root, layout);

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
    row.show(seatsInPlay(state));
    if (m.play.game === "store") return drawSplit(state, m.play.judged, m.stake);
    const { winner } = m.outcome;
    const money = m.stake > 0;
    state.seats.forEach((s, i) => {
      const panel = row.panel(i);
      if (m.voided) panel?.set(s, money ? `VOID · ${m.stake} USDC BACK` : "VOID", "done");
      else if (m.calledOff) panel?.set(s, money ? `CALLED OFF · ${m.stake} USDC BACK` : "CALLED OFF", "done");
      else if (winner === null) panel?.set(s, money ? `DRAW · ${m.stake} USDC BACK` : "DRAW", "done");
      else if (winner === i) panel?.set(s, money ? `WINNER · +${m.stake * 2} USDC${m.playFor === "title" ? " · TITLE" : ""}` : "WINNER", "win");
      else panel?.set(s, money ? `−${m.stake} USDC` : "LOSE", "lose");
      panel?.honours(honoursOf(s.ens, state.boards, link.now()));
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

  function drawSplit(state: BoxState, judged: Judged | null, stake: number): void {
    // A split counts players, in seat order: a seat left empty has no share.
    const players = playerSeats(state.seats);
    const words = splitWords(judged, stake, players.map((seat) => nameOf(state.seats[seat])));
    players.forEach((seat, place) => {
      const [s, word] = [state.seats[seat], words.seats[place]];
      if (s && word) row.panel(seat)?.set(s, word.status, word.tone);
    });
    bannerText.textContent = words.banner;
    bannerText.className = "result-banner-text draw";
    setEns(chainLines, words.lines.join("   ·   "));
    chainLines.classList.remove("pending");
    fitFont(bannerText, page.plate.w - 72, 40);
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
