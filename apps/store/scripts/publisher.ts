// What `pnpm store:publish <folder>` does: pack, upload, print the hash, and list on chain or say how. Publishing is
// safe to repeat, so a run that stopped part way is finished by the same run again.

import { type StoreListing, packBundle, readBundle } from '@egb/sdk/bundle';
import { type Address, type Hex, type Transport, isHex, size } from 'viem';

import { readFolder } from './folder.ts';
import { listCommand, listOnChain } from './list.ts';

export interface PublishOptions {
  folder: string;
  /** `EGB_STORE_URL`. */
  storeUrl: string | undefined;
  /** `STORE_PUBLISH_TOKEN`. */
  token: string | undefined;
  /** `StorePot`'s address, if it is deployed. */
  pot: Address | undefined;
  /** `STORE_LISTER_KEY`: a key holding `LISTER_ROLE`. */
  listerKey: string | undefined;
  /** The Sepolia node, if `SEPOLIA_RPC_URL` is set. */
  transport: Transport | undefined;
  print: (line: string) => void;
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
}

/** Sends the zip, and returns the store's listing. */
async function send(storeUrl: string, token: string, zip: Uint8Array): Promise<{ listing: StoreListing; isNew: boolean }> {
  const response = await fetch(new URL('/bundles', storeUrl), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/zip' },
    body: new Uint8Array(zip),
  });
  const answer = (await response.json().catch(() => ({}))) as StoreListing & { error?: string };
  if (!response.ok) throw new Error(`the store refused it (${response.status}): ${answer.error ?? 'no reason given'}`);
  return { listing: answer, isNew: response.status === 201 };
}

/** The key, checked for its shape here so that no library's error can quote it. */
function checkedKey(key: string): Hex {
  if (!isHex(key, { strict: true }) || size(key) !== 32) throw new Error('STORE_LISTER_KEY must be 0x and 64 hex digits');
  return key;
}

async function list({ pot, listerKey, transport, print }: PublishOptions, hash: Hex): Promise<void> {
  if (pot && listerKey && transport) {
    const tx = await listOnChain(transport, checkedKey(listerKey), pot, hash);
    print(tx ? `listed on StorePot: ${tx}` : 'already listed on StorePot');
    return;
  }
  print(pot ? 'not listed yet: STORE_LISTER_KEY or SEPOLIA_RPC_URL is not set. To list it:' : "not listed yet: StorePot isn't deployed. Once it is:");
  print(`  ${listCommand(pot, hash)}`);
}

export async function publish(options: PublishOptions): Promise<void> {
  const storeUrl = required('EGB_STORE_URL', options.storeUrl);
  const token = required('STORE_PUBLISH_TOKEN', options.token);
  const zip = packBundle(await readFolder(options.folder));
  const { hash, manifest } = await readBundle(zip);

  const { listing, isNew } = await send(storeUrl, token, zip);
  if (listing.hash !== hash) throw new Error(`the store says ${listing.hash}, not ${hash}`);
  options.print(`${isNew ? 'published' : 'already published'}: ${manifest.title} (${manifest.id}), ${zip.length} B`);
  options.print(hash);
  await list(options, hash);
}
