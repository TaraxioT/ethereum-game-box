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
// - store: a store game's money and judge (`store.ts`), once `StorePot` is deployed and the verifier is set.
import {
  type Result,
  type Seat,
  type Stake,
  contractAddress,
  resultDigest,
  seatDigest,
  stakeDigest,
  usdc,
} from "@egb/shared/names";
import { DUEL_SEATS, type DuelSeat } from "@egb/sdk";
import { type Address, type Hex, isAddressEqual } from "viem";
import type { ChainHead, ChainPort, Clock, ResultOrder, StakeOrder, TxWatch } from "../core/ports.ts";
import { chainLabel } from "../core/catalogue.ts";
import { recordText } from "../core/stats.ts";
import type { CupPlace, Settlement } from "../core/types.ts";
import type { BoxSigner } from "../signer/signer.ts";
import type { Reads, Settled } from "./reads.ts";
import type { Relayer } from "./relayer.ts";
import { createRequests } from "./requests.ts";
import type { Rounds } from "./rounds.ts";
import { createStoreChain } from "./store.ts";
import type { Verifier } from "./verifier.ts";

/** How long a signed message stays valid, in seconds. */
export const DEADLINE_S = 600;
/** `DuelPot.REFUND_DELAY` (one hour after the open), and a minute's margin for the head's lag. */
export const REFUND_AFTER_MS = 61 * 60_000;
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
  /** Store games' pot and judge. Absent: this Box has none. */
  readonly store?: { readonly storePot: Address; readonly verifier: Verifier } | undefined;
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

function label(game: string): string {
  const found = chainLabel(game);
  if (!found) throw new Error(`${game} isn't on chain`);
  return found;
}

/** `DuelPot` and `BoxResults` hold two: a team game's two players, whatever an order can list. */
function pair(badges: readonly Address[]): readonly [Address, Address] {
  const [a, b] = badges;
  if (!a || !b || badges.length !== 2) throw new Error("a team game's match has two players");
  return [a, b];
}

/** A match's stakes as the Box signs them: badge `a` is Player 1's. `deadline` is unix seconds. */
export function stakeOf(box: string, order: StakeOrder, deadline: bigint): Stake {
  const [a, b] = pair(order.badges);
  return { box, game: label(order.game), round: BigInt(order.round), a, b, amount: usdc(order.amount), deadline };
}

/** A match's result as the Box signs it: a draw names Player 1 the winner and Player 2 the loser, with `draw` set. */
export function resultOf(box: string, order: ResultOrder, deadline: bigint): Result {
  const [a, b] = pair(order.badges);
  const [winner, loser] = order.winner === 1 ? [b, a] : [a, b];
  return { box, game: label(order.game), round: BigInt(order.round), winner, loser, draw: order.winner === null, deadline };
}

/** A badge's player name as the Box vouches for it. */
export function seatOf(box: string, labelText: string, badge: Address, deadline: bigint): Seat {
  return { label: labelText, badge, box, deadline };
}

/** What the result did, from what the chain says at its receipt: the facts the result screen announces, and its lines. */
export function settlementOf(order: ResultOrder, settled: Settled): Settlement {
  const badges = pair(order.badges);
  const holds = order.winner !== null && settled.title !== null && isAddressEqual(settled.title.holder, badges[order.winner]);
  const placeOf = (seat: DuelSeat): CupPlace | null => {
    const rank = settled.cup?.standings.findIndex((row) => isAddressEqual(row.addr, badges[seat])) ?? -1;
    const row = settled.cup?.standings[rank];
    return row ? { rank, points: row.points } : null;
  };
  return {
    lines: outcomeLines(order, settled),
    names: settled.names,
    paid: settled.pot === null ? null : order.winner === null ? settled.pot : settled.pot * 2,
    title: holds && settled.title ? { name: settled.title.name, streak: settled.title.streak } : null,
    cup: settled.cup ? { name: settled.cup.name, places: DUEL_SEATS.map(placeOf) } : null,
    stats: settled.stats,
  };
}

/** The lines the result screen shows, from what the chain says the result did. */
function outcomeLines(order: ResultOrder, settled: Settled): string[] {
  const badges = pair(order.badges);
  const named = (seat: DuelSeat): string => settled.names[seat] ?? short(badges[seat]);
  const lines: string[] = [];
  if (order.winner === null) lines.push(settled.pot === null ? "A draw" : `A draw: ${settled.pot} USDC back to each`);
  else lines.push(settled.pot === null ? `${named(order.winner)} wins` : `${named(order.winner)} +${settled.pot * 2} USDC`);
  const { title } = settled;
  if (order.winner !== null && title && title.holder.toLowerCase() === badges[order.winner].toLowerCase()) {
    lines.push(`${named(order.winner)} now holds ${title.name}${title.streak > 1 ? `, streak ${title.streak}` : ""}`);
  }
  if (settled.cup) {
    for (const seat of DUEL_SEATS) {
      const rank = settled.cup.standings.findIndex((row) => row.addr.toLowerCase() === badges[seat].toLowerCase());
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
  const deadline = (): bigint => BigInt(Math.floor(clock.now() / 1000) + DEADLINE_S);
  const requests = createRequests({ signer, relayer, clock, log });
  const { follow, signed } = requests;
  const store = options.store && createStoreChain({ box, signer, relayer, requests, reads, rounds, clock, deadline, log, ...options.store });

  /** Refunds each pot past its delay that is still open, and forgets one that isn't. */
  async function sweepPots(pots: ReadonlyMap<number, number>, isOpen: (box: string, round: number) => Promise<boolean>, refund: (round: number) => void): Promise<void> {
    for (const [round, openedAt] of pots) {
      if (clock.now() - openedAt < REFUND_AFTER_MS) continue;
      if (!(await isOpen(box, round).catch(() => true))) {
        rounds.closed(round);
        continue;
      }
      log(`chain: refunding pot ${round}, left open since ${new Date(openedAt).toISOString()}`);
      refund(round);
    }
  }

  function refundRound(round: number, watch: TxWatch): void {
    void relayer.post("/duel/refund", { box, round: String(round) }).then((reply) =>
      follow(`refund ${round}`, reply, watch, (end) => {
        if (end === "paid") rounds.closed(round);
      }),
    );
  }

  const port: SepoliaChain = {
    onChain: (game) => chainLabel(game) !== null,
    nextRound: () => rounds.take(),
    refundAfterMs: REFUND_AFTER_MS,
    stakeNeedsName: true,
    store,
    async player(address, block) {
      const at = block === undefined ? undefined : BigInt(block);
      const [name, balance] = await Promise.all([reads.nameOf(address, at), reads.balance(address, at)]);
      return { address, name, balance, record: name ? await reads.stats(name, at) : null };
    },
    board: async (game) => reads.board(label(game)),
    open(order, watch) {
      const stake = stakeOf(box, order, deadline());
      rounds.opened(order.round, clock.now());
      const json = { ...stake, round: String(stake.round), amount: String(stake.amount), deadline: String(stake.deadline) };
      signed(`open ${order.round}`, stakeDigest(stake, contracts.duelPot), "/duel/open", (sig) => ({ stake: json, ...sig }), watch, (end) => {
        // Only a refusal proves there's no pot. Any other failure stays for the sweep, which asks the chain.
        if (end === "refused") rounds.closed(order.round);
      });
    },
    settle(order, watch) {
      const result = resultOf(box, order, deadline());
      const json = { ...result, round: String(result.round), deadline: String(result.deadline) };
      signed(`result ${order.round}`, resultDigest(result, contracts.boxResults), "/box/result", (sig) => ({ result: json, ...sig }), watch, (end) => {
        if (end === "paid") rounds.closed(order.round);
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
      return settlementOf(order, await reads.settled(label(order.game), pair(order.badges), hash));
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
      await sweepPots(rounds.open(), reads.potOpen, (round) => refundRound(round, () => {}));
      if (store) await sweepPots(rounds.open("store"), reads.storePotOpen, (round) => store.refund(round, () => {}));
    },
    stop() {
      requests.stop();
      signer.stop();
    },
  };
  return port;
}
