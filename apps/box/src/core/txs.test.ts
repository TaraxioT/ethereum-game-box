import { describe, expect, it } from "vitest";
import type { Tx } from "./types.ts";
import { createFakeClock } from "./fake-clock.ts";
import { createTxBook, LINGER_MS } from "./txs.ts";

const START = 1_000_000;
const HASH = `0x${"ab".repeat(32)}` as const;
const LINK = `https://sepolia.etherscan.io/tx/${HASH}`;

describe("tx book", () => {
  function setup() {
    const steps: Tx[] = [];
    const dropped: Tx[] = [];
    const clock = createFakeClock(START);
    const book = createTxBook({ step: (tx) => steps.push(tx), drop: (tx) => dropped.push(tx) }, clock);
    return { steps, dropped, book, clock };
  }

  it("shows a transaction signed at once, then each step its port reports, keeping the hash and block", () => {
    const { steps, dropped, book, clock } = setup();
    const ended: Tx[] = [];
    const { tx, watch } = book.submit({ kind: "topup", seat: null, direction: "out", amount: 100 }, (t) => ended.push(t));
    expect(tx).toMatchObject({ id: 1, step: "signed", block: null, hash: null, etherscan: null, error: null, stepAt: START });
    expect(steps).toEqual([tx]);

    clock.advance(300);
    watch({ step: "sent", hash: HASH, etherscan: LINK, block: null, error: null });
    expect(steps[1]).toMatchObject({ step: "sent", hash: HASH, etherscan: LINK, stepAt: START + 300 });
    clock.advance(12_000);
    // A later step that carries no hash or link keeps the ones it had.
    watch({ step: "in-block", hash: null, etherscan: null, block: 8, error: null });
    expect(steps[2]).toMatchObject({ step: "in-block", hash: HASH, etherscan: LINK, block: 8 });
    expect(ended).toEqual([]);

    watch({ step: "paid", hash: HASH, etherscan: LINK, block: null, error: null });
    expect(steps[3]).toMatchObject({ step: "paid", block: 8 });
    expect(ended.map((t) => t.step)).toEqual(["paid"]);
    expect(book.list()).toHaveLength(1);

    clock.advance(LINGER_MS);
    expect(book.list()).toHaveLength(0);
    expect(dropped.map((t) => t.id)).toEqual([1]);
  });

  it("ends a failed transaction once, with its error, and ignores whatever its port says after", () => {
    const { steps, book, clock } = setup();
    let ends = 0;
    const { watch } = book.submit({ kind: "open", seat: null, direction: "in", amount: 20 }, () => ends++);
    watch({ step: "failed", hash: null, etherscan: null, block: null, error: "PotExists" });
    expect(steps.at(-1)).toMatchObject({ step: "failed", error: "PotExists" });
    watch({ step: "paid", hash: HASH, etherscan: LINK, block: 9, error: null });
    expect(steps.at(-1)?.step).toBe("failed");
    expect(ends).toBe(1);
    clock.advance(LINGER_MS);
    expect(book.list()).toEqual([]);
  });

  it("keeps transactions in the order they were signed, each on its own steps", () => {
    const { book } = setup();
    const one = book.submit({ kind: "topup", seat: null, direction: "out", amount: 100 });
    const two = book.submit({ kind: "open", seat: null, direction: "in", amount: 20 });
    two.watch({ step: "sent", hash: HASH, etherscan: LINK, block: null, error: null });
    expect(book.list().map((t) => [t.id, t.step])).toEqual([
      [one.tx.id, "signed"],
      [two.tx.id, "sent"],
    ]);
  });

  it("stops every timer", () => {
    const { dropped, book, clock } = setup();
    const { watch } = book.submit({ kind: "refund", seat: null, direction: "out", amount: 20 });
    watch({ step: "paid", hash: HASH, etherscan: LINK, block: 3, error: null });
    book.stop();
    clock.advance(LINGER_MS * 2);
    expect(dropped).toEqual([]);
  });
});
