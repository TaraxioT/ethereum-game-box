import type { MarketSnapshot } from "@egb/shared/market";
import { describe, expect, it } from "vitest";
import { DECK } from "../games/stock-duel/deck.ts";
import { createFakeClock } from "../core/fake-clock.ts";
import { createMarketFeed, MARKET_MS } from "./market.ts";

function snapshot(block: number, price = 10): MarketSnapshot {
  const quotes = Object.fromEntries(DECK.map((card) => [card.ticker, { price, avgPrice: price, change24h: 1, liquidity: 1000 }]));
  return { chainId: 4663, block, at: 1_794_000_000_000, openBlock: block - 1000, quotes };
}

describe("the market feed", () => {
  it("serves the latest read's deck, keeps it through a failed read, and reads again every MARKET_MS", async () => {
    const clock = createFakeClock(0);
    const logs: string[] = [];
    const answers: (() => Promise<MarketSnapshot>)[] = [
      async () => snapshot(100),
      async () => {
        throw new Error("request to https://robinhood-mainnet.core.chainstack.com/secret-key failed");
      },
      async () => snapshot(300, 20),
    ];
    let reads = 0;
    const feed = createMarketFeed({ read: () => answers[reads++]!(), clock, log: (line) => logs.push(line) });
    expect(feed.deck()).toBeNull();
    await feed.refresh();
    expect(feed.deck()?.source).toEqual({ chainId: 4663, block: 100, at: 1_794_000_000_000 });
    expect(feed.deck()?.cards.map((card) => card.ticker)).toEqual(DECK.map((card) => card.ticker));

    clock.advance(MARKET_MS);
    await feed.refresh();
    expect(feed.deck()?.source.block).toBe(100);
    expect(logs.join("\n")).toContain("keeping block 100");
    expect(logs.join("\n")).not.toContain("secret-key");

    clock.advance(MARKET_MS);
    await feed.refresh();
    expect(feed.deck()?.source.block).toBe(300);
    expect(feed.deck()?.cards[0]?.price).toBe(20);
    expect(reads).toBe(3);
    feed.stop();
  });

  it("keeps the frozen deck when a read lacks a deck stock", async () => {
    const clock = createFakeClock(0);
    const partial = snapshot(100);
    const { META: _, ...quotes } = partial.quotes;
    const feed = createMarketFeed({ read: async () => ({ ...partial, quotes }), clock, log: () => {} });
    await feed.refresh();
    expect(feed.deck()).toBeNull();
    feed.stop();
  });
});
