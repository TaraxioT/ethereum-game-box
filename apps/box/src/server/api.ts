// The Box's API routes (the game builder's are in builder-api.ts). /api/state's fields are the deploy's contract: its
// updater switches releases only while `busy` is false, so nobody's game, money or build is cut off. The /api/box
// routes are the test page's Box tab.
import type { Badge, BoxState } from "../core/types.ts";
import type { Core } from "../core/core.ts";
import type { Route } from "./routes.ts";
import type { BadgeRecord } from "./sessions.ts";
import { HttpError, readJson, sendJson } from "./http.ts";
import { injectTap, parseInjection, resolveBadge } from "./inject.ts";
import type { BoxReply, InjectReply } from "../test-page/wire.ts";

export interface StateReply {
  readonly phase: BoxState["phase"];
  /** A match is open. */
  readonly match: boolean;
  /** Players are at the Box or money is moving: not a moment to restart it. */
  readonly busy: boolean;
  /** The Box's clock. */
  readonly now: number;
}

/**
 * Players are past Home (seated, or designing a game), a match is open, a transaction hasn't been paid yet, or a game
 * is being built: the builder's child would be killed mid-build.
 */
export function busy(state: BoxState, building = false): boolean {
  const pastHome = state.phase !== "boot" && state.phase !== "attract" && state.phase !== "home";
  return pastHome || building || state.match !== null || state.txs.some((tx) => tx.step !== "paid");
}

export interface ApiOptions {
  readonly core: Core;
  /** The running commit, once known. */
  readonly commit: () => string | null;
  /** ms since the server started. */
  readonly uptimeMs: () => number;
  /** The badges the roster knows, for injected taps by label. */
  readonly roster: () => readonly Badge[];
  readonly records: () => Readonly<Record<string, BadgeRecord>>;
  /** A game is queued or being built. */
  readonly building: () => boolean;
  /** Closes the kiosk's browser (kiosk.ts), for the screen's EXIT key. */
  readonly exitScreen: () => Promise<void>;
}

const noContent = (res: Parameters<Route["handle"]>[1]): void => void res.writeHead(204).end();

export function apiRoutes({ core, commit, uptimeMs, roster, records, building, exitScreen }: ApiOptions): Route[] {
  return [
    {
      method: "GET",
      path: "/api/health",
      handle: (_req, res) => sendJson(res, { ok: true, commit: commit(), uptimeMs: Math.round(uptimeMs()) }),
    },
    {
      method: "GET",
      path: "/api/state",
      handle(_req, res) {
        const state = core.state();
        sendJson(res, { phase: state.phase, match: state.match !== null, busy: busy(state, building()), now: core.now() } satisfies StateReply);
      },
    },
    {
      method: "POST",
      path: "/api/taps/inject",
      async handle(req, res) {
        const { seat, badge } = parseInjection(await readJson(req));
        sendJson(res, injectTap(core, seat, resolveBadge(badge, roster())) satisfies InjectReply);
      },
    },
    {
      method: "GET",
      path: "/api/box",
      handle: (_req, res) => sendJson(res, { state: core.state(), power: core.power(), records: records() } satisfies BoxReply),
    },
    {
      method: "POST",
      path: "/api/box/reset",
      handle(_req, res) {
        core.reset();
        noContent(res);
      },
    },
    {
      // Off: the Box can't settle the match it is running, so Refund opens when the game ends.
      method: "POST",
      path: "/api/box/power",
      async handle(req, res) {
        const body = (await readJson(req)) as { on?: unknown } | null;
        if (typeof body?.on !== "boolean") throw new HttpError(400, "the body must be { on: boolean }");
        core.setPower(body.on);
        noContent(res);
      },
    },
    {
      // The screen's EXIT key: the kiosk's browser closes and the Pi's desktop shows. The Box itself keeps running, so
      // a match in play goes on as it would with the screen off.
      method: "POST",
      path: "/api/box/exit",
      launcher: true,
      async handle(_req, res) {
        try {
          await exitScreen();
        } catch (error) {
          throw new HttpError(409, `the screen can't close here: ${error instanceof Error ? error.message : String(error)}`);
        }
        noContent(res);
      },
    },
  ];
}
