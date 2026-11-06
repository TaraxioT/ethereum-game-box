// The Workers the verifier calls on the same account, and what it asks of them.

import type { TxView } from '@egb/shared/names';

export type Upstream = (path: string, init?: RequestInit) => Promise<Response>;

/** A Worker through its service binding when there is one (a Worker can't fetch another Worker's workers.dev URL on the
 *  same account), else at `base`. */
export function upstream(binding: Fetcher | undefined, base: string): Upstream {
  return (path, init) => {
    const request = new Request(new URL(path, base), init);
    return binding ? binding.fetch(request) : fetch(request);
  };
}

/** A send the relayer took, or the status it refused with: 0 if it couldn't be reached. */
export type Sent = { readonly tx: TxView } | { readonly refused: number };

export interface PayRelayer {
  send(path: '/store/settle' | '/store/void', body: unknown): Promise<Sent>;
  /** A request's progress, or null if the relayer doesn't know it or can't be reached. */
  tx(id: string): Promise<TxView | null>;
}

export function payRelayer(relayer: Upstream): PayRelayer {
  return {
    async send(path, body) {
      const response = await relayer(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => null);
      if (!response) return { refused: 0 };
      if (response.status !== 202) return { refused: response.status };
      return { tx: (await response.json()) as TxView };
    },
    async tx(id) {
      const response = await relayer(`/tx/${id}`).catch(() => null);
      return response?.ok ? ((await response.json()) as TxView) : null;
    },
  };
}
