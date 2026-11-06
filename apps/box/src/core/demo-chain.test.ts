// The demo's in-memory chain: its steps on the clock, the pot, and the refusals a real chain would make.
import { describe, expect, it } from "vitest";
import type { ChainTxUpdate } from "./ports.ts";
import { BLOCK_MS } from "./core.ts";
import { createDemoChain, DEMO_START_USDC, PAY_MS, SEND_MS } from "./demo-chain.ts";
import { createFakeClock } from "./fake-clock.ts";

const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";

function setup() {
  const clock = createFakeClock(1_000_000);
  const chain = createDemoChain(clock);
  const steps: ChainTxUpdate[][] = [];
  const watch = () => {
    const mine: ChainTxUpdate[] = [];
    steps.push(mine);
    return (update: ChainTxUpdate) => void mine.push(update);
  };
  return { clock, chain, steps, watch };
}

describe("the demo chain", () => {
  it("sends, lands in the next head and pays, with no hashes; the pot pays its winner", async () => {
    const { clock, chain, steps, watch } = setup();
    chain.open({ round: chain.nextRound(), game: "stock-duel", badges: [A, B], amount: 10 }, watch());
    clock.advance(SEND_MS);
    expect(steps[0]?.map((s) => s.step)).toEqual(["sent"]);
    clock.advance(BLOCK_MS - SEND_MS + PAY_MS);
    expect(steps[0]?.map((s) => s.step)).toEqual(["sent", "in-block", "paid"]);
    expect(steps[0]?.every((s) => s.hash === null)).toBe(true);
    expect(await chain.balance(A)).toBe(DEMO_START_USDC - 10);
    chain.settle({ round: 1, game: "stock-duel", badges: [A, B], winner: 1 }, watch());
    clock.advance(BLOCK_MS + PAY_MS);
    expect(await chain.balance(B)).toBe(DEMO_START_USDC + 10);
    expect(await chain.outcome({ round: 1, game: "stock-duel", badges: [A, B], winner: 1 }, null)).toEqual([
      `${B.slice(0, 6)}…${B.slice(-4)} +20 USDC`,
      `${B.slice(0, 6)}…${B.slice(-4)} now holds champion.stockduel.gamebox.eth`,
      `${A.slice(0, 6)}…${A.slice(-4)} stats: 0W 1L`,
      `${B.slice(0, 6)}…${B.slice(-4)} stats: 1W 0L, streak 1`,
    ]);
    expect((await chain.board("stock-duel")).leaders.map((row) => [row.name, row.wins])).toEqual([
      [`${B.slice(0, 6)}…${B.slice(-4)}`, 1],
      [`${A.slice(0, 6)}…${A.slice(-4)}`, 0],
    ]);
    expect((await chain.board("stock-duel")).title?.streak).toBe(1);
    expect(chain.sent).toEqual(["open 1", "settle 1"]);
    chain.stop();
  });

  it("fails an open a balance can't cover, a refund with no pot and a name already taken", () => {
    const { clock, chain, steps, watch } = setup();
    chain.open({ round: 1, game: "quick-draw", badges: [A, B], amount: DEMO_START_USDC + 1 }, watch());
    chain.refund(2, watch());
    chain.claim("nova", A, watch());
    chain.claim("nova", B, watch());
    clock.advance(BLOCK_MS);
    expect(steps.map((s) => s.at(-1)?.step)).toEqual(["failed", "failed", "in-block", "failed"]);
    chain.stop();
  });
});
