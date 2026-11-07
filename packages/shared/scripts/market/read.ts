// `pnpm market:read`: reads a market snapshot from Robinhood Chain (ROBINHOOD_RPC_URL) and prints each stock's quote.

import { readMarket, robinhoodClient } from '../../src/market/index.ts';
import { run } from '../names/env.ts';

run(async () => {
  const url = process.env.ROBINHOOD_RPC_URL;
  if (!url) throw new Error('ROBINHOOD_RPC_URL is not set (see .env.example)');
  const snapshot = await readMarket(robinhoodClient(url));
  const when = new Date(snapshot.at).toISOString();
  console.log(`Robinhood Chain ${snapshot.chainId}, block ${snapshot.block} (${when}), the day from block ${snapshot.openBlock}`);
  for (const [ticker, q] of Object.entries(snapshot.quotes)) {
    const cols = [
      ticker.padEnd(6),
      `$${q.price.toFixed(2).padStart(9)}`,
      `avg $${q.avgPrice.toFixed(2).padStart(9)}`,
      `${q.change24h.toFixed(2).padStart(6)}%`,
      `depth $${q.liquidity}`,
    ];
    console.log(cols.join('  '));
  }
  return true;
});
