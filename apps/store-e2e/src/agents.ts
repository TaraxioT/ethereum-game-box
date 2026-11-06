// The verifier's containers, as Docker sees them. `wrangler dev` names each one after its Worker, and the run's Worker has
// a name of its own, so nothing here can touch another run's containers.

import { execFileSync } from 'node:child_process';

import { runName } from './wrangler.ts';

/** The sidecar each container's traffic goes through. */
const SIDECAR = /-proxy$/;

const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim();

/** Every container of the run's verifier, sidecars too, running or not. */
function all(): string[] {
  const names = docker('ps', '--all', '--filter', `name=workerd-${runName('verifier')}-`, '--format', '{{.Names}}');
  return names ? names.split('\n') : [];
}

/** The agent containers running now. */
export function runningAgents(): string[] {
  const names = docker('ps', '--filter', `name=workerd-${runName('verifier')}-`, '--format', '{{.Names}}');
  return (names ? names.split('\n') : []).filter((name) => !SIDECAR.test(name));
}

/** Kills an agent's container, as a crash would. */
export function killAgent(name: string): void {
  docker('kill', name);
}

/** Removes whatever a run's containers left behind. */
export function removeAgents(): void {
  const names = all();
  if (names.length > 0) docker('rm', '--force', ...names);
}
