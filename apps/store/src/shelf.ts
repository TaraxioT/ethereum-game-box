// The bucket's layout, and the only code that writes to it. Every write is conditional and R2 decides it in one step,
// so nothing here can replace an object, however uploads race.
//
//   ids/<id>              the hash that holds an id
//   bundles/<hash>.zip    the zip
//   listings/<hash>.json  its listing

import type { StoreListing } from '@egb/sdk/bundle';

export type Bucket = Pick<R2Bucket, 'get' | 'put' | 'list'>;

const zipKey = (hash: string) => `bundles/${hash}.zip`;
const LISTINGS = 'listings/';

/** Writes `key` unless something is there. True if this call wrote it. */
async function writeOnce(bucket: Bucket, key: string, value: string | Uint8Array): Promise<boolean> {
  return (await bucket.put(key, value, { onlyIf: new Headers({ 'if-none-match': '*' }) })) !== null;
}

/** Claims `id` for `hash`, and returns the hash that holds it, which is `hash` unless another got there first. A claim
 *  is the one key both of two racing uploads of an id must write, which their different hashes' keys aren't. */
export async function claimId(bucket: Bucket, id: string, hash: string): Promise<string> {
  const key = `ids/${id}`;
  if (await writeOnce(bucket, key, hash)) return hash;
  const claim = await bucket.get(key);
  if (!claim) throw new Error(`${key} went away`);
  return claim.text();
}

/** Stores a bundle whose id it holds, the zip first so that no listing points at nothing. An upload that died part way
 *  is finished by the same upload again. True if this call wrote the listing. */
export async function shelve(bucket: Bucket, listing: StoreListing, zip: Uint8Array): Promise<boolean> {
  await writeOnce(bucket, zipKey(listing.hash), zip);
  return writeOnce(bucket, `${LISTINGS}${listing.hash}.json`, JSON.stringify(listing));
}

export function zipOf(bucket: Bucket, hash: string): Promise<R2ObjectBody | null> {
  return bucket.get(zipKey(hash));
}

/** Every listing, by id. Each read finishes inside its own step: a Worker cancels responses left open and unread. */
export async function listings(bucket: Bucket): Promise<StoreListing[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: LISTINGS, cursor });
    keys.push(...page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const read = await Promise.all(keys.map(async (key) => (await bucket.get(key))?.json<StoreListing>()));
  return read.filter((listing) => listing !== undefined).sort((a, b) => (a.id < b.id ? -1 : 1));
}
