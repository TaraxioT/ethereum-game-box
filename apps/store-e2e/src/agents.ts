// The verifier's containers, as Docker sees them. `wrangler dev` names each one after its Worker, and the run's Worker has
// a name of its own, so nothing here can touch another run's containers.

import { execFileSync } from 'node:child_process';

import { whenCutShort } from './processes.ts';
import { runName } from './wrangler.ts';

/** The sidecar each container's traffic goes through. */
const SIDECAR = /-proxy$/;

const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim();

/** What `wrangler dev` starts each container's name with. */
export const agentPrefix = () => `workerd-${runName('verifier')}-`;

/** The run's containers, sidecars too. */
function listed(...flags: string[]): string[] {
  const names = docker('ps', ...flags, '--filter', `name=${agentPrefix()}`, '--format', '{{.Names}}');
  return names ? names.split('\n') : [];
}

/** The agent containers running now. */
export const runningAgents = () => listed().filter((name) => !SIDECAR.test(name));

/** What Docker holds of a container: what it was started with, whatever its shell is shown. */
export interface AgentConfig {
  /** All of it. */
  readonly text: string;
  /** Its environment, as `env` would list it. */
  readonly env: string;
  /** Its image's labels. */
  readonly labels: Readonly<Record<string, string>>;
}

export function agentConfig(name: string): AgentConfig {
  const text = docker('inspect', name);
  const [{ Config }] = JSON.parse(text) as [{ Config: { Env: string[]; Labels: Record<string, string> | null } }];
  return { text, env: Config.Env.join('\n'), labels: Config.Labels ?? {} };
}

/** Kills an agent's container, as a crash would. */
export function killAgent(name: string): void {
  docker('kill', name);
}

/** Every container of the run, running or not, sidecars too. */
export const leftBehind = () => listed('--all');

/** Removes whatever a run's containers left behind. */
export function removeAgents(): void {
  const names = leftBehind();
  if (names.length > 0) docker('rm', '--force', ...names);
}

// An interrupted run kills workerd, which is what would have stopped them.
whenCutShort(removeAgents);
