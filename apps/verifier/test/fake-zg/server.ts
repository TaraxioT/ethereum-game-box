// `FakeZg` on a real port, for an end-to-end run or a test that wants real HTTP.

import { type IncomingMessage, type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { FakeZg } from './index.ts';

export interface RunningFakeZg {
  readonly fake: FakeZg;
  readonly url: string;
  close(): Promise<void>;
}

async function toRequest(message: IncomingMessage, base: string): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of message as AsyncIterable<Buffer>) chunks.push(chunk);
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) if (typeof value === 'string') headers.set(name, value);
  const hasBody = message.method !== 'GET' && message.method !== 'HEAD';
  return new Request(new URL(message.url ?? '/', base), { method: message.method, headers, ...(hasBody && { body: Buffer.concat(chunks) }) });
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

export async function startFakeZg(port = 0): Promise<RunningFakeZg> {
  const fake = new FakeZg();
  const server = createServer((message, res) => {
    void (async () => {
      const response = await fake.handle(await toRequest(message, fake.url));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    })();
  });
  fake.url = `http://127.0.0.1:${await listen(server, port)}`;
  return {
    fake,
    url: fake.url,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
