// The child processes of a run: each in its own group, so stopping one stops what it started, and its output kept for
// when it fails.

import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process';

/** How long a process gets to stop on its own. */
const STOP_MS = 5000;
/** The output kept for a failure's message. */
const TAIL_CHARS = 6000;

export interface Child {
  readonly process: ChildProcess;
  /** The last of what it said. */
  tail(): string;
  /** Resolves once it says something matching `text`; rejects if it stops first or `ms` runs out. */
  says(text: RegExp, ms: number): Promise<void>;
  stop(): Promise<void>;
}

export function start(name: string, command: string, args: readonly string[], options: SpawnOptions): Child {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let said = '';
  const hear = (chunk: Buffer) => {
    said = (said + String(chunk)).slice(-TAIL_CHARS);
  };
  child.stdout?.on('data', hear);
  child.stderr?.on('data', hear);

  const stopped = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const signal = (name: NodeJS.Signals) => {
    if (child.pid && child.exitCode === null && child.signalCode === null) process.kill(-child.pid, name);
  };

  return {
    process: child,
    tail: () => said,
    says(text, ms) {
      return new Promise((resolve, reject) => {
        const finish = (run: () => void) => {
          clearInterval(watch);
          clearTimeout(limit);
          child.off('exit', died);
          run();
        };
        const died = () => finish(() => reject(new Error(`${name} stopped:\n${said}`)));
        const limit = setTimeout(() => finish(() => reject(new Error(`${name} never said ${text}:\n${said}`))), ms);
        const watch = setInterval(() => {
          if (text.test(said)) finish(resolve);
        }, 50);
        child.once('exit', died);
      });
    },
    async stop() {
      signal('SIGTERM');
      const late = setTimeout(() => signal('SIGKILL'), STOP_MS);
      await stopped;
      clearTimeout(late);
    },
  };
}
