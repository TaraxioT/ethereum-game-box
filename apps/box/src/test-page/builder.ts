// The Builder tab: the slot the game builder mounts in (its jobs, their events, removing a built game). Until it
// does, it says so and lists nothing.
import { h } from "./dom.ts";

export function builderTab(): { readonly el: HTMLElement } {
  return {
    el: h(
      "div",
      "tab",
      h("section", "card wide builder", h("h2", "", "Builder"), h("p", "hint", "The game builder isn't on this Box yet: its jobs and events will show here.")),
    ),
  };
}
