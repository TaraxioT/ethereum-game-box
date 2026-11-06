// Stake: pick the stake (USDC) on the light keys, see the game's trust tier, then each player taps to sign the entry.
// Both signed, the match opens at once and one Box-signed transaction moves both stakes into the pot on Sepolia. A
// seat short of the stake is told to tap: its tap takes it to the lobby to top up. A game that isn't on chain (a
// built game) plays for nothing.
import type { BoxState, GameInfo, SeatState } from "../../core/types.ts";
import { isTeamGame } from "../../core/catalogue.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbPanel } from "../parts/panel.ts";
import { el, place } from "../shell/dom.ts";
import { pageLayout } from "./page-layout.ts";
import { createSeatPanel, type SeatTone } from "./seat-panel.ts";

const TIER: Record<GameInfo["tier"], string> = {
  refereed: "REFEREED · THE BOX SAW IT, ITS STAKE BACKS ITS WORD",
  verified: "VERIFIED · THE CHAIN CHECKS THE RESULT",
};

export function stakeView(ctx: ViewContext): View {
  const { layout, link, sound } = ctx;
  const page = pageLayout(layout);
  const root = el("div", "page stake");
  const panels = ([0, 1] as const).map((s) => {
    const panel = createSeatPanel(s);
    place(panel.el, page.seats[s]);
    root.append(panel.el);
    return panel;
  });

  const plate = document.createElement("egb-panel") as EgbPanel;
  plate.classList.add("page-plate");
  place(plate, page.plate);

  const keys = el("div", "page-keys");
  place(keys, page.keys);
  const back = document.createElement("egb-key") as EgbKey;
  back.setAttribute("variant", "ghost");
  back.textContent = "BACK";
  back.addEventListener("click", () => {
    sound.play("tap");
    link.send({ type: "back" });
  });
  root.append(plate, keys);

  const game = link.state().games.find((g) => g.id === link.state().focus);
  /** Team games stake USDC on chain; a built game plays for nothing. */
  const money = game !== undefined && isTeamGame(game.id);
  const amounts = (money ? game.stakes : []).map((amount) => {
    const key = document.createElement("egb-key") as EgbKey;
    key.textContent = `${amount} USDC`;
    key.addEventListener("click", () => {
      sound.play("tap");
      link.send({ type: "stake", amount });
    });
    return { amount, key };
  });
  keys.append(back, ...amounts.map((a) => a.key));

  function status(s: SeatState, stake: number): [string, SeatTone] {
    if (s.signed) return ["SIGNED", "done"];
    if (!money) return ["TAP TO START", "ask"];
    if (s.balance === null) return ["READING BALANCE…", "idle"];
    if (s.balance < stake) return [`NEEDS ${stake} USDC · TAP TO TOP UP`, "alert"];
    return [`TAP TO SIGN ${stake} USDC`, "ask"];
  }

  function draw(state: BoxState): void {
    const anySigned = state.seats.some((s) => s.signed);
    state.seats.forEach((s, i) => {
      const [text, tone] = status(s, state.stake);
      panels[i]?.set(s, text, tone);
    });
    for (const { amount, key } of amounts) {
      key.toggleAttribute("selected", amount === state.stake);
      key.toggleAttribute("disabled", anySigned && amount !== state.stake);
    }
    back.toggleAttribute("disabled", anySigned);
    const opening = state.seats.every((s) => s.signed);
    plate.textContent = opening
      ? money ? `OPENING THE MATCH · ${state.stake * 2} USDC INTO THE POT` : "OPENING THE MATCH"
      : game ? (money ? TIER[game.tier] : "FREE PLAY · THIS GAME ISN'T ON CHAIN") : "";
  }

  return {
    el: root,
    update(state, event) {
      if (event.type === "tap" && event.accepted) panels[event.seat]?.pulse();
      draw(state);
    },
  };
}
