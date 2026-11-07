// Stock Duel's live deck: Robinhood Chain's stock pools (ROBINHOOD_RPC_URL), read at start and every MARKET_MS in the
// background, so a match starts at once on the latest read. A failed read keeps the last good one (the match records
// the block its numbers came from). The RPC URL carries the node's key, so every error logged here is redacted.
import type { MarketSnapshot } from "@egb/shared/market";
import type { Clock, MarketPort } from "../core/ports.ts";
import { liveDeck } from "../games/stock-duel/live.ts";
import type { LiveDeck } from "../games/stock-duel/types.ts";
import { redact } from "./reads.ts";

/** A read takes a few seconds (the head and 25 day samples of every pool): every five minutes is plenty. */
export const MARKET_MS = 5 * 60_000;

export interface MarketFeed extends MarketPort {
  /** Reads the pools now; resolves once the read has landed or failed. */
  refresh(): Promise<void>;
  stop(): void;
}

export interface MarketFeedOptions {
  readonly read: () => Promise<MarketSnapshot>;
  readonly clock: Clock;
  readonly log: (line: string) => void;
}

/** Starts reading at once, then every MARKET_MS until `stop`. */
export function createMarketFeed({ read, clock, log }: MarketFeedOptions): MarketFeed {
  let latest: LiveDeck | null = null;
  let reading: Promise<void> | null = null;

  function refresh(): Promise<void> {
    reading ??= read()
      .then((snapshot) => {
        const deck = liveDeck(snapshot);
        if (!deck) throw new Error(`block ${snapshot.block} is missing a deck stock`);
        if (latest === null) log(`market: Stock Duel deals live from Robinhood Chain (block ${snapshot.block})`);
        latest = deck;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? ((error as { shortMessage?: string }).shortMessage ?? error.message) : String(error);
        const keeping = latest ? `keeping block ${latest.source.block}` : "the frozen deck until a read lands";
        log(`market: read failed (${keeping}): ${redact(message)}`);
      })
      .finally(() => {
        reading = null;
      });
    return reading;
  }

  void refresh();
  const timer = clock.every(MARKET_MS, () => void refresh());
  return {
    deck: () => latest,
    refresh,
    stop: () => clock.cancel(timer),
  };
}
