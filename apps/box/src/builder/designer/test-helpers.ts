// Fakes for the Designer's tests: a shelf, and a model whose answers the test controls.
import type { DesignerModelAnswer } from "../llm/designer.ts";
import type { ModelClient, ModelRequest } from "../llm/model.ts";
import type { ShelfPort, ShelfTemplate } from "./shelf.ts";

export const QUICK_DRAW: ShelfTemplate = { id: "quick-draw", label: "Quick Draw", default: true };
/** A template that fixes its mechanic: the Designer never asks it. */
export const STOCK_DUEL: ShelfTemplate = {
  id: "stock-duel",
  label: "Stock Duel",
  default: false,
  mechanic: "Each player picks a stock from a turning hand; the better move wins the round.",
};
export const SHELF: readonly ShelfTemplate[] = [STOCK_DUEL, QUICK_DRAW];

export const shelfPort = (templates: readonly ShelfTemplate[] = SHELF): ShelfPort => ({ templates: () => templates });

export const NOTHING: DesignerModelAnswer = {
  template: null,
  mechanic: null,
  theme: null,
  twist: null,
  stakes: null,
  voice: null,
  title: null,
  build: false,
  change: null,
};

/**
 * A model that answers each call with what the test's `reply` gives (a value, or a promise the test settles later),
 * run through the request's own validation, as the real client does; it honours the caller's abort.
 */
export function fakeModel(reply: (prompt: string) => unknown): ModelClient & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    provider: "api",
    reason: null,
    prompts,
    json<T>(req: ModelRequest<T>): Promise<T> {
      prompts.push(req.prompt);
      return new Promise<T>((resolve, reject) => {
        req.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        Promise.resolve(reply(req.prompt)).then((raw) => {
          const v = req.parse(raw);
          if (v === null) reject(new Error("invalid"));
          else resolve(v);
        }, reject);
      });
    },
  };
}

export const offModel: ModelClient = { provider: "off", reason: "off in tests", json: () => Promise.reject(new Error("off")) };

/** A promise the test settles by hand. */
export function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
