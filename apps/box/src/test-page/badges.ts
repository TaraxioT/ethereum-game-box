// The Badges tab: identify and roll the badge on a station, the roster, injected taps at each seat, and, with the
// fake receiver, the simulated badges to place on and lift off the stations.
import { SEATS, type Seat } from "@egb/sdk";
import type { Tab } from "./stations.ts";
import type { IdentifyReply, InjectReply, RollReply, TapsReply } from "./wire.ts";
import { button, h, ms, post, rows, show } from "./dom.ts";

/** A select whose options are rebuilt only when they change, so a choice survives the polls. */
function picker(): { el: HTMLSelectElement; set(options: readonly [value: string, label: string][]): void } {
  const el = h("select");
  let key = "";
  return {
    el,
    set(options) {
      const next = JSON.stringify(options);
      if (next === key) return;
      key = next;
      const chosen = el.value;
      el.replaceChildren(...options.map(([value, label]) => Object.assign(h("option", "", label), { value })));
      if (options.some(([value]) => value === chosen)) el.value = chosen;
    },
  };
}

function readCard(seat: Seat, station: () => string): HTMLElement {
  const out = h("output", "result");
  const identify = button("Identify", () =>
    show(out, async () => {
      const r = await post<IdentifyReply>("/api/taps/identify", { st: station() });
      return `${r.badge.name.toUpperCase()} · ${r.badge.address} · uid ${r.uid} · ${ms(r.ms)}`;
    }),
  );
  const roll = button("Roll", () =>
    show(out, async () => {
      const r = await post<RollReply>("/api/taps/roll", { st: station() });
      return `${r.badge.name.toUpperCase()} rolled ${r.roll.value} (counter ${r.roll.counter}, verified) · ${ms(r.ms)}`;
    }),
  );
  return h("section", `card seat-${seat}`, h("h2", "", `Station P${seat + 1}`), h("p", "hint", "Reads the badge resting on the station."), h("div", "row", identify, roll), out);
}

function injectCard(seat: Seat, badges: ReturnType<typeof picker>): HTMLElement {
  const out = h("output", "result");
  const address = h("input");
  address.placeholder = "or an address 0x…";
  const tap = button("Tap", () =>
    show(out, async () => {
      const badge = address.value.trim() || badges.el.value;
      const r = await post<InjectReply>("/api/taps/inject", { seat, badge });
      return `${r.badge.name.toUpperCase()}: plan ${r.plan}, ${r.accepted ? "accepted" : "not taken"}`;
    }),
  );
  return h("section", `card seat-${seat}`, h("h2", "", `Inject a tap at P${seat + 1}`), h("div", "row", badges.el, address, tap), out);
}

export function badgesTab(): Tab {
  let taps: TapsReply | null = null;
  const station = (seat: Seat) => () => taps?.stations[seat] ?? "";
  const pickers = SEATS.map(() => picker());
  const reads = SEATS.map((seat) => readCard(seat, station(seat)));
  const injects = SEATS.map((seat, i) => injectCard(seat, pickers[i] as ReturnType<typeof picker>));
  const rosterBody = h("tbody");
  const roster = h("table", "", h("thead", "", h("tr", "", ...["Label", "Address (key 2)", "UID", "First seen"].map((t) => h("th", "", t)))), rosterBody);

  const fakeBody = h("div", "fake");
  const fakeOut = h("output", "result");
  const fake = h("section", "card wide", h("h2", "", "Simulated badges (fake receiver)"), fakeBody, fakeOut);
  let fakeKey = "";
  const fakeOp = (body: Record<string, unknown>) => show(fakeOut, async () => (await post("/api/taps/fake", body), `${String(body.op)} done`));

  const el = h(
    "div",
    "tab",
    h("div", "cards", ...reads),
    h("div", "cards", ...injects),
    h("section", "card wide", h("h2", "", "Roster"), roster),
    fake,
  );

  function drawFake(reply: TapsReply): void {
    fake.hidden = reply.fake === null;
    if (!reply.fake) return;
    const key = JSON.stringify(reply.fake);
    if (key === fakeKey) return;
    fakeKey = key;
    const seats = reply.stations;
    fakeBody.replaceChildren(
      ...reply.fake.badges.map((b) =>
        h(
          "div",
          "row",
          h("span", "badge-name", `${b.name} ${b.station ? `on P${seats.indexOf(b.station) + 1}` : ""}`),
          ...seats.map((st, i) => button(`On P${i + 1}`, () => fakeOp({ op: "place", badge: b.name, st }))),
          button("Lift", () => fakeOp({ op: "lift", badge: b.name })),
        ),
      ),
      h(
        "div",
        "row",
        ...seats.flatMap((st, i) => [
          button(`P${i + 1} link down`, () => fakeOp({ op: "linkDown", st })),
          button(`P${i + 1} link up`, () => fakeOp({ op: "linkUp", st })),
        ]),
        reply.fake.plugged ? button("Unplug the receiver", () => fakeOp({ op: "unplug" })) : button("Plug it back", () => fakeOp({ op: "plug" })),
      ),
    );
  }

  return {
    el,
    update(reply) {
      taps = reply;
      const options = reply.roster.map((r) => [r.label, r.label.toUpperCase()] as [string, string]);
      for (const p of pickers) p.set(options);
      // A card for each seat this Box has.
      for (const cards of [reads, injects]) cards.forEach((card, seat) => (card.hidden = seat >= reply.stations.length));
      rows(rosterBody, reply.roster.map((r) => [r.label.toUpperCase(), r.key2, r.uid, r.firstSeen.replace("T", " ").slice(0, 19)]));
      drawFake(reply);
    },
  };
}
