// The verifier (`apps/verifier`, EGB_VERIFIER_URL): `POST /judge` takes a match's signed log, and `GET /judge/<box>/<round>`
// says how it is going. What it answers about money is read here and shown, but only the chain pays: a wrong answer can't
// move a stake.
import type { JudgeRequest, JudgeStatus } from "@egb/shared/store";
import type { Hex } from "viem";

/** A request to the verifier waits this long for its answer. */
export const VERIFIER_TIMEOUT_MS = 15_000;

/** The log was taken, or why not: `again` when asking later may work (it couldn't be reached, or was down). */
export type VerifierReply = { readonly taken: true } | { readonly taken: false; readonly again: boolean; readonly error: string };

export interface Verifier {
  judge(request: JudgeRequest): Promise<VerifierReply>;
  /** Where a match has got to; null when it can't be told yet, or can't be reached. */
  status(box: string, round: number): Promise<JudgeStatus | null>;
}

const STATES: ReadonlySet<unknown> = new Set(["judging", "paying", "paid", "refunded", "failed"]);
const HASH = /^0x[0-9a-fA-F]{64}$/;
const BASE_UNITS = /^[0-9]{1,78}$/;

const isHash = (value: unknown): value is Hex | null => value === null || (typeof value === "string" && HASH.test(value));
const isPayouts = (value: unknown): value is readonly string[] | null =>
  value === null || (Array.isArray(value) && value.every((payout) => typeof payout === "string" && BASE_UNITS.test(payout)));

/** The reply as a `JudgeStatus`, or null when it isn't one. */
export function parseStatus(value: unknown): JudgeStatus | null {
  if (typeof value !== "object" || value === null) return null;
  const { state, payouts, tx, record, reason } = value as Record<string, unknown>;
  if (!STATES.has(state) || !isPayouts(payouts) || !isHash(tx) || !isHash(record)) return null;
  if (reason !== null && typeof reason !== "string") return null;
  return { state: state as JudgeStatus["state"], payouts, tx, record, reason };
}

export function verifierAt(base: string, fetcher: typeof fetch = fetch): Verifier {
  const url = (path: string): URL => new URL(path, base);
  const timeout = (): AbortSignal => AbortSignal.timeout(VERIFIER_TIMEOUT_MS);

  return {
    async judge(request) {
      let response: Response;
      try {
        response = await fetcher(url("/judge"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: timeout() });
      } catch (error) {
        return { taken: false, again: true, error: `the verifier can't be reached: ${error instanceof Error ? error.message : String(error)}` };
      }
      if (response.ok) return { taken: true };
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      const error = typeof body?.error === "string" ? body.error : `the verifier answered ${response.status}`;
      return { taken: false, again: response.status >= 500, error };
    },
    async status(box, round) {
      try {
        const response = await fetcher(url(`/judge/${box}/${round}`), { signal: timeout() });
        return response.ok ? parseStatus(await response.json()) : null;
      } catch {
        return null;
      }
    },
  };
}
