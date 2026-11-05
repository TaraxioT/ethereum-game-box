// The Box's API routes. /api/state's fields are the deploy's contract: its updater switches releases only while
// `busy` is false, so nobody's game or money is cut off.
import type { BoxState } from "../core/types.ts";
import type { Core } from "../core/core.ts";
import type { Route } from "./routes.ts";
import { readJson, sendJson, sendText } from "./http.ts";
import { injectTap, parseInjection } from "./inject.ts";

export interface StateReply {
  readonly phase: BoxState["phase"];
  /** A match is open. */
  readonly match: boolean;
  /** Players are at the Box or money is moving: not a moment to restart it. */
  readonly busy: boolean;
  /** The Box's clock. */
  readonly now: number;
}

/** Players are seated past Home, a match is open, or a transaction hasn't been paid yet. */
export function busy(state: BoxState): boolean {
  const seatedPhase = state.phase !== "boot" && state.phase !== "attract" && state.phase !== "home";
  return seatedPhase || state.match !== null || state.txs.some((tx) => tx.step !== "paid");
}

export interface ApiOptions {
  readonly core: Core;
  /** The running commit, once known. */
  readonly commit: () => string | null;
  /** ms since the server started. */
  readonly uptimeMs: () => number;
}

export function apiRoutes({ core, commit, uptimeMs }: ApiOptions): Route[] {
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
        sendJson(res, { phase: state.phase, match: state.match !== null, busy: busy(state), now: core.now() } satisfies StateReply);
      },
    },
    {
      method: "POST",
      path: "/api/taps/inject",
      async handle(req, res) {
        sendJson(res, injectTap(core, parseInjection(await readJson(req))));
      },
    },
    {
      // The game builder mounts here (steps 7 and 8); until then the route only proves the launcher-token guard.
      method: "GET",
      path: "/api/builder",
      launcher: true,
      handle: (_req, res) => sendText(res, 501, "the game builder isn't on this Box yet"),
    },
  ];
}
