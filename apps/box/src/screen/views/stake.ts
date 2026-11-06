// Stake: pick what the match is played for on the light keys (5, 10 or 25 USDC, 10 lit first; TITLE · 20; CUP · 15
// while the game has a championship open: the modes stake amounts of their own), read on the plate what is on the line
// (the pot, the title's ENS name and the player it resolves to, the championship's leader and countdown, kept live),
// then each player taps to sign the entry. Every result takes the title and scores the open championship.
// Signed, one Box-signed transaction moves both stakes into the pot on Sepolia; the game's own screen shows it on
// its way (the routes send both signatures there) until it is in a block and the match begins. One that fails comes
// back here and says so, and both players sign again. A seat short of the stake is told to tap: its tap
// takes it to the lobby to top up. A game that isn't on chain (a built game) plays for nothing.
import type { BoxState, GameInfo, SeatState } from "../../core/types.ts";
import { isTeamGame, MODE_STAKES, stakeOf } from "../../core/catalogue.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbPanel } from "../parts/panel.ts";
import { el, place } from "../shell/dom.ts";
import { pageLayout } from "./page-layout.ts";
import { honoursOf } from "../../core/honours.ts";
import { createSeatPanel, type SeatTone } from "./seat-panel.ts";
import { latestOpen } from "./open-tx.ts";
import { liveCup, onTheLine } from "./play-for.ts";

const TIER: Record<GameInfo["tier"], string> = {
  refereed: "REFEREED BY THE BOX",
  verified: "VERIFIED ON CHAIN",
};

const TICK_MS = 1_000;

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
  plate.classList.add("page-plate", "stake-plate");
  place(plate, page.plate);
  const kicker = el("span", "stake-kicker");
  const head = el("span", "stake-head");
  const detail = el("span", "stake-detail");
  plate.append(kicker, head, detail);

  const keys = el("div", "page-keys stake-keys");
  place(keys, layout.orientation === "portrait" ? page.keys : { ...page.keys, x: 96, w: 1088 });
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
  const goals = money
    ? (["title", "cup"] as const).map((target) => {
        const key = document.createElement("egb-key") as EgbKey;
        key.textContent = `${target === "title" ? "TITLE" : "CUP"} · ${MODE_STAKES[target]}`;
        key.addEventListener("click", () => {
          sound.play("ui-select");
          link.send({ type: "play-for", target });
        });
        return { target, key };
      })
    : [];
  keys.append(back, ...amounts.map((a) => a.key), ...goals.map((g) => g.key));

  function status(s: SeatState, state: BoxState): [string, SeatTone] {
    if (s.signed) return ["SIGNED", "done"];
    if (!money) return ["TAP TO START", "ask"];
    const amount = stakeOf(state.playFor, state.stake);
    if (s.balance === null) return ["READING BALANCE…", "idle"];
    if (s.balance < amount) return [`NEEDS ${amount} USDC · TAP TO TOP UP`, "alert"];
    // The plate says what the mode puts on the line; the seat says what this player signs.
    return [`TAP TO SIGN ${amount} USDC`, "ask"];
  }

  function say(k: string, h: string, d: string, alert = false): void {
    plate.toggleAttribute("alert", alert);
    kicker.textContent = k;
    head.textContent = h;
    detail.textContent = d;
  }

  function draw(state: BoxState): void {
    const anySigned = state.seats.some((s) => s.signed);
    state.seats.forEach((s, i) => {
      const [text, tone] = status(s, state);
      panels[i]?.set(s, text, tone);
      panels[i]?.honours(honoursOf(s.ens, state.boards, link.now()));
    });
    for (const { amount, key } of amounts) {
      const lit = state.playFor === "usdc" && amount === state.stake;
      key.toggleAttribute("selected", lit);
      key.toggleAttribute("disabled", anySigned && !lit);
    }
    const cupOpen = liveCup(state.board, link.now()) !== null;
    for (const { target, key } of goals) {
      const lit = state.playFor === target;
      key.toggleAttribute("selected", lit);
      key.toggleAttribute("disabled", (anySigned && !lit) || (target === "cup" && !cupOpen && !lit));
    }
    back.toggleAttribute("disabled", anySigned);
    if (!game) return say("", "", "");
    if (!money) return say("FREE PLAY", "THIS GAME ISN'T ON CHAIN", "NO USDC, NO TITLE");
    const open = latestOpen(state);
    if (!anySigned && state.playFor === "usdc" && open?.step === "failed") {
      return say("THE STAKES DIDN'T GO IN", open.error ? open.error.toUpperCase() : "THE OPEN FAILED", "TAP BOTH BADGES TO TRY AGAIN", true);
    }
    const line = onTheLine(state, game.title, link.now());
    const opening = state.seats.every((s) => s.signed);
    say(opening ? "OPENING THE MATCH" : `${TIER[game.tier]} · ${state.board ? "LIVE" : "READING SEPOLIA…"}`, line.head, line.detail);
  }

  // The championship's countdown runs between the Box's events.
  const ticker = setInterval(() => draw(link.state()), TICK_MS);

  return {
    el: root,
    update(state, event) {
      if (event.type === "tap" && event.accepted) panels[event.seat]?.pulse();
      draw(state);
    },
    dispose() {
      clearInterval(ticker);
    },
  };
}
