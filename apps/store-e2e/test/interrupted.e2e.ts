// What an interrupted run leaves behind: nothing. A run can't interrupt itself, so `run-to-interrupt.ts` is one in its own
// process, in its own group, sent what a terminal sends.

import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, it, vi } from 'vitest';

import { leftBehind, removeAgents } from '../src/agents.ts';

const RUN = fileURLToPath(new URL('run-to-interrupt.ts', import.meta.url));
/** Up to the first pull of the agent's base image. */
const UP_MS = 120_000;

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Resolves with the child process's PID once the run says it is up. */
const up = (run: ChildProcess) =>
  new Promise<number>((resolve, reject) => {
    const limit = setTimeout(() => reject(new Error('the run never came up')), UP_MS);
    run.stdout?.on('data', (chunk: Buffer) => {
      const pid = /^up (\d+)/.exec(String(chunk))?.[1];
      if (!pid) return;
      clearTimeout(limit);
      resolve(Number(pid));
    });
    run.once('exit', () => reject(new Error('the run stopped before it was up')));
  });

afterEach(removeAgents);

it.each(['SIGINT', 'SIGTERM', 'SIGHUP'] as const)('leaves no process or container behind on %s', async (signal) => {
  const run = spawn('node', [RUN], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
  const child = await up(run);
  expect(leftBehind()).toHaveLength(1);
  expect(isAlive(child)).toBe(true);

  process.kill(-(run.pid as number), signal);
  await once(run, 'exit');
  expect(run.signalCode).toBe(signal);
  expect(leftBehind()).toEqual([]);
  await vi.waitFor(() => expect(isAlive(child)).toBe(false));
});
