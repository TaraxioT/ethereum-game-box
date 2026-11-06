// Attract: the Box idling after boot. Its name where a game's title goes, then the cartridges, then a breathing TAP TO
// START, each rezzing in once the view has; right of the core, the board of champions and championships. Any touch,
// key or badge tap starts.
import type { View, ViewContext } from "./view.ts";
import type { EgbKey } from "../parts/key.ts";
import { el, facesReady, fitFont, place } from "../shell/dom.ts";
import { createRack, rackOf } from "./rack.ts";
import { REZ_MS, rez } from "../shell/rez.ts";
import { createBoardPanel } from "./board.ts";

export function attractView(ctx: ViewContext): View {
  const { layout, link, machine, sound } = ctx;
  // Idle: no cartridge is focused, so no feed is lit.
  machine.feed(null);
  const root = el("div", "attract");

  const title = el("div", "home-title attract-title");
  place(title, { ...layout.title, y: layout.title.y - 48, h: layout.title.h + 48 });
  title.append(el("span", "attract-kicker", "ETHEREUM"), el("h1", "home-title-text", "GAME BOX"));

  const start = document.createElement("egb-key") as EgbKey;
  start.classList.add("attract-start");
  start.textContent = "TAP TO START";
  const startW = layout.play.w + 140;
  const startX = layout.orientation === "portrait" ? (layout.width - startW) / 2 : layout.play.x;
  place(start, { ...layout.play, x: startX, w: startW });

  const name = title.lastElementChild as HTMLElement;
  void facesReady().then(() => fitFont(name, layout.title.w, layout.orientation === "portrait" ? 52 : 64));

  const entries = rackOf(link.state().games);
  const rack = createRack(layout, entries);
  const board = createBoardPanel(layout);
  root.append(title, start, rack.el, ...(board ? [board.el] : []));
  // In order, after the router's rez of the view: the title, the cartridges, then TAP TO START, which then breathes.
  void rez(title, { delay: REZ_MS });
  void rack.rez(REZ_MS + 300);
  void rez(start, { delay: REZ_MS + 300 + entries.length * 90 + 200 }).then(() => start.setAttribute("breathe", ""));

  let started = false;
  const go = (): void => {
    if (started) return;
    started = true;
    sound.play("ui-select");
    link.send({ type: "start" });
  };
  root.addEventListener("pointerdown", go, { once: true });
  const onKey = (e: KeyboardEvent): void => {
    // A and L are the stations' keys: their taps start the Box through the link.
    if (e.key.toLowerCase() !== "a" && e.key.toLowerCase() !== "l") go();
  };
  window.addEventListener("keydown", onKey);

  return {
    el: root,
    update() {},
    dispose() {
      window.removeEventListener("keydown", onKey);
      board?.dispose();
    },
  };
}
