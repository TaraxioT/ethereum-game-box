import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { buildDashboard, dashboardRoot, publishedFiles } from '../scripts/build.mjs';
import { createDashboardHandler } from '../scripts/dev.mjs';

let temporary;
let output;

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'gamebox-dashboard-'));
  output = join(temporary, 'dist');
  await mkdir(output);
  await writeFile(join(output, 'stale.txt'), 'old deployment');
  await buildDashboard({ output });
});
after(async () => { await rm(temporary, { recursive: true, force: true }); });

async function listFiles(root, prefix = '') {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const lists = await Promise.all(entries.map(entry => {
    const relative = posix.join(prefix, entry.name);
    return entry.isDirectory() ? listFiles(root, relative) : [relative];
  }));
  return lists.flat().sort();
}

test('build emits only published site files and preserves their bytes', async () => {
  assert.deepEqual(await listFiles(output), [...publishedFiles].sort());
  for (const file of publishedFiles) {
    assert.deepEqual(await readFile(join(output, file)), await readFile(join(dashboardRoot, file)), file);
  }
});

test('built HTML and CSS asset references resolve locally in the deployment', async () => {
  const html = await readFile(join(output, 'index.html'), 'utf8');
  const css = await readFile(join(output, 'theme.css'), 'utf8');
  const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);
  references.push(...[...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/g)].map(match => match[1] ?? match[2] ?? match[3]));
  assert.ok(references.length >= 10, 'the actual script, style and font graph was inspected');
  for (const reference of references) {
    if (reference.startsWith('#') || reference.startsWith('data:')) continue;
    const url = new URL(reference, 'https://dashboard.example/');
    assert.equal(url.origin, 'https://dashboard.example', `external request: ${reference}`);
    const file = decodeURIComponent(url.pathname.slice(1));
    assert.ok(publishedFiles.includes(file), `unpublished asset: ${reference}`);
    assert.ok((await readFile(join(output, file))).byteLength > 0, reference);
  }
  const scriptOrder = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)].map(match => match[1]);
  assert.deepEqual(scriptOrder, ['assets/vendor/gsap.min.js', 'art.js', 'motion.js', 'app.js']);
});

async function get(handler, path, method = 'GET') {
  const response = { status: null, headers: {}, body: null };
  const res = {
    writeHead(status, headers = {}) {
      response.status = status;
      response.headers = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)]));
      return this;
    },
    end(data) { response.body = Buffer.from(data ?? ''); return this; },
  };
  await handler({ url: path, method }, res);
  return response;
}

async function withServer(options, run) {
  // Exercise the exact HTTP handler without requiring permission to bind a
  // local socket; direct script invocation uses this handler in node:http.
  await run(createDashboardHandler(options));
}

for (const production of [false, true]) {
  test(`${production ? 'built preview' : 'development'} handler serves site bytes and MIME types, handles HEAD and rejects private paths`, async () => {
    await withServer({ root: production ? temporary : dashboardRoot, production }, async server => {
      const expectedTypes = {
        '/': 'text/html; charset=utf-8',
        '/theme.css': 'text/css; charset=utf-8',
        '/app.js': 'text/javascript; charset=utf-8',
        '/assets/vendor/gsap.min.js': 'text/javascript; charset=utf-8',
        '/assets/brand-mark.svg': 'image/svg+xml; charset=utf-8',
        '/assets/fonts/oxanium-latin-variable.woff2': 'font/woff2',
        '/assets/fonts/LICENSE-Oxanium.txt': 'text/plain; charset=utf-8',
      };
      for (const file of publishedFiles) {
        const path = `/${file}`;
        const response = await get(server, path);
        assert.equal(response.status, 200, path);
        assert.deepEqual(response.body, await readFile(join(dashboardRoot, file)), path);
        assert.equal(response.headers['x-content-type-options'], 'nosniff', path);
      }
      for (const [path, type] of Object.entries(expectedTypes)) {
        const response = await get(server, path);
        const head = await get(server, path, 'HEAD');
        assert.equal(response.headers['content-type'], type, path);
        assert.equal(head.status, 200, path);
        assert.equal(head.body.byteLength, 0, path);
        assert.equal(head.headers['content-type'], type, path);
        assert.equal(head.headers['content-length'], String(response.body.byteLength), path);
      }
      const query = await get(server, '/app.js?v=1');
      assert.equal(query.status, 200);
      const post = await get(server, '/app.js', 'POST');
      assert.equal(post.status, 405);
      assert.equal(post.headers.allow, 'GET, HEAD');
      for (const path of [
        '/README.md', '/wrangler.jsonc', '/package.json', '/scripts/dev.mjs', '/tests/static.test.js',
        '/.env', '/assets/vendor/unknown.js', '/missing', '/assets/../app.js', '/%2e%2e/app.js',
        '/assets/%2e%2e/app.js', '//app.js', '/%2fapp.js', '/theme.css%00', '/%ZZ', '/assets%5c..%5capp.js',
      ]) {
        assert.equal((await get(server, path)).status, 404, path);
      }
    });
  });
}

test('development server rejects a published filename symlinked outside its root', async () => {
  const fixture = join(temporary, 'symlink-fixture');
  const outside = join(temporary, 'private.txt');
  await mkdir(fixture);
  await writeFile(outside, 'not part of the public website');
  await symlink(outside, join(fixture, 'app.js'));
  await withServer({ root: fixture }, async server => {
    assert.equal((await get(server, '/app.js')).status, 404);
  });
});
