// The tap stations' routes, for the test page's Stations and Badges tabs and the bench. Every write needs a local
// origin (routes.ts). With EGB_RECEIVER=none there are no taps: GET /api/taps says so and the rest answer 409.
import type { Seat } from "@egb/sdk";
import type { Taps } from "../taps/taps.ts";
import { runBench } from "../taps/bench.ts";
import type { BenchReply, IdentifyReply, PressReply, RollReply, TapsReply } from "../test-page/wire.ts";
import type { StationId } from "../taps/lines.ts";
import type { Route } from "./routes.ts";
import type { ReceiverSetting } from "./settings.ts";
import { HttpError, readJson, sendJson } from "./http.ts";

/** The most samples a bench run takes of each measurement. */
export const BENCH_MAX = 1000;

export type FakeOp = "place" | "lift" | "linkDown" | "linkUp" | "unplug" | "plug";
const FAKE_OPS: readonly FakeOp[] = ["place", "lift", "linkDown", "linkUp", "unplug", "plug"];

interface Options {
  readonly taps: () => Taps | null;
  readonly receiver: ReceiverSetting["kind"];
}

/** A failed chip read or radio request is the station's answer, not the server's fault. */
async function station<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(409, error instanceof Error ? error.message : String(error));
  }
}

async function body(req: Parameters<Route["handle"]>[0]): Promise<Record<string, unknown>> {
  const value = await readJson(req);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpError(400, "the body must be a JSON object");
  return value as Record<string, unknown>;
}

export function tapsRoutes({ taps, receiver }: Options): Route[] {
  const need = (): Taps => {
    const t = taps();
    if (!t) throw new HttpError(409, "this Box has no receiver (EGB_RECEIVER=none)");
    return t;
  };
  const stationOf = (value: unknown): StationId => {
    const known = taps()?.status().stations.map((s) => s.st) ?? [];
    if (typeof value !== "string" || !known.includes(value)) throw new HttpError(400, `st must be one of ${known.join(", ") || "the linked stations"}`);
    return value;
  };
  const seatOf = (value: unknown): Seat => {
    if (value !== 0 && value !== 1) throw new HttpError(400, "seat must be 0 or 1");
    return value;
  };

  return [
    {
      method: "GET",
      path: "/api/taps",
      handle(_req, res) {
        // Everything the Stations and Badges tabs draw, in one poll.
        const t = taps();
        const status = t?.status() ?? null;
        const at = (seat: Seat) => status?.stations.find((s) => s.seat === seat)?.st ?? "";
        sendJson(res, {
          receiver,
          stations: [at(0), at(1)],
          status,
          stats: t?.stats() ?? null,
          roster: t?.roster() ?? [],
          fake: t?.fake?.status() ?? null,
        } satisfies TapsReply);
      },
    },
    {
      // The motor, by seat: one short pulse for `ok`, two for `no`. The station's answer shows in stats().buzz.
      method: "POST",
      path: "/api/taps/buzz",
      async handle(req, res) {
        const b = await body(req);
        if (b.kind !== "ok" && b.kind !== "no") throw new HttpError(400, "kind must be ok or no");
        need().buzz(seatOf(b.seat), b.kind);
        sendJson(res, { ok: true });
      },
    },
    {
      method: "POST",
      path: "/api/taps/press",
      handle: async (_req, res) => sendJson(res, (await station(() => need().press())) satisfies PressReply),
    },
    {
      // get_pkeys on the badge resting on the station: who it is (the roster records it).
      method: "POST",
      path: "/api/taps/identify",
      async handle(req, res) {
        const st = stationOf((await body(req)).st);
        sendJson(res, (await station(() => need().identify(st))) satisfies IdentifyReply);
      },
    },
    {
      // key 2's sign_random on the badge resting on the station, verified against its identity.
      method: "POST",
      path: "/api/taps/roll",
      async handle(req, res) {
        const st = stationOf((await body(req)).st);
        sendJson(res, (await station(() => need().roll(st))) satisfies RollReply);
      },
    },
    {
      method: "POST",
      path: "/api/taps/bench",
      async handle(req, res) {
        const b = await body(req).catch(() => ({}) as Record<string, unknown>);
        const count = b.count === undefined ? undefined : Number(b.count);
        if (count !== undefined && !(Number.isInteger(count) && count >= 1 && count <= BENCH_MAX)) {
          throw new HttpError(400, `count must be 1–${BENCH_MAX}`);
        }
        sendJson(res, (await runBench(need(), count === undefined ? {} : { count })) satisfies BenchReply);
      },
    },
    {
      // The fake receiver's hands: place or lift a simulated badge, drop a station's link, pull the USB cable.
      method: "POST",
      path: "/api/taps/fake",
      async handle(req, res) {
        const b = await body(req);
        const fake = need().fake;
        if (!fake) throw new HttpError(409, "the receiver isn't the fake one (EGB_RECEIVER=fake)");
        const op = b.op as FakeOp;
        if (!FAKE_OPS.includes(op)) throw new HttpError(400, `op must be one of ${FAKE_OPS.join(", ")}`);
        const badge = () => {
          if (typeof b.badge !== "string" || !fake.badges.some((x) => x.name === b.badge)) {
            throw new HttpError(400, `badge must be one of ${fake.badges.map((x) => x.name).join(", ")}`);
          }
          return b.badge;
        };
        if (op === "place") fake.place(badge(), stationOf(b.st));
        else if (op === "lift") fake.lift(badge());
        else if (op === "linkDown") fake.linkDown(stationOf(b.st));
        else if (op === "linkUp") fake.linkUp(stationOf(b.st));
        else if (op === "unplug") fake.unplug();
        else fake.plug();
        sendJson(res, fake.status());
      },
    },
  ];
}
