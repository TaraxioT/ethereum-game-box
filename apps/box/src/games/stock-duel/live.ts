// The deck with Robinhood Chain's numbers: each card keeps its ticker, name and colour, and takes its stats from a
// market snapshot (@egb/shared/market, read by the Box's market feed). Pure.
import type { MarketSnapshot } from "@egb/shared/market";
import { DECK } from "./deck.ts";
import type { LiveDeck } from "./types.ts";

/** The deck at the snapshot's block, or null if the snapshot lacks a card's stock (the match then deals the frozen deck). */
export function liveDeck(snapshot: MarketSnapshot): LiveDeck | null {
  const cards = DECK.map((card) => {
    const quote = snapshot.quotes[card.ticker];
    return quote ? { ...card, ...quote } : null;
  });
  if (cards.some((card) => card === null)) return null;
  return {
    cards: cards.filter((card) => card !== null),
    source: { chainId: snapshot.chainId, block: snapshot.block, at: snapshot.at },
  };
}
