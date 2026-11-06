import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../types.ts";
import { createTxBook, LINGER_MS, PAY_MS, SEND_MS } from "./txs.ts";

const START = 1_000_000;

describe("tx book", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });
  afterEach(() => vi.useRealTimers());

  function setup() {
    const steps: Tx[] = [];
    const dropped: Tx[] = [];
    const book = createTxBook({ step: (tx) => steps.push(tx), drop: (tx) => dropped.push(tx) });
    return { steps, dropped, book };
  }

  it("signs at once, sends ~400 ms later, lands in the next block and pays ~900 ms after it", () => {
    const { steps, dropped, book } = setup();
    let landed = 0;
    const tx = book.submit({ kind: "faucet", seat: 0, direction: "out", amount: 100 }, () => {
      landed = steps.length;
    });
    expect(tx).toMatchObject({ id: 1, step: "signed", block: null, hash: null, stepAt: START });

    book.seal(7, START + 100); // sealed before it was sent: not in it
    vi.advanceTimersByTime(SEND_MS);
    expect(steps.map((t) => t.step)).toEqual(["signed", "sent"]);
    expect(steps[1]?.stepAt).toBe(START + SEND_MS);

    vi.advanceTimersByTime(5_000);
    book.seal(8, START + 5_400);
    expect(landed).toBe(2);
    expect(steps[2]).toMatchObject({ step: "in-block", block: 8, stepAt: START + 5_400 });

    vi.advanceTimersByTime(PAY_MS);
    expect(steps[3]).toMatchObject({ step: "paid", block: 8, stepAt: START + 5_400 + PAY_MS });
    expect(book.list()).toHaveLength(1);

    vi.advanceTimersByTime(LINGER_MS);
    expect(book.list()).toHaveLength(0);
    expect(dropped.map((t) => t.id)).toEqual([1]);
  });

  it("leaves a transaction sent at the very moment of a block for the next one", () => {
    const { steps, book } = setup();
    book.submit({ kind: "open", seat: null, direction: "in", amount: 20 }, () => undefined);
    vi.advanceTimersByTime(SEND_MS);
    book.seal(9, START + SEND_MS);
    expect(steps.at(-1)?.step).toBe("sent");
  });

  it("lands transactions in the order they were signed", () => {
    const { book } = setup();
    const order: number[] = [];
    book.submit({ kind: "faucet", seat: 0, direction: "out", amount: 100 }, () => order.push(1));
    book.submit({ kind: "open", seat: null, direction: "in", amount: 20 }, () => order.push(2));
    vi.advanceTimersByTime(SEND_MS);
    book.seal(10, START + 1_000);
    expect(order).toEqual([1, 2]);
  });

  it("stops every timer", () => {
    const { steps, book } = setup();
    book.submit({ kind: "refund", seat: 1, direction: "out", amount: 10 }, () => undefined);
    book.stop();
    vi.advanceTimersByTime(10_000);
    expect(steps).toHaveLength(1);
  });
});
