// Good bundles for the tests, on either side of the Worker: nothing here needs Node's types or the Workers'.

import { packBundle } from '@egb/sdk/bundle';

const text = (value: string) => new TextEncoder().encode(value);

/** A bundle's zip. A different `page` under the same `id` is a different hash, and `assets` go in beside the page. */
export function zipOf(id = 'test-game', page = 'one', assets: [string, Uint8Array][] = []): Uint8Array {
  const manifest = {
    format: 1,
    id,
    title: 'Test Game',
    blurb: 'A game for tests.',
    players: { min: 2, max: 4 },
    minutes: 1,
    stakes: [5, 10, 25],
    taps: 'identify',
    verifier: { instructions: 'The seat with the most taps wins the whole pot.' },
  };
  return packBundle(
    new Map([
      ['index.html', text(`<!doctype html>\n<title>${page}</title>\n`)],
      ['manifest.json', text(JSON.stringify(manifest))],
      ...assets,
    ]),
  );
}

export async function hashOf(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return `0x${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
