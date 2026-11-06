// The admin key's transactions, run as jobs: a job is answered at once and its calls go in the background, one after
// another, each step with its hash and Etherscan link as it is sent. The admin panel and the lease both run theirs
// here. Every error that leaves has its URLs replaced by `<rpc>`.
import { type AdminCall, type AdminSender, AdminInputError, AdminRefused } from "@egb/shared/admin";
import { ETHERSCAN } from "@egb/shared/web";
import { redact } from "../chain/reads.ts";
import type { AdminJob, AdminStep } from "./admin-wire.ts";
import { HttpError } from "./http.ts";

/** Jobs kept for the screen. */
const JOBS_KEPT = 12;

/** An error's first line, its URLs redacted. */
export const reason = (error: unknown): string =>
  redact(error instanceof AdminRefused ? error.message : error instanceof Error ? error.message.split("\n")[0] ?? "" : String(error));

/** Builds the calls; a refusal of the input is a 400. */
export function built<T>(build: () => T): T {
  try {
    return build();
  } catch (error) {
    if (error instanceof AdminInputError) throw new HttpError(400, error.message);
    throw error;
  }
}

export interface JobsOptions {
  readonly sender: AdminSender;
  /** Unix ms. */
  now(): number;
  log(text: string): void;
  /** The log lines' prefix: `admin`, `lease`. */
  readonly tag: string;
  /** A job finished, done or failed. */
  settled(): void;
}

export interface Jobs {
  /** Starts `calls` as a job: answered at once, run in the background. */
  start(what: string, calls: readonly AdminCall[]): AdminJob;
  /** Newest first. */
  list(): AdminJob[];
  /** A job is still sending. */
  running(): boolean;
}

export function createJobs(options: JobsOptions): Jobs {
  const { sender, now, log, tag } = options;
  const jobs: AdminJob[] = [];
  let nextId = 1;

  function update(id: number, change: Partial<AdminJob>): void {
    const i = jobs.findIndex((job) => job.id === id);
    const job = jobs[i];
    if (job) jobs[i] = { ...job, ...change };
  }

  return {
    start(what, calls) {
      const job: AdminJob = { id: nextId++, what, status: "running", steps: [], error: null, at: now() };
      jobs.unshift(job);
      jobs.length = Math.min(jobs.length, JOBS_KEPT);
      log(`${tag}: job ${job.id} ${what}`);
      const steps: AdminStep[] = [];
      void sender
        .send(calls, (step, hash) => {
          steps.push({ what: step, hash, etherscan: `${ETHERSCAN}/tx/${hash}` });
          update(job.id, { steps: [...steps] });
          log(`${tag}: job ${job.id} sent ${step}: ${hash}`);
        })
        .then(() => {
          update(job.id, { status: "done" });
          log(`${tag}: job ${job.id} done`);
        })
        .catch((error: unknown) => {
          const why = reason(error);
          update(job.id, { status: "failed", error: why });
          log(`${tag}: job ${job.id} failed: ${why}`);
        })
        .finally(options.settled);
      return job;
    },
    list: () => [...jobs],
    running: () => jobs.some((job) => job.status === "running"),
  };
}
