// A man in the middle, in front of the real store. The store itself can't serve a changed zip, since nothing can overwrite
// a bundle, so this is how one reaches the Box and the verifier: with `swap` set, every zip it passes becomes that one.

import { type Server, createServer } from 'node:http';

import { local, PORTS } from './ports.ts';

export interface Tamper {
  readonly url: string;
  /** The zip to serve in place of every other, or null to pass them through. */
  swap: Uint8Array | null;
  stop(): Promise<void>;
}

export async function startTamper(store: string): Promise<Tamper> {
  const tamper: Tamper = {
    url: local(PORTS.tamper),
    swap: null,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const server: Server = createServer((request, response) => {
    void (async () => {
      const answer = await fetch(new URL(request.url ?? '/', store));
      const body = new Uint8Array(await answer.arrayBuffer());
      response.writeHead(answer.status, { 'content-type': answer.headers.get('content-type') ?? 'application/octet-stream' });
      response.end(request.url?.endsWith('.zip') ? (tamper.swap ?? body) : body);
    })().catch(() => {
      response.writeHead(502);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(PORTS.tamper, '127.0.0.1', resolve));
  return tamper;
}
