// The Stations tab: each station's link, signal, ping, reader, the chip on it and the screen it shows; Buzz; the press
// round trip; and the bench.
import { SEATS, type Seat } from "@egb/sdk";
import type { BenchReply, PressReply, StationRow, TapsReply } from "./wire.ts";
import { button, h, ms, post, rows, show } from "./dom.ts";

export interface Tab {
  readonly el: HTMLElement;
  update(taps: TapsReply): void;
}

/** A station's `key=value` screen payload, one line each. */
function screenText(row: StationRow): string {
  if (!row.screen) return "—";
  return `${row.screen.payload.replace(/\n/g, "  ·  ")}${row.screen.acked ? "" : "  (not acked)"}`;
}

function stationCard(seat: Seat): { el: HTMLElement; update(row: StationRow | undefined, st: string): void } {
  const fields = ["Station", "Link", "RSSI", "Ping", "Reader", "Chip", "Screen"] as const;
  const values = Object.fromEntries(fields.map((f) => [f, h("dd")])) as Record<(typeof fields)[number], HTMLElement>;
  const out = h("output", "result");
  const buzz = (kind: "ok" | "no") => button(`Buzz ${kind}`, () => show(out, async () => (await post("/api/taps/buzz", { seat, kind }), `buzzed ${kind}`)));
  const el = h(
    "section",
    `card seat-${seat}`,
    h("h2", "", `Player ${seat + 1}`),
    h("dl", "", ...fields.flatMap((f) => [h("dt", "", f), values[f]])),
    h("div", "row", buzz("ok"), buzz("no")),
    out,
  );
  return {
    el,
    update(row, st) {
      values.Station.textContent = st;
      values.Link.textContent = row ? (row.up ? "up" : "down") : "—";
      values.Link.className = row?.up ? "good" : "bad";
      values.RSSI.textContent = row?.rssi == null ? "—" : `${row.rssi} dBm`;
      values.Ping.textContent = row?.rttUs == null ? "—" : ms(row.rttUs / 1000);
      values.Reader.textContent = row?.reader == null ? "—" : row.reader ? "ok" : "not answering";
      values.Chip.textContent = row?.chip?.uid ?? "none";
      values.Screen.textContent = row ? screenText(row) : "—";
    },
  };
}

export function stationsTab(): Tab {
  const cards = SEATS.map(stationCard);
  const receiver = h("p", "status");
  const pressOut = h("output", "result");
  const press = button("Press round trip", () =>
    show(pressOut, async () => {
      const r = await post<PressReply>("/api/taps/press");
      if (!r.st) return `no station acked (${ms(r.ackMs)})`;
      return `${r.st}: radio ${ms(r.rttUs === null ? null : r.rttUs / 1000)}, serial echo ${ms(r.echoMs)}, ack ${ms(r.ackMs)}`;
    }),
  );
  const count = h("input");
  count.type = "number";
  count.min = "1";
  count.max = "1000";
  count.value = "200";
  const benchOut = h("output", "result");
  const benchBody = h("tbody");
  const bench = button("Run the bench", () =>
    show(benchOut, async () => {
      const report = await post<BenchReply>("/api/taps/bench", { count: Number(count.value) });
      const n = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—");
      rows(benchBody, report.rows.map((r) => [r.name, `${r.n}${r.failed ? ` (${r.failed} failed)` : ""}`, n(r.median), n(r.p95), n(r.max), r.unit, r.target ?? ""]));
      return report.notes.join(" ") || "done";
    }),
  );
  const table = h("table", "", h("thead", "", h("tr", "", ...["", "n", "median", "p95", "max", "", "target"].map((t) => h("th", "", t)))), benchBody);

  const el = h(
    "div",
    "tab",
    receiver,
    h("div", "cards", ...cards.map((card) => card.el)),
    h("section", "card wide", h("h2", "", "Press"), h("div", "row", press), pressOut),
    h("section", "card wide", h("h2", "", "Bench"), h("div", "row", h("label", "", "Samples ", count), bench), benchOut, table),
  );

  return {
    el,
    update(taps) {
      const status = taps.status;
      if (!status) {
        receiver.textContent = "No receiver on this Box (EGB_RECEIVER=none).";
      } else {
        const rx = status.receiver;
        const counts = taps.stats?.taps;
        const fails = counts ? Object.values(counts.fail).reduce((a, b) => a + b, 0) : 0;
        receiver.textContent =
          `Receiver ${taps.receiver}: ${rx.open ? `open on ${rx.path ?? "?"}` : `closed${rx.lastError ? ` (${rx.lastError})` : ""}`}` +
          (counts ? ` · taps ${counts.touch} touched, ${counts.done} done, ${fails} failed, ${status.running} running` : "");
        receiver.className = rx.open ? "status" : "status bad";
      }
      cards.forEach((card, seat) => {
        const st = taps.stations[seat];
        // A card for each seat this Box has.
        card.el.hidden = st === undefined;
        if (st !== undefined) card.update(status?.stations.find((s) => s.st === st), st);
      });
    },
  };
}
