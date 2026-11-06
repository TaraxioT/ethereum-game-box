// `POST /bundles`: the token, the size, the reader, then the id. Nothing is written until all but the id have passed,
// and the bundle's hash always comes from the bytes that arrived.

import { BUNDLE_LIMITS, BundleRefused, type StoreListing, listingOf, readBundle } from '@egb/sdk/bundle';

import { readCapped } from './body.ts';
import type { Catalog } from './catalog.ts';
import { type Bucket, claimId, shelve } from './shelf.ts';
import { bearerMatches } from './token.ts';

export interface Deps {
  bucket: Bucket;
  token: string | undefined;
  catalog: Catalog;
}

const refuse = (status: number, error: string) => Response.json({ error }, { status });

const tooBig = () => refuse(413, `the zip is over ${BUNDLE_LIMITS.zipBytes} B`);

/** The listing of an upload's bytes, or the reader's reason for refusing them. */
async function listingFor(zip: Uint8Array): Promise<StoreListing | string> {
  try {
    return listingOf(await readBundle(zip), zip.length);
  } catch (error) {
    if (error instanceof BundleRefused) return error.message;
    throw error;
  }
}

export async function upload(request: Request, { bucket, token, catalog }: Deps): Promise<Response> {
  if (!token) return refuse(503, 'uploads are off: STORE_PUBLISH_TOKEN is not set');
  if (!(await bearerMatches(request.headers.get('authorization'), token))) return refuse(401, 'a bad publish token');
  if (Number(request.headers.get('content-length')) > BUNDLE_LIMITS.zipBytes) return tooBig();

  const zip = await readCapped(request.body, BUNDLE_LIMITS.zipBytes);
  if (!zip) return tooBig();
  const listing = await listingFor(zip);
  if (typeof listing === 'string') return refuse(400, listing);

  const holder = await claimId(bucket, listing.id, listing.hash);
  if (holder !== listing.hash) return refuse(409, `${listing.id} is held by ${holder}: a new version needs a new id`);
  const created = await shelve(bucket, listing, zip);
  catalog.drop();
  return Response.json(listing, { status: created ? 201 : 200 });
}
