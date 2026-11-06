import type { BoardReads, BoardView } from "@egb/shared/admin";
import { usdc } from "@egb/shared/names";
import { describe, expect, it } from "vitest";
import { BOARD_PATH, type BoardReply } from "./admin-wire.ts";
import { BOARD_TTL_MS, createBoard } from "./board.ts";
import { startTestBox } from "./testing.ts";

const VIEW: BoardView = {
  block: 12_080_000n,
  now: 1_800_000_000,
  games: [],
  cups: [{ id: 2n, game: "quickdraw", label: "cup-2", name: "cup-2.quickdraw.gamebox.eth", ends: 1_800_000_100, prize: usdc(25), closed: false, winner: null, winnerName: null, leader: null }],
};

describe("the board", () => {
  it("answers the chain's board as JSON, read again only once it is BOARD_TTL_MS old, with no RPC URL in an error", async () => {
    let reads = 0;
    let fail = false;
    let now = 0;
    const source: BoardReads = {
      async view() {
        reads++;
        if (fail) throw new Error("HTTP request failed. URL: https://rpc.example/v2/secret-key");
        return VIEW;
      },
    };
    const board = createBoard(source, () => now);
    const reply = (await board.reply()) as Extract<BoardReply, { available: true }>;
    expect(reply.board).toMatchObject({ block: "12080000", cups: [{ id: "2", prize: "25" }] });
    await board.reply();
    expect(reads).toBe(1);
    now += BOARD_TTL_MS + 1;
    fail = true;
    const stale = (await board.reply()) as Extract<BoardReply, { available: true }>;
    expect(reads).toBe(2);
    expect(stale.board?.block).toBe("12080000");
    expect(stale.error).toBe("reading Sepolia failed: HTTP request failed. URL: <rpc>");
  });

  it("isn't available on a Box with no RPC, and needs no token", async () => {
    const t = await startTestBox();
    try {
      const res = await fetch(`${t.box.url}${BOARD_PATH}`);
      expect(await res.json()).toEqual({ available: false });
    } finally {
      await t.stop();
    }
  });
});
