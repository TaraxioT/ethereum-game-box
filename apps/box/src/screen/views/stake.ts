// Stake: pick the stake (USDC) on the light keys, see the game's trust tier, then each player taps to sign the entry.
// Both signed, one Box-signed transaction moves both stakes into the pot on Sepolia; the game's own screen shows it on
// its way (the routes send both signatures there) until it is in a block and the match begins. One that fails comes
// back here and says so, and both players sign again. A seat short of the stake is told to tap: its tap
// takes it to the lobby to top up. A game that isn't on chain (a built game) plays for nothing.
import type { BoxState, GameInfo, SeatState } from "../../core/types.ts";
import { isTeamGame } from "../../core/catalogue.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbPanel } from "../parts/panel.ts";
import { el, place } from "../shell/dom.ts";
import { pageLayout } from "./page-layout.ts";
import { createSeatPanel, type SeatTone } from "./seat-panel.ts";
import { latestOpen } from "./open-tx.ts";

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
    sound.play("ui-back");
    link.send({ type: "back" });
  });
  root.append(plate, keys);

  const game = link.state().games.find((g) => g.id === link.state().focus);
  /** Team games stake USDC on chain; a built game plays for nothing. */
  const money = game !== undefined && isTeamGame(game.id);
  const stakes = money ? game.stakes : [];
  const amounts = stakes.map((amount, i) => {
    const key = document.createElement("egb-key") as EgbKey;
    key.textContent = `${amount} USDC`;
    key.addEventListener("click", () => {
      // Up or down from the stake chosen, pitched by where this one stands among them.
      const now = link.state().stake;
      const pitch = stakes.length > 1 ? i / (stakes.length - 1) : 0.5;
      sound.play(amount < now ? "ui-down" : amount > now ? "ui-up" : "ui-select", { pitch });
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
    const open = latestOpen(state);
    plate.toggleAttribute("alert", false);
    if (!anySigned && money && open?.step === "failed") {
      plate.toggleAttribute("alert", true);
      plate.textContent = `THE STAKES DIDN'T GO IN${open.error ? ` · ${open.error.toUpperCase()}` : ""} · TAP BOTH BADGES TO TRY AGAIN`;
      return;
    }
    plate.textContent = opening
      ? "OPENING THE MATCH"
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
