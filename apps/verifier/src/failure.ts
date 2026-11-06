// Why a run failed. `why` is always our own text, safe for a Box's screen: it never quotes the model, the log or an
// upstream error.

import type { AgentVerdict } from '@egb/shared/store';

export interface Failure {
  /** `full` is no container being free: the run never started. */
  readonly kind: 'timeout' | 'zg' | 'tee' | 'cannot_judge' | 'verdict' | 'container' | 'lost' | 'full';
  readonly why: string;
  /** The agent's own answer, for the audit record, when it said it can't judge. */
  readonly answer?: Extract<AgentVerdict, { kind: 'cannot_judge' }>;
}

export const failed = (kind: Failure['kind'], why: string): Failure => ({ kind, why });
