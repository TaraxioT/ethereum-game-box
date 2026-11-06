// The board on the Box: every game's title and the latest championships, read from Sepolia (SEPOLIA_RPC_URL) at most
// every 10 s and answered to anyone on `GET /api/board`, for Home. It is public chain data; without an RPC (the
// simulator) the route says the board isn't available. Errors leave here with their URLs replaced by `<rpc>`.
import { type BoardReads, type BoardView, boardReads } from "@egb/shared/admin";
import { formatUsdc } from "@egb/shared/names";
import { sepoliaClient } from "@egb/shared/web";
import { redact } from "../chain/reads.ts";
import { BOARD_PATH, type Board, type BoardReply } from "./admin-wire.ts";
import { sendJson } from "./http.ts";
import type { Route } from "./routes.ts";

/** A board younger than this is answered from memory. */
export const BOARD_TTL_MS = 10_000;

/** The chain's board as JSON can carry it: ids and amounts as strings. */
export function wireBoard(view: BoardView): Board {
  return {
    block: view.block.toString(),
    now: view.now,
    games: view.games.map((g) => ({ ...g, openCup: g.openCup?.toString() ?? null })),
    cups: view.cups.map((c) => ({ ...c, id: c.id.toString(), prize: formatUsdc(c.prize) })),
  };
}

export interface BoardSource {
  reply(): Promise<BoardReply>;
}

export function createBoard(reads: BoardReads, now: () => number = Date.now): BoardSource {
  let last: { at: number; board: Board } | null = null;
  let error: string | null = null;
  let reading: Promise<void> | null = null;
  const refresh = (): Promise<void> =>
    (reading ??= reads
      .view()
      .then((view) => {
        last = { at: now(), board: wireBoard(view) };
        error = null;
      })
      .catch((e: unknown) => {
        error = `reading Sepolia failed: ${redact(e instanceof Error ? (e.message.split("\n")[0] ?? "") : String(e))}`;
      })
      .finally(() => (reading = null)));
  return {
    async reply() {
      if (!last || now() - last.at > BOARD_TTL_MS) await refresh();
      return { available: true, board: last?.board ?? null, error };
    },
  };
}

/** `GET /api/board`, from `rpcUrl` (none: not available). */
export function boardRoutes(rpcUrl: string | null): Route[] {
  const board = rpcUrl ? createBoard(boardReads(sepoliaClient([rpcUrl]))) : null;
  return [
    {
      method: "GET",
      path: BOARD_PATH,
      async handle(_req, res) {
        sendJson(res, board ? await board.reply() : ({ available: false } satisfies BoardReply));
      },
    },
  ];
}
