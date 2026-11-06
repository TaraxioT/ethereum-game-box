// A game's bundle, fetched from the store by hash. The instructions come from here and never from the Box, and the
// bytes are checked here too: the store is only where they are kept.

import { Refusal } from '@egb/relayer/refusal';
import { BundleRefused, readBundle } from '@egb/sdk/bundle';
import type { BundleManifest } from '@egb/sdk/bundle';
import type { Hex } from 'viem';

import type { Upstream } from './upstream.ts';

/** The manifest of the bundle with sha256 `hash`. A store that can't be reached throws, for the Box to repeat. */
export async function fetchManifest(store: Upstream, hash: Hex): Promise<BundleManifest> {
  const response = await store(`/bundles/${hash}.zip`);
  if (response.status === 404) throw new Refusal(404, 'the store has no such bundle');
  if (!response.ok) throw new Error(`the store answered ${response.status}`);
  const zip = new Uint8Array(await response.arrayBuffer());
  try {
    const bundle = await readBundle(zip);
    if (bundle.hash !== hash) throw new Refusal(422, "the store's zip isn't the bundle staked on");
    return bundle.manifest;
  } catch (error) {
    if (error instanceof BundleRefused) throw new Refusal(422, "the store's zip isn't a good bundle");
    throw error;
  }
}
