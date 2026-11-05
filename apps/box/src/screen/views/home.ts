// Home: the library. The focused game's title, its facts as IC chips and a brass Play on the left; the cartridge rack
// along the bottom, fed into the core. Focus by touching a cartridge or with the arrow keys; Enter plays.
import type { BoxState, GameInfo } from "../link/types.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbFact } from "../parts/fact.ts";
import type { EgbKey } from "../parts/key.ts";
import { el, facesReady, fitFont, fitWidth, place, play } from "../shell/dom.ts";
import { createRack } from "./rack.ts";

export function homeView(ctx: ViewContext): View {
  const { layout, link, machine, sound } = ctx;
  const games = link.state().games;
  const root = el("div", "home");

  const title = el("div", "home-title");
  place(title, layout.title);
  const titleText = el("h1", "home-title-text");
  title.append(titleText);

  const facts = el("div", "home-facts");
  place(facts, layout.facts);

  const playKey = document.createElement("egb-key") as EgbKey;
  playKey.classList.add("home-play");
  place(playKey, layout.play);
  playKey.addEventListener("click", () => {
    if (!current?.ready) return;
    sound.play("tap");
    rack.press(current.id);
    machine.coin();
    link.send({ type: "play" });
  });

  const rack = createRack(layout, games, (id) => {
    sound.play("tick");
    link.send({ type: "focus", game: id });
  });

  root.append(title, facts, playKey, rack.el);

  let current: GameInfo | undefined;

  function show(state: BoxState, animate: boolean): void {
    const game = state.games.find((g) => g.id === state.focus);
    if (!game || game === current) return;
    current = game;
    titleText.textContent = game.title;
    playKey.textContent = game.ready ? "PLAY" : "SOON";
    playKey.toggleAttribute("disabled", !game.ready);
    facts.replaceChildren(...factsFor(game));
    fit();
    rack.focus(game.id);
    machine.feed(state.games.indexOf(game));
    if (!animate) return;
    machine.coin();
    void play(titleText, [{ transform: "translateY(100%)", opacity: 0 }, { transform: "none", opacity: 1 }], {
      duration: 420, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    });
    [...facts.children].forEach((chip, i) => (chip as EgbFact).rez(120 + i * 90));
  }

  /** Long titles and fact rows shrink to their column rather than run under the core. */
  function fit(): void {
    fitFont(titleText, layout.title.w, layout.orientation === "portrait" ? 52 : 64);
    fitWidth(facts, layout.facts.w);
  }
  void facesReady().then(fit);

  function onKey(e: KeyboardEvent): void {
    if (!current) return;
    const i = games.findIndex((g) => g.id === current?.id);
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step) {
      const next = games[(i + step + games.length) % games.length];
      if (next) link.send({ type: "focus", game: next.id });
    } else if (e.key === "Enter") {
      playKey.click();
    }
  }
  window.addEventListener("keydown", onKey);

  return {
    el: root,
    update(state, event) {
      show(state, event.type === "focus");
    },
    dispose() {
      window.removeEventListener("keydown", onKey);
    },
  };
}

function factsFor(game: GameInfo): HTMLElement[] {
  const low = game.stakes[0] ?? 0;
  const high = game.stakes[game.stakes.length - 1] ?? low;
  return [
    fact("players", `${game.players} PLAYERS`),
    fact("clock", `${game.minutes} MIN`),
    fact("coin", `${low}–${high} EGB`),
  ];
}

function fact(icon: string, text: string): HTMLElement {
  const chip = document.createElement("egb-fact");
  chip.setAttribute("icon", icon);
  chip.textContent = text;
  return chip;
}
