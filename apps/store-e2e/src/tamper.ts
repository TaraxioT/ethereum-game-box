// A man in the middle, in front of the real store. The store itself can't serve a changed zip, since nothing can overwrite
// a bundle, so this is how one reaches the Box and the verifier: with `changing` on, it flips a byte of every zip it passes.

import { type Server, createServer } from 'node:http';

import { local, PORTS } from './ports.ts';

/** A byte well inside the first file, past the zip's own header. */
const CHANGED_BYTE = 60;

export interface Tamper {
  readonly url: string;
  /** Whether zips are changed on their way through. */
  changing: boolean;
  stop(): Promise<void>;
}

export async function startTamper(store: string): Promise<Tamper> {
  const tamper: Tamper = {
    url: local(PORTS.tamper),
    changing: false,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const server: Server = createServer((request, response) => {
    void (async () => {
      const answer = await fetch(new URL(request.url ?? '/', store));
      const body = new Uint8Array(await answer.arrayBuffer());
      if (tamper.changing && request.url?.endsWith('.zip')) body[CHANGED_BYTE] = (body[CHANGED_BYTE] as number) ^ 1;
      response.writeHead(answer.status, { 'content-type': answer.headers.get('content-type') ?? 'application/octet-stream' });
      response.end(body);
    })().catch(() => {
      response.writeHead(502);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(PORTS.tamper, '127.0.0.1', resolve));
  return tamper;
}
