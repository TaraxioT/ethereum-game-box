// Home: the library. The focused game's title, its facts as data tags and Play on the left; the cartridge rack along
// the bottom, each fed into the core. Focus by touching a cartridge or with the arrow keys; Enter plays. A new focus
// lifts and lights its cartridge, runs a packet along its feed into the core, and rezzes the new title and facts in.
// On the Box, the rack ends in a blank NEW GAME cartridge: it focuses like a game (on this screen alone: the Box's
// focus is always a game), and its key opens the game builder. Built games' cartridges stand before it, each with its
// art from the Box; one that can't load is sealed, and focusing it says why. A game the Forge installs rezzes into the
// rack. After the games stands the TITLES & CUPS program: focused, its key (ENTER) opens the hall (hall.ts). LOBBY,
// beside Play, opens the lobby: a badge's player name, its USDC and a top-up, the title and the cup. Right of the
// core, the board shows the live titles and cups, each line played for with a tap (board.ts).
import type { BoxState, GameInfo } from "../../core/types.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbFact } from "../parts/fact.ts";
import type { EgbKey } from "../parts/key.ts";
import { el, facesReady, fitFont, fitWidth, place } from "../shell/dom.ts";
import { derez, rez } from "../shell/rez.ts";
import { createRack, HALL, NEW_GAME, rackOf, type RackCart } from "./rack.ts";
import { createBoardPanel } from "./board.ts";

/** The rack's cartridges when Home last stood: a game installed since (on the Build screen) slides in on return. */
let racked: ReadonlySet<string> | null = null;

export function homeView(ctx: ViewContext): View {
  const { layout, link, machine, sound } = ctx;
  let entries = rackOf(link.state().games);
  const root = el("div", "home");

  const title = el("div", "home-title");
  place(title, layout.title);
  const titleText = el("h1", "home-title-text");
  /** Why a sealed game can't play. */
  const reason = el("p", "home-reason");
  title.append(titleText, reason);

  const facts = el("div", "home-facts");
  place(facts, layout.facts);

  const playKey = document.createElement("egb-key") as EgbKey;
  playKey.classList.add("home-play");
  place(playKey, layout.play);
  // The launch: the key flashes, the cartridge flashes and settles, the core turns as every trace flares; then the
  // router derezzes Home for the game (or the builder).
  playKey.addEventListener("click", () => {
    if (special) {
      sound.play("ui-select");
      rack.press(special);
      machine.coin();
      link.send({ type: special === HALL.id ? "hall" : "build" });
      return;
    }
    if (!current?.ready) return;
    sound.play("ui-select");
    rack.press(current.id);
    machine.coin();
    link.send({ type: "play" });
  });

  const pick = (id: string): void => {
    sound.play("ui-focus");
    focusEntry(id);
  };
  let rack = createRack(layout, entries, pick);
  const arrived = racked ? entries.filter((entry) => !racked?.has(entry.id)) : [];
  racked = new Set(entries.map((entry) => entry.id));

  /** The library changed: the rack is built again, and a new game's cartridge rezzes in where it stands. */
  function restock(state: BoxState): void {
    const had = new Set(entries.map((entry) => entry.id));
    entries = rackOf(state.games);
    racked = new Set(entries.map((entry) => entry.id));
    const next = createRack(layout, entries, pick);
    rack.el.replaceWith(next.el);
    rack = next;
    rack.focus(special ?? state.focus);
    for (const entry of entries) if (!had.has(entry.id)) rack.arrive(entry.id);
    current = undefined;
  }

  const lobbyKey = document.createElement("egb-key") as EgbKey;
  lobbyKey.classList.add("home-lobby");
  lobbyKey.setAttribute("variant", "ghost");
  lobbyKey.textContent = "LOBBY";
  place(lobbyKey, { x: layout.play.x + layout.play.w + 16, y: layout.play.y, w: 150, h: layout.play.h });
  lobbyKey.addEventListener("click", () => {
    sound.play("ui-select");
    link.send({ type: "lobby" });
  });

  const board = createBoardPanel(layout, link);
  root.append(title, facts, playKey, lobbyKey, rack.el, ...(board ? [board.el] : []));
  for (const entry of arrived) rack.arrive(entry.id);

  let current: GameInfo | undefined;
  /** NEW GAME's or the hall's cartridge is focused on this screen (its id), else a game is. */
  let special: string | null = null;
  /** Bumped by each focus change, so a title swap that a newer one overtakes stops. */
  let turn = 0;

  function show(state: BoxState, animate: boolean): void {
    if (special) return;
    const game = state.games.find((g) => g.id === state.focus);
    if (!game || game === current) return;
    current = game;
    playKey.textContent = game.ready ? "PLAY" : game.sealed ? "SEALED" : "SOON";
    playKey.toggleAttribute("disabled", !game.ready);
    facts.replaceChildren(...(game.sealed ? [fact("shield", "SEALED")] : factsFor(game)));
    rack.focus(game.id);
    const slot = state.games.indexOf(game);
    machine.feed(slot < layout.rack.length ? slot : null);
    retitle(game.title, game.sealed ?? "", animate);
  }

  /** A cartridge by id: a game, NEW GAME or the hall. */
  function focusEntry(id: string): void {
    if (id === NEW_GAME.id) focusSpecial(NEW_GAME, "DESIGN", [fact("players", "2 PLAYERS"), fact("shield", "BUILT ON THE BOX")]);
    else if (id === HALL.id) focusSpecial(HALL, "ENTER", [fact("clock", "TITLES EXPIRE"), fact("shield", "CUPS ARE FOREVER"), fact("players", "LEADERBOARD")]);
    else focusGame(id);
  }

  /** NEW GAME or the hall: not a game, so the Box's focus stays where it is and the key opens it. */
  function focusSpecial(cart: RackCart, key: string, about: HTMLElement[]): void {
    if (special === cart.id) return;
    special = cart.id;
    current = undefined;
    playKey.textContent = key;
    playKey.removeAttribute("disabled");
    facts.replaceChildren(...about);
    rack.focus(cart.id);
    machine.feed(null);
    retitle(cart.title, "", true);
  }

  function focusGame(id: string): void {
    const fromNew = special !== null;
    special = null;
    // Back from NEW GAME to the game the Box still has in focus: no event will come, so draw it now.
    if (fromNew && id === link.state().focus) show(link.state(), true);
    else link.send({ type: "focus", game: id });
  }

  /** Shows the focus's title and why it is sealed. With `animate` the facts rez in turn and the old title derezzes
   * before the new one rezzes in. */
  function retitle(text: string, why: string, animate: boolean): void {
    if (!animate) {
      titleText.textContent = text;
      reason.textContent = why;
      fit();
      return;
    }
    fitWidth(facts, layout.facts.w);
    [...facts.children].forEach((tag, i) => (tag as EgbFact).rez(i * 90));
    const mine = ++turn;
    void derez(titleText, { duration: 120 }).then(() => {
      if (mine !== turn) return;
      titleText.textContent = text;
      reason.textContent = why;
      fit();
      void rez(titleText);
    });
  }

  /** Long titles and fact rows shrink to their column rather than run under the core. */
  function fit(): void {
    fitFont(titleText, layout.title.w, layout.orientation === "portrait" ? 52 : 64);
    fitWidth(facts, layout.facts.w);
  }
  void facesReady().then(fit);

  function onKey(e: KeyboardEvent): void {
    const at = special ?? current?.id;
    if (!at) return;
    const i = entries.findIndex((entry) => entry.id === at);
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step) {
      const next = entries[(i + step + entries.length) % entries.length];
      if (next) {
        sound.play("ui-focus");
        focusEntry(next.id);
      }
    } else if (e.key === "Enter") {
      playKey.flash();
      playKey.click();
    }
  }
  window.addEventListener("keydown", onKey);

  return {
    el: root,
    update(state, event) {
      // A focus the Box moved (another screen, a keyboard) takes over from NEW GAME.
      if (event.type === "focus") special = null;
      if (event.type === "games") restock(state);
      show(state, event.type === "focus");
    },
    dispose() {
      window.removeEventListener("keydown", onKey);
      board?.dispose();
    },
  };
}

function factsFor(game: GameInfo): HTMLElement[] {
  const low = game.stakes[0] ?? 0;
  const high = game.stakes[game.stakes.length - 1] ?? low;
  return [
    fact("players", `${game.minPlayers === undefined ? game.players : `${game.minPlayers}–${game.players}`} PLAYERS`),
    ...(game.minutes > 0 ? [fact("clock", `${game.minutes} MIN`)] : []),
    fact("coin", `${low}–${high} USDC`),
  ];
}

function fact(icon: string, text: string): HTMLElement {
  const chip = document.createElement("egb-fact");
  chip.setAttribute("icon", icon);
  chip.textContent = text;
  return chip;
}
