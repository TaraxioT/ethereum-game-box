// The 20-stock deck. Prices, 24-hour moves and liquidity are numbers recorded from each stock's Uniswap pool against
// USDG on Robinhood Chain, frozen here so every match deals from the same figures.
import type { StatKey, Stock } from "./types.ts";

// avgPrice is the midpoint of the day's open (price / (1 + change24h / 100)) and its close (price), rounded to cents.
export const DECK: readonly Stock[] = [
  { ticker: "META", name: "Meta", colour: "#0866ff", price: 644.3, avgPrice: 645.95, change24h: -0.51, liquidity: 1928880 },
  { ticker: "NVDA", name: "Nvidia", colour: "#76b900", price: 211.47, avgPrice: 213.18, change24h: -1.59, liquidity: 2990055 },
  { ticker: "CRCL", name: "Circle", colour: "#00b4a6", price: 85.7, avgPrice: 86.64, change24h: -2.14, liquidity: 2896223 },
  { ticker: "SPCX", name: "SpaceX", colour: "#dce9fa", price: 147.59, avgPrice: 148.13, change24h: -0.73, liquidity: 1603625 },
  { ticker: "MSTR", name: "Strategy", colour: "#fa660f", price: 144.8, avgPrice: 146.47, change24h: -2.25, liquidity: 1719771 },
  { ticker: "MU", name: "Micron", colour: "#49a6ff", price: 885.86, avgPrice: 884.36, change24h: 0.34, liquidity: 1515566 },
  { ticker: "HIMS", name: "Hims & Hers", colour: "#e2c9a6", price: 27.59, avgPrice: 28.33, change24h: -5.12, liquidity: 580680 },
  { ticker: "RDDT", name: "Reddit", colour: "#ff4500", price: 144.74, avgPrice: 147.71, change24h: -3.94, liquidity: 440715 },
  { ticker: "GOOGL", name: "Alphabet", colour: "#4285f4", price: 318.38, avgPrice: 321.63, change24h: -2, liquidity: 599130 },
  { ticker: "TSLA", name: "Tesla", colour: "#e82127", price: 373.33, avgPrice: 375.87, change24h: -1.34, liquidity: 551160 },
  { ticker: "AMZN", name: "Amazon", colour: "#ff9900", price: 247.82, avgPrice: 249.6, change24h: -1.42, liquidity: 395764 },
  { ticker: "COIN", name: "Coinbase", colour: "#0052ff", price: 162.99, avgPrice: 166.63, change24h: -4.28, liquidity: 676664 },
  { ticker: "AAPL", name: "Apple", colour: "#a3aab3", price: 349.3, avgPrice: 348.97, change24h: 0.19, liquidity: 462921 },
  { ticker: "COST", name: "Costco", colour: "#e31837", price: 1002.35, avgPrice: 1007.57, change24h: -1.03, liquidity: 442574 },
  { ticker: "PLTR", name: "Palantir", colour: "#c5ccd6", price: 197.79, avgPrice: 196.28, change24h: 1.55, liquidity: 484659 },
  { ticker: "GME", name: "GameStop", colour: "#ee2a28", price: 24.6, avgPrice: 24.83, change24h: -1.82, liquidity: 322312 },
  { ticker: "AMD", name: "AMD", colour: "#00a77f", price: 523.42, avgPrice: 520.93, change24h: 0.96, liquidity: 343342 },
  { ticker: "AMC", name: "AMC", colour: "#f50127", price: 2.9, avgPrice: 2.93, change24h: -1.81, liquidity: 441210 },
  { ticker: "INTC", name: "Intel", colour: "#0068b5", price: 86.95, avgPrice: 87.26, change24h: -0.71, liquidity: 304220 },
  { ticker: "LLY", name: "Eli Lilly", colour: "#d52b1e", price: 1276.58, avgPrice: 1287.49, change24h: -1.68, liquidity: 20150 },
];

/** The stats in roll order: `(roll1 + roll2) % 4` indexes this list. */
export const STATS: readonly StatKey[] = ["price", "avgPrice", "change24h", "liquidity"];

export const STAT_LABEL: Readonly<Record<StatKey, string>> = {
  price: "PRICE",
  avgPrice: "AVG PRICE",
  change24h: "24H MOVE",
  liquidity: "LIQUIDITY",
};

const dollars = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A stat's value as the card prints it: "$644.30", "−0.51%", "$1.93M". */
export function formatStat(stat: StatKey, value: number): string {
  switch (stat) {
    case "price":
    case "avgPrice":
      return `$${dollars.format(value)}`;
    case "change24h": {
      const text = dollars.format(Math.abs(value));
      if (Number(text) === 0) return `${text}%`;
      return `${value < 0 ? "−" : "+"}${text}%`;
    }
    case "liquidity":
      if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
      if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
      return `$${Math.round(value)}`;
  }
}
