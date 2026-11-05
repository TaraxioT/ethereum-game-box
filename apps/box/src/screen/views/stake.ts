// Stake: pick the stake on brass keys, see the game's trust tier, then each player taps to sign the entry. Both
// signed, the Box opens the match: one transaction moves both stakes into the game.
import type { BoxState, GameInfo, SeatState } from "../../core/types.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbPlate } from "../parts/plate.ts";
import { el, place } from "../shell/dom.ts";
import { pageLayout } from "./page-layout.ts";
import { createSeatPanel } from "./seat-panel.ts";

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

  const plate = document.createElement("egb-plate") as EgbPlate;
  plate.setAttribute("variant", "metal");
  plate.classList.add("page-plate");
  place(plate, page.plate);

  const keys = el("div", "page-keys");
  place(keys, page.keys);
  const back = document.createElement("egb-key") as EgbKey;
  back.setAttribute("variant", "metal");
  back.textContent = "BACK";
  back.addEventListener("click", () => {
    sound.play("tap");
    link.send({ type: "back" });
  });
  root.append(plate, keys);

  const game = link.state().games.find((g) => g.id === link.state().focus);
  const amounts = (game?.stakes ?? []).map((amount) => {
    const key = document.createElement("egb-key") as EgbKey;
    key.textContent = `${amount} EGB`;
    key.addEventListener("click", () => {
      sound.play("tap");
      link.send({ type: "stake", amount });
    });
    return { amount, key };
  });
  keys.append(back, ...amounts.map((a) => a.key));

  function status(s: SeatState, stake: number): [string, "ask" | "done" | "lose"] {
    if (s.signed) return ["SIGNED", "done"];
    if (s.balance + s.pending < stake) return [`NEEDS ${stake} EGB`, "lose"];
    return [`TAP TO SIGN ${stake} EGB`, "ask"];
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
      ? `OPENING THE MATCH · ${state.stake * 2} EGB INTO ${game?.title ?? "THE GAME"}`
      : game ? TIER[game.tier] : "";
  }

  return {
    el: root,
    update(state, event) {
      if (event.type === "tap" && event.accepted) panels[event.seat]?.pulse();
      draw(state);
    },
  };
}
