// A request through the relayer, from the Box's signature to its end: each one is followed on `GET /tx/:id` until it is
// done or failed, and every new step goes to the core's watch. Sends never wait. The pots of team and store games go
// through here alike.
import type { TxView } from "@egb/shared/names";
import type { Hex } from "viem";
import type { ChainTxUpdate, Clock, TxWatch } from "../core/ports.ts";
import type { BoxSigner } from "../signer/signer.ts";
import type { Relayer, RelayerReply } from "./relayer.ts";

/** How often a request's progress is asked for (the match waits on its pot's block, so this is short), and when the
 *  Box stops asking. */
export const POLL_MS = 1_000;
export const GIVE_UP_MS = 10 * 60_000;

export interface RequestsOptions {
  readonly signer: BoxSigner;
  readonly relayer: Relayer;
  readonly clock: Clock;
  readonly log: (text: string) => void;
}

export interface Requests {
  /** Follows a request until it is done or failed, reporting each new step. */
  follow(what: string, reply: RelayerReply, watch: TxWatch, ended?: (paid: boolean) => void): void;
  /** Signs `digest` and posts what `body` builds from the signature; a signer that can't sign fails the request. */
  signed(what: string, digest: Hex, path: string, body: (sig: { r: Hex; s: Hex }) => unknown, watch: TxWatch, ended?: (paid: boolean) => void): void;
  /** Runs `run` after `ms`, unless the port stops first. */
  later(ms: number, run: () => void): void;
  stop(): void;
}

/** The relayer's statuses as the tx bar's steps (`done` is paid). */
function stepOf(view: TxView): ChainTxUpdate["step"] | null {
  switch (view.status) {
    case "signed":
      return null;
    case "sent":
      return "sent";
    case "in-block":
      return "in-block";
    case "done":
      return "paid";
    case "failed":
      return "failed";
  }
}

export function createRequests({ signer, relayer, clock, log }: RequestsOptions): Requests {
  /** Timers waiting to run. */
  const handles = new Set<ReturnType<Clock["after"]>>();
  const failed = (watch: TxWatch, error: string): void => watch({ step: "failed", hash: null, etherscan: null, block: null, error });

  function later(ms: number, run: () => void): void {
    const handle = clock.after(ms, () => {
      handles.delete(handle);
      run();
    });
    handles.add(handle);
  }

  function follow(what: string, reply: RelayerReply, watch: TxWatch, ended?: (paid: boolean) => void): void {
    if (!("tx" in reply)) {
      log(`chain: ${what} refused: ${reply.error}`);
      failed(watch, reply.error);
      ended?.(false);
      return;
    }
    const started = clock.now();
    let last: string | null = null;
    const apply = (view: TxView): boolean => {
      const step = stepOf(view);
      const key = `${step}:${view.hash ?? ""}:${view.block ?? ""}`;
      if (step && key !== last) {
        last = key;
        if (step === "in-block") log(`chain: ${what} in block ${view.block ?? "?"}`);
        watch({ step, hash: view.hash ?? null, etherscan: view.etherscan ?? null, block: view.block ?? null, error: view.error ?? null });
      }
      if (step === "paid" || step === "failed") {
        log(`chain: ${what} ${step}${view.hash ? ` ${view.hash}` : ""}${view.error ? `: ${view.error}` : ""}`);
        ended?.(step === "paid");
        return true;
      }
      return false;
    };
    if (apply(reply.tx)) return;
    const id = reply.tx.id;
    const poll = (): void => {
      later(POLL_MS, () => {
        void relayer.tx(id).then((next) => {
          if ("tx" in next && apply(next.tx)) return;
          if (clock.now() - started > GIVE_UP_MS) {
            failed(watch, `no answer from the relayer for request ${id}`);
            ended?.(false);
            return;
          }
          poll();
        });
      });
    };
    poll();
  }

  return {
    follow,
    signed(what, digest, path, body, watch, ended) {
      signer
        .sign(digest)
        .then((sig) => relayer.post(path, body(sig)))
        .then(
          (reply) => follow(what, reply, watch, ended),
          (error: unknown) => {
            const reason = error instanceof Error ? error.message : String(error);
            log(`chain: ${what} not signed: ${reason}`);
            failed(watch, reason);
            ended?.(false);
          },
        );
    },
    later,
    stop() {
      for (const handle of handles) clock.cancel(handle);
      handles.clear();
    },
  };
}
