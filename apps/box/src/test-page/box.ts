// The Box tab: the phase, the power switch that makes the Box miss its settle (so Refund opens), reset to Home, the
// badges' records and the whole state.
import type { BoxReply } from "./wire.ts";
import { button, h, post, rows, show } from "./dom.ts";

export interface BoxTab {
  readonly el: HTMLElement;
  update(box: BoxReply): void;
}

export function boxTab(): BoxTab {
  const phase = h("p", "phase");
  const out = h("output", "result");
  const power = h("input");
  power.type = "checkbox";
  power.addEventListener("change", () => {
    const on = power.checked;
    void show(out, async () => (await post("/api/box/power", { on }), on ? "power on: the Box settles" : "power cut: the next match goes to Refund"));
  });
  const reset = button("Reset to Home", () => show(out, async () => (await post("/api/box/reset"), "back to Home; unsettled stakes returned")));
  const recordsBody = h("tbody");
  const records = h("table", "", h("thead", "", h("tr", "", ...["Badge", "Wins", "Losses", "Draws"].map((t) => h("th", "", t)))), recordsBody);
  const json = h("pre", "json");

  const el = h(
    "div",
    "tab",
    h("section", "card wide", phase, h("div", "row", h("label", "switch", power, " Power (off: miss the settle)"), reset), out),
    h("section", "card wide", h("h2", "", "Records (counted results)"), records),
    h("section", "card wide", h("h2", "", "State"), json),
  );

  return {
    el,
    update(box) {
      const { state } = box;
      phase.textContent = `${state.phase.toUpperCase()}${state.match ? ` · ${state.match.game} #${state.match.id}` : ""} · block ${state.chain.block}`;
      // The switch follows the Box, except while someone is changing it.
      if (document.activeElement !== power) power.checked = box.power;
      const name = (address: string) =>
        state.seats.find((s) => s.badge?.address.toLowerCase() === address)?.badge?.name.toUpperCase() ?? address;
      rows(recordsBody, Object.entries(box.records).map(([address, r]) => [name(address), r.wins, r.losses, r.draws]));
      const text = JSON.stringify(state, null, 2);
      if (json.textContent !== text) json.textContent = text;
    },
  };
}
