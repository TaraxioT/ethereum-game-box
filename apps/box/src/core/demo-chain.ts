// The chain port in memory, for the browser demo (SimLink) and the core's tests: a head every BLOCK_MS, every badge
// starting with DEMO_START_USDC, and each transaction sent SEND_MS after it is signed, in the next head, then paid
// PAY_MS after it. No hashes: nothing here is on Sepolia, and the screen shows none. The Box itself runs the real port
// (`src/chain/`).
import type { ChainHead, ChainPort, Clock, ResultOrder, StakeOrder, TxWatch } from "./ports.ts";
import type { Board, GameId, Leader, PlayerCard, PlayerRecord, Settlement } from "./types.ts";
import { NO_RECORD, counted, recordText } from "./stats.ts";
import { BLOCK_MS, TOPUP_USDC } from "./core.ts";
import { chainLabel } from "./catalogue.ts";
import { createTimers } from "./timers.ts";

export const DEMO_START_USDC = 100;
export const SEND_MS = 400;
export const PAY_MS = 900;
/** The demo's pots refund after a minute, not an hour. */
export const DEMO_REFUND_MS = 60_000;
/** How long a title lasts after its holder's last win, by chain label: as on Sepolia (`AddGames`). */
const TITLE_TERM_MS: Readonly<Record<string, number>> = { stockduel: 7 * 24 * 3_600_000, quickdraw: 15 * 60_000 };
/** Where the demo's block numbers start: Sepolia's height in November 2026. */
const FIRST_BLOCK = 12_065_134;

type Address = `0x${string}`;

interface Pot {
  readonly badges: readonly [Address, Address];
  readonly amount: number;
}

export interface DemoChain extends ChainPort {
  /** Every request in the order it was sent, for tests: `open 1`, `settle 1`, `topup 0x…`. */
  readonly sent: readonly string[];
  stop(): void;
}

const short = (address: Address): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function createDemoChain(clock: Clock): DemoChain {
  const timers = createTimers(clock);
  const balances = new Map<Address, number>();
  const names = new Map<Address, string>();
  const pots = new Map<number, Pot>();
  const titles = new Map<string, { holder: Address; streak: number; expires: number }>();
  /** Each badge's stats over every game, and when it reached its wins (the leaderboard's tiebreak). */
  const records = new Map<Address, PlayerRecord>();
  const reached = new Map<Address, number>();
  let seq = 0;
  const recordOf = (address: Address): PlayerRecord | null => records.get(address) ?? null;
  const score = (address: Address, result: "win" | "loss" | "draw"): void => {
    records.set(address, counted(records.get(address) ?? NO_RECORD, result));
    if (result === "win" || !reached.has(address)) reached.set(address, ++seq);
  };
  /** The players with a result, by most wins, then who reached them first: the top ten. */
  const leaders = (): Leader[] =>
    [...records]
      .sort(([a, x], [b, y]) => y.wins - x.wins || (reached.get(a) ?? 0) - (reached.get(b) ?? 0))
      .slice(0, 10)
      .map(([address, r]) => ({ name: nameOf(address), ...r }));
  const listeners = new Set<(head: ChainHead) => void>();
  /** Transactions sent and waiting for the next head. */
  const waiting = new Set<() => void>();
  /** What each settled round paid its winner (or each seat, on a draw). */
  const paid = new Map<number, number>();
  const sent: string[] = [];
  const started = clock.now();
  let head: ChainHead = { block: FIRST_BLOCK, at: started, gasGwei: 1 };
  let round = 0;

  const balanceOf = (address: Address): number => balances.get(address) ?? DEMO_START_USDC;
  const credit = (address: Address, amount: number): void => void balances.set(address, balanceOf(address) + amount);
  const nameOf = (address: Address): string => names.get(address) ?? short(address);

  timers.every(BLOCK_MS, () => {
    head = { block: head.block + 1, at: clock.now(), gasGwei: 1 };
    const landing = [...waiting];
    waiting.clear();
    for (const land of landing) land();
    for (const listener of [...listeners]) listener(head);
  });

  /** One transaction's steps: `effect` runs in its block and throws to fail it. */
  function run(what: string, watch: TxWatch, effect: () => void): void {
    sent.push(what);
    const step = (step: "sent" | "in-block" | "paid" | "failed", error: string | null = null): void =>
      watch({ step, hash: null, etherscan: null, block: step === "sent" || step === "failed" ? null : head.block, error });
    timers.after(SEND_MS, () => {
      step("sent");
      waiting.add(() => {
        try {
          effect();
        } catch (error) {
          step("failed", error instanceof Error ? error.message : String(error));
          return;
        }
        step("in-block");
        timers.after(PAY_MS, () => step("paid"));
      });
    });
  }

  return {
    sent,
    onChain: (game: GameId) => chainLabel(game) !== null,
    nextRound: () => ++round,
    refundAfterMs: DEMO_REFUND_MS,
    stakeNeedsName: false,
    player: (address): Promise<PlayerCard> =>
      Promise.resolve({ address, name: names.get(address) ?? null, balance: balanceOf(address), record: recordOf(address) }),
    board(game): Promise<Board> {
      const label = chainLabel(game) ?? game;
      const title = titles.get(label);
      const live = title && title.expires > clock.now() ? title : null;
      return Promise.resolve({
        title: live ? { name: `champion.${label}.gamebox.eth`, holder: nameOf(live.holder), streak: live.streak, expires: live.expires } : null,
        cup: null,
        leaders: leaders(),
        won: [],
      });
    },
    open(order: StakeOrder, watch) {
      run(`open ${order.round}`, watch, () => {
        if (pots.has(order.round)) throw new Error(`round ${order.round} already has a pot`);
        for (const address of order.badges) if (balanceOf(address) < order.amount) throw new Error(`${nameOf(address)} can't cover ${order.amount} USDC`);
        for (const address of order.badges) credit(address, -order.amount);
        pots.set(order.round, { badges: order.badges, amount: order.amount });
      });
    },
    settle(order: ResultOrder, watch) {
      run(`settle ${order.round}`, watch, () => {
        const pot = pots.get(order.round);
        pots.delete(order.round);
        if (pot) paid.set(order.round, order.winner === null ? pot.amount : pot.amount * 2);
        if (pot && order.winner === null) for (const address of pot.badges) credit(address, pot.amount);
        const label = chainLabel(order.game) ?? order.game;
        if (order.winner === null) {
          for (const address of order.badges) score(address, "draw");
          return;
        }
        const winner = order.badges[order.winner];
        score(winner, "win");
        score(order.badges[order.winner === 0 ? 1 : 0], "loss");
        if (pot) credit(winner, pot.amount * 2);
        const title = titles.get(label);
        const held = title && title.holder === winner && title.expires > clock.now();
        titles.set(label, { holder: winner, streak: held ? title.streak + 1 : 1, expires: clock.now() + (TITLE_TERM_MS[label] ?? 0) });
      });
    },
    refund(round, watch) {
      run(`refund ${round}`, watch, () => {
        const pot = pots.get(round);
        if (!pot) throw new Error(`round ${round} has no open pot`);
        pots.delete(round);
        for (const address of pot.badges) credit(address, pot.amount);
      });
    },
    topup(address, watch) {
      run(`topup ${address}`, watch, () => credit(address, TOPUP_USDC));
    },
    claim(label, address, watch) {
      run(`claim ${label}`, watch, () => {
        const name = `${label}.gamebox.eth`;
        if ([...names.values()].includes(name)) throw new Error(`${name} is taken`);
        if (names.has(address)) throw new Error(`${short(address)} already holds ${nameOf(address)}`);
        names.set(address, name);
      });
    },
    outcome(order: ResultOrder): Promise<Settlement> {
      const amount = paid.get(order.round) ?? null;
      const stats = [recordOf(order.badges[0]), recordOf(order.badges[1])] as const;
      const statsLines = order.badges.flatMap((address, i) => {
        const r = stats[i];
        return r ? [`${nameOf(address)} stats: ${recordText(r)}`] : [];
      });
      const label = chainLabel(order.game) ?? order.game;
      const title = order.winner === null ? undefined : titles.get(label);
      const winner = order.winner === null ? null : order.badges[order.winner];
      const holds = winner !== null && title?.holder === winner ? { name: `champion.${label}.gamebox.eth`, streak: title.streak } : null;
      const lines =
        winner === null
          ? [amount ? `A draw: ${amount} USDC back to each` : "A draw"]
          : [
              amount ? `${nameOf(winner)} +${amount} USDC` : `${nameOf(winner)} wins`,
              ...(holds ? [`${nameOf(winner)} now holds ${holds.name}${holds.streak > 1 ? `, streak ${holds.streak}` : ""}`] : []),
            ];
      const named = (address: Address): string | null => names.get(address) ?? null;
      return Promise.resolve({
        lines: [...lines, ...statsLines],
        names: [named(order.badges[0]), named(order.badges[1])],
        paid: amount,
        title: holds,
        cup: null,
        stats,
      });
    },
    watchHead(listener) {
      listeners.add(listener);
      listener(head);
      return () => void listeners.delete(listener);
    },
    stop() {
      timers.clear();
      listeners.clear();
      waiting.clear();
    },
  };
}
