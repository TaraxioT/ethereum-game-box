// The core's store port on Sepolia: `StorePot` and Store USDC through the relayer, and the match's log to the verifier.
//
// - open: a `Stake` naming the bundle's hash to `POST /store/open`. Rounds come from the same file as `DuelPot`'s, which
//   keeps the pot unless the open was refused outright, so the sweep refunds it if nobody else does, even one whose open
//   looked failed and landed.
// - judge: the log's exact JSON text and a `Judge` over its hash to the verifier, which is then asked how it is going
//   until it has paid, refunded or failed. A verifier that never answers is given up on. Its word is only shown: the pot
//   stays on the rounds file for the sweep either way.
// - refund: `POST /store/refund`, for anyone once the pot's delay has run.
// - topup: `POST /store/topup`.
import type { MatchLog } from "@egb/sdk";
import { formatUsdc, usdc } from "@egb/shared/names";
import { jsonTextHash, judgeDigest, storeStakeDigest, type Judge, type JudgeStatus, type StoreStake } from "@egb/shared/store";
import { ETHERSCAN } from "@egb/shared/web";
import type { Address } from "viem";
import type { Clock, JudgeOrder, StoreChainPort, StoreStakeOrder } from "../core/ports.ts";
import type { Judged } from "../core/types.ts";
import type { BoxSigner } from "../signer/signer.ts";
import type { Reads } from "./reads.ts";
import type { Relayer } from "./relayer.ts";
import type { Requests } from "./requests.ts";
import type { Rounds } from "./rounds.ts";
import type { Verifier } from "./verifier.ts";

/** How often the verifier is asked how a match is going. */
export const JUDGE_POLL_MS = 2_000;
/** The wait before a log the verifier didn't take goes again, doubling up to the second. A try can use up one of the
 *  judgements it allows a Box in an hour, so a short outage mustn't spend them. */
export const JUDGE_RETRY_MS = 5_000;
export const JUDGE_RETRY_MAX_MS = 2 * 60_000;
/** A run takes up to 7 minutes, then its one retry, then the transaction: past this, the Box stops waiting. */
export const JUDGE_GIVE_UP_MS = 20 * 60_000;

export interface StoreChainOptions {
  /** The Box's label, `mumbai-01`. */
  readonly box: string;
  readonly signer: BoxSigner;
  readonly relayer: Relayer;
  readonly requests: Requests;
  readonly reads: Reads;
  readonly rounds: Rounds;
  readonly verifier: Verifier;
  /** `Stake`'s and `Judge`'s verifying contract. */
  readonly storePot: Address;
  readonly clock: Clock;
  /** Unix seconds a signed message made now is good until. */
  readonly deadline: () => bigint;
  readonly log: (text: string) => void;
}

/** A store match's stakes as the Box signs them, in seat order. */
export function storeStakeOf(box: string, order: StoreStakeOrder, deadline: bigint): StoreStake {
  return { box, bundle: order.bundle, round: BigInt(order.round), players: order.badges, amount: usdc(order.amount), deadline };
}

/** A closed match's log, as the verifier reads it. */
export function matchLogOf(box: string, order: JudgeOrder): MatchLog {
  const { round, bundle, game, badges, amount, startedAt, entries } = order;
  return { header: { v: 1, box, round: String(round), bundle, game, players: badges, amount: String(usdc(amount)), startedAt }, entries };
}

/** What the verifier said, in whole USDC and with its transaction's page. */
function judgedOf(status: JudgeStatus): Judged {
  const { state: step, payouts, tx: hash, reason } = status;
  return { step, payouts: payouts?.map((payout) => Number(formatUsdc(BigInt(payout)))) ?? null, hash, etherscan: hash && `${ETHERSCAN}/tx/${hash}`, reason };
}

const over = (step: Judged["step"]): boolean => step === "paid" || step === "refunded" || step === "failed";

export function createStoreChain(options: StoreChainOptions): StoreChainPort {
  const { box, signer, relayer, requests, reads, rounds, verifier, storePot, clock, deadline, log } = options;

  return {
    balance: (address) => reads.storeBalance(address),
    open(order, watch) {
      const stake = storeStakeOf(box, order, deadline());
      rounds.opened(order.round, clock.now(), "store");
      const json = { ...stake, round: String(stake.round), amount: String(stake.amount), deadline: String(stake.deadline) };
      requests.signed(`store open ${order.round}`, storeStakeDigest(stake, storePot), "/store/open", (sig) => ({ stake: json, ...sig }), watch, (end) => {
        if (end === "refused") rounds.closed(order.round);
      });
    },
    refund(round, watch) {
      void relayer.post("/store/refund", { box, round: String(round) }).then((reply) =>
        requests.follow(`store refund ${round}`, reply, watch, (end) => {
          if (end === "paid") rounds.closed(round);
        }),
      );
    },
    topup(address, watch) {
      void relayer.post("/store/topup", { player: address }).then((reply) => requests.follow(`store top-up ${address}`, reply, watch));
    },
    judge(order, watch) {
      const { round } = order;
      const text = JSON.stringify(matchLogOf(box, order));
      const logHash = jsonTextHash(text);
      const started = clock.now();
      let last = "";

      /** Tells the core what's new, and whether that was the end of it. */
      const tell = (update: Judged): boolean => {
        const key = `${update.step}:${update.hash ?? ""}`;
        if (key !== last) {
          last = key;
          log(`store: round ${round} ${update.step}${update.reason ? `: ${update.reason}` : ""}`);
          watch(update);
        }
        return over(update.step);
      };
      const fail = (reason: string): void => void tell({ step: "failed", payouts: null, hash: null, etherscan: null, reason });
      const again = (ms: number, run: () => void): void => {
        if (clock.now() - started > JUDGE_GIVE_UP_MS) fail("no answer from the verifier");
        else requests.later(ms, run);
      };

      const ask = (): void => {
        void verifier.status(box, round).then((status) => {
          const update = status && judgedOf(status);
          // Whatever it says, the pot stays on the rounds file: only the chain ends one, and the sweep reads the chain.
          if (!update || !tell(update)) again(JUDGE_POLL_MS, ask);
        });
      };
      /** One try. Each is signed afresh: the last deadline may have passed, and the log's hash is what names the match. */
      const send = (tries: number): void => {
        const judge: Judge = { box, round: BigInt(round), log: logHash, deadline: deadline() };
        signer
          .sign(judgeDigest(judge, storePot))
          .then((sig) => verifier.judge({ log: text, deadline: String(judge.deadline), ...sig }))
          .then(
            (reply) => {
              if (reply.taken) return ask();
              if (reply.again) return again(Math.min(JUDGE_RETRY_MS * 2 ** tries, JUDGE_RETRY_MAX_MS), () => send(tries + 1));
              fail(reply.error);
            },
            (error: unknown) => fail(error instanceof Error ? error.message : String(error)),
          );
      };

      send(0);
    },
  };
}
