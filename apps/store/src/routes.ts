// The HTTP routes. Reads are open to anyone, from anywhere. There is no route that changes or removes what is stored.

import { INDEX_SECONDS } from './catalog.ts';
import { zipOf } from './shelf.ts';
import { type Deps, upload } from './upload.ts';

const OPEN = { 'access-control-allow-origin': '*' };

const ZIP_HEADERS = {
  ...OPEN,
  'content-type': 'application/zip',
  'cache-control': 'public, max-age=31536000, immutable',
};

const INDEX_HEADERS = {
  ...OPEN,
  'content-type': 'application/json',
  'cache-control': `public, max-age=${INDEX_SECONDS}`,
};

const notFound = (headers: Record<string, string>) => Response.json({ error: 'not found' }, { status: 404, headers });

const sized = (headers: Record<string, string>, length: number) => ({ ...headers, 'content-length': String(length) });

async function read(pathname: string, { bucket, catalog }: Deps): Promise<Response> {
  if (pathname === '/index.json') {
    const text = await catalog.text(bucket);
    return new Response(text, { headers: sized(INDEX_HEADERS, new TextEncoder().encode(text).length) });
  }
  const hash = /^\/bundles\/(0x[0-9a-f]{64})\.zip$/.exec(pathname)?.[1];
  const zip = hash ? await zipOf(bucket, hash) : null;
  return zip ? new Response(zip.body, { headers: sized(ZIP_HEADERS, zip.size) }) : notFound(OPEN);
}

/** What a GET would answer, without the body. The runtime works out no length for a HEAD, so `read` states it, and the
 *  zip is let go at once rather than streamed from R2 to be thrown away. */
async function readHead(pathname: string, deps: Deps): Promise<Response> {
  const response = await read(pathname, deps);
  await response.body?.cancel();
  return new Response(null, response);
}

async function route(request: Request, deps: Deps): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method === 'GET') return read(pathname, deps);
  if (request.method === 'HEAD') return readHead(pathname, deps);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...OPEN, 'access-control-allow-methods': 'GET, HEAD' } });
  }
  if (request.method === 'POST' && pathname === '/bundles') return upload(request, deps);
  return notFound({});
}

/** Answers every request: anything unexpected, such as R2 failing, is a bare 500 the publisher can repeat. */
export async function handle(request: Request, deps: Deps): Promise<Response> {
  try {
    return await route(request, deps);
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'store error' }, { status: 500 });
  }
}
