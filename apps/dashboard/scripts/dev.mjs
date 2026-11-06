import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dashboardRoot, publishedFiles } from './build.mjs';

const allowedPaths = new Set(publishedFiles);
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function createDashboardHandler({ root = dashboardRoot, production = false } = {}) {
  const base = resolve(root, production ? 'dist' : '.');
  const canonicalBase = realpath(base).catch(() => null);
  return async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    try {
      // Check before URL normalization so encoded dot segments cannot become a
      // legitimate published path. The same manifest controls build and serving.
      const pathname = decodeURIComponent((req.url ?? '').split('?')[0]);
      if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0')
        || pathname.split('/').some(segment => segment === '.' || segment === '..')) {
        res.writeHead(404).end('Not found');
        return;
      }
      const sitePath = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (!allowedPaths.has(sitePath)) {
        res.writeHead(404).end('Not found');
        return;
      }
      const canonical = await canonicalBase;
      if (!canonical) { res.writeHead(404).end('Not found'); return; }
      const file = await realpath(resolve(base, sitePath));
      const within = relative(canonical, file);
      if (within.startsWith('..') || isAbsolute(within) || !(await stat(file)).isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream',
        'Content-Length': data.byteLength,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      res.writeHead(404).end('Not found');
    }
  };
}

export function createDashboardServer(options) {
  return http.createServer(createDashboardHandler(options));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const production = process.argv.includes('--dist');
  const port = Number(process.env.DASHBOARD_PORT ?? 4174);
  const server = createDashboardServer({ production });
  server.listen(port, '127.0.0.1', () => console.log(`Gamebox dashboard: http://127.0.0.1:${server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
