// The chain port in memory, for the browser demo (SimLink) and the core's tests: a head every BLOCK_MS, every badge
// starting with DEMO_START_USDC, and each transaction sent SEND_MS after it is signed, in the next head, then paid
// PAY_MS after it. No hashes: nothing here is on Sepolia, and the screen shows none. The Box itself runs the real port
// (`src/chain/`).
import type { ChainHead, ChainPort, Clock, ResultOrder, StakeOrder, TxWatch } from "./ports.ts";
import type { Board, DuelSeat, GameId, PlayerCard, PlayerRecord } from "./types.ts";
import { BLOCK_MS, TOPUP_USDC } from "./core.ts";
import { chainLabel } from "./catalogue.ts";
import { createTimers } from "./timers.ts";

export const DEMO_START_USDC = 100;
export const SEND_MS = 400;
export const PAY_MS = 900;
/** The demo's pots refund after a minute, not an hour. */
export const DEMO_REFUND_MS = 60_000;
/** Where the demo's block numbers start: Sepolia's height in November 2026. */
const FIRST_BLOCK = 12_065_134;

type Address = `0x${string}`;

interface Pot {
  readonly badges: readonly Address[];
  readonly amount: number;
}

export interface DemoChain extends ChainPort {
  /** Every request in the order it was sent, for tests: `open 1`, `settle 1`, `topup 0x…`. */
  readonly sent: readonly string[];
  stop(): void;
}

const short = (address: Address): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** The address a result names as its winner. */
function winnerOf(order: ResultOrder, seat: DuelSeat): `0x${string}` {
  const winner = order.badges[seat];
  if (!winner) throw new Error(`round ${order.round} has no seat ${seat}`);
  return winner;
}

export function createDemoChain(clock: Clock): DemoChain {
  const timers = createTimers(clock);
  const balances = new Map<Address, number>();
  const names = new Map<Address, string>();
  const pots = new Map<number, Pot>();
  const titles = new Map<string, { holder: Address; streak: number }>();
  /** Each badge's wins, losses and draws, by `<chain label>|<address>`. */
  const records = new Map<string, { wins: number; losses: number; draws: number }>();
  const recordOf = (game: GameId, address: Address): PlayerRecord | null => {
    const label = chainLabel(game);
    if (label === null) return null;
    return { game, ...(records.get(`${label}|${address}`) ?? { wins: 0, losses: 0, draws: 0 }) };
  };
  const score = (label: string, address: Address, field: "wins" | "losses" | "draws"): void => {
    const key = `${label}|${address}`;
    const now = records.get(key) ?? { wins: 0, losses: 0, draws: 0 };
    records.set(key, { ...now, [field]: now[field] + 1 });
  };
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
    balance: (address) => Promise.resolve(balanceOf(address)),
    player: (address, game): Promise<PlayerCard> =>
      Promise.resolve({ address, name: names.get(address) ?? null, balance: balanceOf(address), record: recordOf(game, address) }),
    board(game): Promise<Board> {
      const label = chainLabel(game) ?? game;
      const title = titles.get(label);
      return Promise.resolve({
        title: title ? { name: `champion.${label}.gamebox.eth`, holder: nameOf(title.holder), streak: title.streak } : null,
        cup: null,
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
        if (pot) paid.set(order.round, order.winner === null ? pot.amount : pot.amount * pot.badges.length);
        if (pot && order.winner === null) for (const address of pot.badges) credit(address, pot.amount);
        const label = chainLabel(order.game) ?? order.game;
        if (order.winner === null) {
          for (const address of order.badges) score(label, address, "draws");
          return;
        }
        const winner = winnerOf(order, order.winner);
        score(label, winner, "wins");
        for (const address of order.badges) if (address !== winner) score(label, address, "losses");
        if (pot) credit(winner, pot.amount * pot.badges.length);
        const title = titles.get(label);
        titles.set(label, { holder: winner, streak: title?.holder === winner ? title.streak + 1 : 1 });
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
    outcome(order: ResultOrder): Promise<readonly string[]> {
      const amount = paid.get(order.round);
      if (order.winner === null) return Promise.resolve(amount ? [`A draw: ${amount} USDC back to each`] : ["A draw"]);
      const winner = winnerOf(order, order.winner);
      const label = chainLabel(order.game) ?? order.game;
      const title = titles.get(label);
      const lines = [amount ? `${nameOf(winner)} +${amount} USDC` : `${nameOf(winner)} wins`];
      if (title?.holder === winner) {
        lines.push(`${nameOf(winner)} now holds champion.${label}.gamebox.eth${title.streak > 1 ? `, streak ${title.streak}` : ""}`);
      }
      return Promise.resolve(lines);
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
