// A run at its smallest, for `interrupted.e2e.ts`: a child process and a container, with the run's own modules looking
// after them, up until a signal comes.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { agentPrefix } from '../src/agents.ts';
import { ROOT } from '../src/paths.ts';
import { start } from '../src/processes.ts';

/** The image the agent's own is built on, so a run needs nothing more. */
const dockerfile = readFileSync(path.join(ROOT, 'apps/verifier/container/Dockerfile'), 'utf8');
const image = /^FROM (\S+)/m.exec(dockerfile)?.[1] ?? '';

const child = start('a child', 'sleep', ['300'], {});
execFileSync('docker', ['run', '--detach', '--platform', 'linux/amd64', '--name', `${agentPrefix()}interrupted`, image, 'sleep', '300'], { stdio: 'ignore' });
console.log(`up ${child.process.pid}`);
setInterval(() => undefined, 1000);
