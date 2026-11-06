import { describe, expect, it } from "vitest";
import { balanceOf, EMPTY_LEDGER, faucet, lock, refund, settle } from "./ledger.ts";

const A = "0xa";
const B = "0xb";
const both = [A, B] as const;
const opened = lock(faucet(faucet(EMPTY_LEDGER, A, 100), B, 100), both, 10);

describe("ledger", () => {
  it("pays the faucet exactly what it announced", () => {
    const paid = faucet(EMPTY_LEDGER, A, 100);
    expect(balanceOf(paid, A)).toBe(100);
    expect(balanceOf(faucet(paid, A, 15), A)).toBe(115);
  });

  it("locks both stakes in escrow", () => {
    expect(balanceOf(opened, A)).toBe(90);
    expect(balanceOf(opened, B)).toBe(90);
    expect(opened.escrow).toBe(20);
  });

  it("pays the winner both stakes", () => {
    const paid = settle(opened, both, 10, 1);
    expect([balanceOf(paid, A), balanceOf(paid, B), paid.escrow]).toEqual([90, 110, 0]);
  });

  it("returns both stakes on a draw", () => {
    const drawn = settle(opened, both, 10, null);
    expect([balanceOf(drawn, A), balanceOf(drawn, B), drawn.escrow]).toEqual([100, 100, 0]);
  });

  it("returns one stake per refund", () => {
    const one = refund(opened, A, 10);
    expect([balanceOf(one, A), balanceOf(one, B), one.escrow]).toEqual([100, 90, 10]);
    const two = refund(one, B, 10);
    expect([balanceOf(two, B), two.escrow]).toEqual([100, 0]);
  });

  it("refuses to lock more than a balance or release more than escrow", () => {
    expect(() => lock(faucet(EMPTY_LEDGER, A, 100), both, 10)).toThrow(RangeError);
    expect(() => settle(refund(opened, A, 10), both, 10, 0)).toThrow(RangeError);
  });

  it("leaves the ledger it was given alone", () => {
    settle(opened, both, 10, 0);
    expect(opened.escrow).toBe(20);
  });
});
