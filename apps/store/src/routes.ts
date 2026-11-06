// The HTTP routes. Reads are open to anyone, from anywhere. There is no route that changes or removes what is stored.

import { INDEX_SECONDS } from './catalog.ts';
import { zipOf } from './shelf.ts';
import { type UploadDeps, upload } from './upload.ts';

const OPEN = { 'access-control-allow-origin': '*' };

const ZIP_HEADERS = { ...OPEN, 'content-type': 'application/zip', 'cache-control': 'public, max-age=31536000, immutable' };

const INDEX_HEADERS = { ...OPEN, 'content-type': 'application/json', 'cache-control': `public, max-age=${INDEX_SECONDS}` };

const notFound = (headers: Record<string, string>) => Response.json({ error: 'not found' }, { status: 404, headers });

async function read(pathname: string, { bucket, catalog }: UploadDeps): Promise<Response> {
  if (pathname === '/index.json') return new Response(await catalog.text(bucket), { headers: INDEX_HEADERS });
  const hash = /^\/bundles\/(0x[0-9a-f]{64})\.zip$/.exec(pathname)?.[1];
  const zip = hash ? await zipOf(bucket, hash) : null;
  return zip ? new Response(zip.body, { headers: ZIP_HEADERS }) : notFound(OPEN);
}

async function route(request: Request, deps: UploadDeps): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method === 'GET') return read(pathname, deps);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...OPEN, 'access-control-allow-methods': 'GET' } });
  }
  if (request.method === 'POST' && pathname === '/bundles') return upload(request, deps);
  return notFound({});
}

/** Answers every request: anything unexpected, such as R2 failing, is a bare 500 the publisher can repeat. */
export async function handle(request: Request, deps: UploadDeps): Promise<Response> {
  try {
    return await route(request, deps);
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'store error' }, { status: 500 });
  }
}
