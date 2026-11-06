// A Worker on `wrangler dev --local`: its real code, on workerd, from its real config with only what a run must change.
// That is its name (so its containers are the run's own), every URL, and `deployments/sepolia.json`, swapped at the
// bundler. Service bindings go too, so the verifier reaches the relayer and the store at their URLs.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ROOT } from './paths.ts';
import { type Child, start } from './processes.ts';

/** The newest date the runtime in wrangler 4.111 can run (see `apps/store/wrangler.jsonc`). */
const COMPATIBILITY_DATE = '2026-07-17';
/** Building the container's image takes this long at worst, on a cold cache. */
const READY_MS = 5 * 60_000;

export interface WorkerOptions {
  /** The folder under `apps/`. */
  readonly app: string;
  readonly port: number;
  readonly inspectorPort: number;
  /** What goes in `.dev.vars`. */
  readonly secrets: Record<string, string>;
  readonly vars: Record<string, string>;
  /** The run's `deployments/sepolia.json`. */
  readonly deployments: string;
  /** The run's folder. */
  readonly work: string;
}

interface Config {
  name: string;
  main: string;
  vars?: Record<string, string>;
  containers?: { image: string }[];
  [key: string]: unknown;
}

/** The app's `wrangler.jsonc`. Its comments are whole lines, and a URL's `//` isn't one. */
const readConfig = (folder: string): Config =>
  JSON.parse(readFileSync(path.join(folder, 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, '')) as Config;

/** The Worker's name in a run. */
export const runName = (app: string) => `${readConfig(path.join(ROOT, 'apps', app)).name}-e2e`;

/** Starts the Worker, and resolves once Wrangler says it is ready. */
export async function startWorker({ app, port, inspectorPort, secrets, vars, deployments, work }: WorkerOptions): Promise<Child> {
  const source = path.join(ROOT, 'apps', app);
  const folder = path.join(work, app);
  mkdirSync(folder, { recursive: true });

  const { account_id: _account, observability: _observability, services: _services, ...config } = readConfig(source);
  writeFileSync(
    path.join(folder, 'wrangler.json'),
    JSON.stringify({
      ...config,
      name: runName(app),
      main: path.join(source, config.main),
      compatibility_date: COMPATIBILITY_DATE,
      vars: { ...config.vars, ...vars },
      alias: {
        '../../../deployments/sepolia.json': deployments,
        '../../../../deployments/sepolia.json': deployments,
      },
      ...(config.containers && {
        containers: config.containers.map((container) => ({ ...container, image: path.resolve(source, container.image) })),
      }),
    }),
  );
  writeFileSync(path.join(folder, '.dev.vars'), Object.entries(secrets).map(([name, value]) => `${name}=${value}\n`).join(''));

  const args = ['dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(inspectorPort)];
  args.push('--persist-to', path.join(folder, 'state'), '--show-interactive-dev-session=false');
  const child = start(app, 'wrangler', args, { cwd: folder, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  await child.says(/Ready on/, READY_MS);
  return child;
}
