// The core's chain port on the Box: every stake, result, refund, top-up and name goes to the relayer, each one the Box
// signs being signed by its P-256 key (the HYP2003 token), and the relayer pays the gas. Each request is followed on
// `GET /tx/:id` until it is done or failed; reads go to Sepolia (`reads.ts`). Sends never wait: the core hears every
// step through its watch.
//
// - open: a `Stake` to `POST /duel/open`, with the round from the rounds file, which notes the pot as open.
// - settle: a `Result` to `POST /box/result`, with the same round and the same two badges (the pot checks them).
// - refund: `POST /duel/refund`. A pot the Box lost track of (a restart, a reset) is refunded by the sweep once its
//   delay has run.
// - topup: `POST /usdc/topup`. claim: a `Seat` to `POST /players/box-claim` (a badge can't sign a `ClaimName`).
import {
  type Result,
  type Seat,
  type Stake,
  type TxView,
  contractAddress,
  resultDigest,
  seatDigest,
  stakeDigest,
  usdc,
} from "@egb/shared/names";
import type { Address, Hex } from "viem";
import type { ChainHead, ChainPort, ChainTxUpdate, Clock, ResultOrder, StakeOrder, TxWatch } from "../core/ports.ts";
import { chainLabel } from "../core/catalogue.ts";
import { recordText } from "../core/stats.ts";
import type { BoxSigner } from "../signer/signer.ts";
import type { Reads, Settled } from "./reads.ts";
import type { Relayer, RelayerReply } from "./relayer.ts";
import type { Rounds } from "./rounds.ts";

/** How long a signed message stays valid, in seconds. */
export const DEADLINE_S = 600;
/** `DuelPot.REFUND_DELAY` (one hour after the open), and a minute's margin for the head's lag. */
export const REFUND_AFTER_MS = 61 * 60_000;
/** How often a request's progress is asked for (the match waits on its pot's block, so this is short), and when the
 *  Box stops asking. */
export const POLL_MS = 1_000;
export const GIVE_UP_MS = 10 * 60_000;
/** How often the head is read for the screen's block clock. */
export const HEAD_MS = 4_000;
/** How often pots past their refund delay are looked for. */
export const SWEEP_MS = 5 * 60_000;

export interface SepoliaChainOptions {
  /** The Box's label, `mumbai-01`. */
  readonly box: string;
  readonly signer: BoxSigner;
  readonly relayer: Relayer;
  readonly reads: Reads;
  readonly rounds: Rounds;
  readonly clock: Clock;
  readonly log: (text: string) => void;
  /** The messages' verifying contracts (default: deployments/sepolia.json; tests pass the vectors'). */
  readonly contracts?: { readonly duelPot: Address; readonly boxResults: Address; readonly boxSeats: Address };
}

export interface SepoliaChain extends ChainPort {
  /** Moves the rounds file past any round the chain has already seen (a lost file, another install of this Box). */
  syncRounds(): Promise<void>;
  /** Refunds every pot the Box opened whose delay has run and that is still open. */
  sweep(): Promise<void>;
  /** Whether the signer's key is the one `GameBoxNames` holds for this Box, said in the log. */
  checkKey(): Promise<boolean>;
  /** The signer's public key. */
  publicKey(): Promise<{ readonly qx: Hex; readonly qy: Hex }>;
  stop(): void;
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th"] as const;
const short = (address: Address): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

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

function label(game: string): string {
  const found = chainLabel(game);
  if (!found) throw new Error(`${game} isn't on chain`);
  return found;
}

/** A match's stakes as the Box signs them: badge `a` is Player 1's. `deadline` is unix seconds. */
export function stakeOf(box: string, order: StakeOrder, deadline: bigint): Stake {
  return { box, game: label(order.game), round: BigInt(order.round), a: order.badges[0], b: order.badges[1], amount: usdc(order.amount), deadline };
}

/** A match's result as the Box signs it: a draw names Player 1 the winner and Player 2 the loser, with `draw` set. */
export function resultOf(box: string, order: ResultOrder, deadline: bigint): Result {
  const [a, b] = order.badges;
  const [winner, loser] = order.winner === 1 ? [b, a] : [a, b];
  return { box, game: label(order.game), round: BigInt(order.round), winner, loser, draw: order.winner === null, deadline };
}

/** A badge's player name as the Box vouches for it. */
export function seatOf(box: string, labelText: string, badge: Address, deadline: bigint): Seat {
  return { label: labelText, badge, box, deadline };
}

/** The lines the result screen shows, from what the chain says the result did. */
export function outcomeLines(order: ResultOrder, settled: Settled): string[] {
  const named = (seat: 0 | 1): string => settled.names[seat] ?? short(order.badges[seat]);
  const lines: string[] = [];
  if (order.winner === null) lines.push(settled.pot === null ? "A draw" : `A draw: ${settled.pot} USDC back to each`);
  else lines.push(settled.pot === null ? `${named(order.winner)} wins` : `${named(order.winner)} +${settled.pot * 2} USDC`);
  const { title } = settled;
  if (order.winner !== null && title && title.holder.toLowerCase() === order.badges[order.winner].toLowerCase()) {
    lines.push(`${named(order.winner)} now holds ${title.name}${title.streak > 1 ? `, streak ${title.streak}` : ""}`);
  }
  if (settled.cup) {
    for (const seat of [0, 1] as const) {
      const rank = settled.cup.standings.findIndex((row) => row.addr.toLowerCase() === order.badges[seat].toLowerCase());
      const row = settled.cup.standings[rank];
      if (row) lines.push(`${settled.cup.label}: ${named(seat)} ${ORDINALS[rank] ?? `${rank + 1}th`}, ${row.points} pts`);
    }
  }
  for (const seat of [0, 1] as const) {
    const stats = settled.stats[seat];
    if (stats) lines.push(`${named(seat)} stats: ${recordText(stats)}`);
  }
  return lines;
}

export function createSepoliaChain(options: SepoliaChainOptions): SepoliaChain {
  const { box, signer, relayer, reads, rounds, clock, log } = options;
  const contracts = options.contracts ?? {
    duelPot: contractAddress("DuelPot"),
    boxResults: contractAddress("BoxResults"),
    boxSeats: contractAddress("BoxSeats"),
  };
  /** Polls waiting to run. */
  const handles = new Set<ReturnType<Clock["after"]>>();
  const deadline = (): bigint => BigInt(Math.floor(clock.now() / 1000) + DEADLINE_S);
  const failed = (watch: TxWatch, error: string): void => watch({ step: "failed", hash: null, etherscan: null, block: null, error });

  /** Follows a request on `/tx/:id` until it is done or failed, reporting each new step. */
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
      const handle = clock.after(POLL_MS, () => {
        handles.delete(handle);
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
      handles.add(handle);
    };
    poll();
  }

  /** Signs `digest` and posts what `body` builds from the signature; a signer that can't sign fails the request. */
  function signed(what: string, digest: Hex, path: string, body: (sig: { r: Hex; s: Hex }) => unknown, watch: TxWatch, ended?: (paid: boolean) => void): void {
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
  }

  function refundRound(round: number, watch: TxWatch): void {
    void relayer.post("/duel/refund", { box, round: String(round) }).then((reply) =>
      follow(`refund ${round}`, reply, watch, (paid) => {
        if (paid) rounds.closed(round);
      }),
    );
  }

  const port: SepoliaChain = {
    onChain: (game) => chainLabel(game) !== null,
    nextRound: () => rounds.take(),
    refundAfterMs: REFUND_AFTER_MS,
    stakeNeedsName: true,
    balance: (address) => reads.balance(address),
    async player(address) {
      const [name, balance] = await Promise.all([reads.nameOf(address), reads.balance(address)]);
      return { address, name, balance, record: name ? await reads.stats(name) : null };
    },
    board: async (game) => reads.board(label(game)),
    open(order, watch) {
      const stake = stakeOf(box, order, deadline());
      rounds.opened(order.round, clock.now());
      const json = { ...stake, round: String(stake.round), amount: String(stake.amount), deadline: String(stake.deadline) };
      signed(`open ${order.round}`, stakeDigest(stake, contracts.duelPot), "/duel/open", (sig) => ({ stake: json, ...sig }), watch, (paid) => {
        if (!paid) rounds.closed(order.round);
      });
    },
    settle(order, watch) {
      const result = resultOf(box, order, deadline());
      const json = { ...result, round: String(result.round), deadline: String(result.deadline) };
      signed(`result ${order.round}`, resultDigest(result, contracts.boxResults), "/box/result", (sig) => ({ result: json, ...sig }), watch, (paid) => {
        if (paid) rounds.closed(order.round);
      });
    },
    refund: refundRound,
    topup(address, watch) {
      void relayer.post("/usdc/topup", { player: address }).then((reply) => follow(`top-up ${address}`, reply, watch));
    },
    claim(labelText, address, watch) {
      const seat = seatOf(box, labelText, address, deadline());
      const json = { ...seat, deadline: String(seat.deadline) };
      signed(`claim ${labelText}`, seatDigest(seat, contracts.boxSeats), "/players/box-claim", (sig) => ({ seat: json, ...sig }), watch);
    },
    async outcome(order, hash) {
      if (!hash) throw new Error("a result with no hash");
      return outcomeLines(order, await reads.settled(label(order.game), order.badges, hash));
    },
    watchHead(listener) {
      let last = 0;
      const read = (): void => {
        reads.head().then(
          (head: ChainHead) => {
            if (head.block === last) return;
            last = head.block;
            listener(head);
          },
          () => {},
        );
      };
      read();
      const handle = clock.every(HEAD_MS, read);
      return () => clock.cancel(handle);
    },
    async syncRounds() {
      for (let checked = 0; checked < 1_000; checked++) {
        const round = rounds.peek();
        if (!(await reads.roundTaken(box, round))) return;
        rounds.skipPast(round);
      }
    },
    async checkKey() {
      const [mine, registered] = await Promise.all([signer.publicKey(), reads.boxKey(box)]);
      const same = mine.qx.toLowerCase() === registered.qx.toLowerCase() && mine.qy.toLowerCase() === registered.qy.toLowerCase();
      log(same ? `chain: the signer's key is ${box}'s (${mine.qx.slice(0, 10)}…)` : `chain: the signer's key ${mine.qx.slice(0, 10)}… is not ${box}'s (${registered.qx.slice(0, 10)}…): the relayer will refuse every request`);
      return same;
    },
    publicKey: () => signer.publicKey(),
    async sweep() {
      for (const [round, openedAt] of rounds.open()) {
        if (clock.now() - openedAt < REFUND_AFTER_MS) continue;
        if (!(await reads.potOpen(box, round).catch(() => true))) {
          rounds.closed(round);
          continue;
        }
        log(`chain: refunding pot ${round}, left open since ${new Date(openedAt).toISOString()}`);
        refundRound(round, () => {});
      }
    },
    stop() {
      for (const handle of handles) clock.cancel(handle);
      handles.clear();
      signer.stop();
    },
  };
  return port;
}
