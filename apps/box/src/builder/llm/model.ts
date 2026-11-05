// The model client: one small structured call (words in, a validated JSON answer out) that must come back fast.
// `claude-haiku-5-5`, through the Anthropic API when ANTHROPIC_API_KEY is set (one HTTPS request, the quickest path),
// else through the Claude Agent SDK on the Pi's Claude Code login. Every caller has a rules fallback, so every failure
// (a timeout, no login, a reply that fails validation) is a rejection, never a guess, and no call outlives its deadline.
import { claudeReady, type Env, type ReadyCheck } from "./claude-env.ts";
import { createApiBackend } from "./api.ts";
import { createSdkBackend, type QueryFn } from "./sdk.ts";

export const MODEL = "claude-haiku-5-5";

export type JsonSchema = Readonly<Record<string, unknown>>;

/** What a backend is asked: the model's words go in `system` and `prompt`, its answer must match `schema`. */
export interface BackendCall {
  readonly model: string;
  readonly system: string;
  readonly prompt: string;
  readonly schema: JsonSchema;
  /** Aborted at the deadline: the backend stops its request or child process. */
  readonly signal: AbortSignal;
}

/** One way of reaching the model. Resolves with the raw JSON value, unvalidated. */
export interface ModelBackend {
  run(call: BackendCall): Promise<unknown>;
}

export interface ModelRequest<T> {
  readonly system: string;
  readonly prompt: string;
  readonly schema: JsonSchema;
  /** Validates the raw answer: the typed value, or null to reject it. */
  readonly parse: (value: unknown) => T | null;
  readonly timeoutMs: number;
  /** The caller gave up (a newer answer superseded this one). */
  readonly signal?: AbortSignal;
}

export type ModelProvider = "api" | "sdk" | "off";

export interface ModelClient {
  readonly provider: ModelProvider;
  /** Why the provider is `off`, for the status line. */
  readonly reason: string | null;
  json<T>(req: ModelRequest<T>): Promise<T>;
}

export interface ModelDeps extends ReadyCheck {
  /** The Agent SDK's `query` (tests); otherwise the SDK is imported on the first call, not at boot (~40 MB). */
  readonly query?: QueryFn;
  readonly fetch?: typeof fetch;
}

/** EGB_MODEL=off turns the model off: every answer is read by keywords. */
export function createModelClient(env: Env, deps: ModelDeps = {}): ModelClient {
  if (env.EGB_MODEL === "off") return offClient("The model is off (EGB_MODEL=off): answers are read by keywords.");
  if (env.ANTHROPIC_API_KEY) return clientOver("api", createApiBackend(env.ANTHROPIC_API_KEY, deps.fetch ?? fetch));
  const ready = claudeReady(env, deps);
  if (!ready.ok) return offClient(ready.reason);
  return clientOver("sdk", createSdkBackend(env, deps.query));
}

function offClient(reason: string | null): ModelClient {
  return {
    provider: "off",
    reason,
    json: () => Promise.reject(new Error("the model is off")),
  };
}

/** A client over one backend: the deadline, the caller's abort and validation, the same for both. */
export function clientOver(provider: "api" | "sdk", backend: ModelBackend): ModelClient {
  return {
    provider,
    reason: null,
    json<T>(req: ModelRequest<T>): Promise<T> {
      const controller = new AbortController();
      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          req.signal?.removeEventListener("abort", onAbort);
          fn();
        };
        // The deadline rejects on time even if a backend ignores its abort signal: the caller never waits longer.
        const timer = setTimeout(() => {
          controller.abort();
          settle(() => reject(new Error(`the model timed out after ${req.timeoutMs} ms`)));
        }, req.timeoutMs);
        const onAbort = () => {
          controller.abort();
          settle(() => reject(new Error("the caller gave up")));
        };
        if (req.signal?.aborted) return onAbort();
        req.signal?.addEventListener("abort", onAbort, { once: true });
        backend
          .run({ model: MODEL, system: req.system, prompt: req.prompt, schema: req.schema, signal: controller.signal })
          .then(
            (raw) => {
              const value = req.parse(raw);
              settle(() => (value === null ? reject(new Error("the model's answer failed validation")) : resolve(value)));
            },
            (err: unknown) => settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
          );
      });
    },
  };
}
