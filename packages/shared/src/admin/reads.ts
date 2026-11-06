// The board, read at one block: every game with its title and open championship, and the latest championships with
// an open one's leader. Anyone can read it (the Box's Home shows it). The admin's view adds the admin's ETH and test
// USDC and whether it still holds the roles its calls need. Games come from `GameAdded` logs, scanned once and then
// only from where the last scan stopped.

import { type Address, type PublicClient, isAddressEqual, zeroAddress } from 'viem';

import { championshipsAbi, fakeUsdcAbi, gameBoxNamesAbi } from '../names/abis.ts';
import { contractAddress, ourContract } from '../names/deployments.ts';
import { championshipName, fullName, titleName } from '../names/labels.ts';
import { GAME_BOX_ROLES, USDC_ROLES } from '../names/roles.ts';
import { LOG_CHUNK } from '../web/chain.ts';

export interface TitleView {
  name: string;
  /** Null before anyone won it. */
  holder: Address | null;
  holderName: string | null;
  streak: number;
  /** Unix seconds; 0 before anyone won it. */
  expiry: number;
  live: boolean;
}

export interface GameView {
  label: string;
  name: string;
  /** Seconds the title lasts after the holder's last win. */
  titleTerm: number;
  title: TitleView;
  /** The open championship's id, or null. */
  openCup: bigint | null;
}

export interface CupView {
  id: bigint;
  game: string;
  label: string;
  name: string;
  /** Unix seconds. */
  ends: number;
  /** USDC base units. */
  prize: bigint;
  closed: boolean;
  /** Closed with a winner (null while open, or closed with nobody playing). */
  winner: Address | null;
  winnerName: string | null;
  /** An open championship's leader so far (most points), or null: closed, or nobody has played. */
  leader: { address: Address; name: string | null; points: number } | null;
}

export interface BoardView {
  block: bigint;
  /** The block's timestamp (unix seconds). */
  now: number;
  /** Every game, in the order it was added. */
  games: GameView[];
  /** The latest championships, newest first. */
  cups: CupView[];
}

export interface AdminView extends BoardView {
  admin: Address;
  /** Wei. */
  eth: bigint;
  /** USDC base units. */
  usdc: bigint;
  /** Whether the admin can still add games, open championships and mint the prize. */
  roles: { games: boolean; cups: boolean; minter: boolean };
}

/** How many championships the view lists. */
export const CUPS_SHOWN = 10;

export interface BoardReads {
  /** At `head` (default: the latest block). */
  view(head?: { number: bigint; timestamp: bigint }): Promise<BoardView>;
}

export interface AdminReads {
  view(): Promise<AdminView>;
}

const names = () => ({ address: contractAddress('GameBoxNames'), abi: gameBoxNamesAbi }) as const;
const cupsContract = () => ({ address: contractAddress('Championships'), abi: championshipsAbi }) as const;

export function boardReads(client: PublicClient): BoardReads {
  const nameBook = names();
  const cups = cupsContract();
  const labels: string[] = [];
  let scanned = BigInt(ourContract('GameBoxNames')?.deployBlock ?? 0) - 1n;

  async function scanGames(to: bigint): Promise<void> {
    while (scanned < to) {
      const fromBlock = scanned + 1n;
      const toBlock = fromBlock + LOG_CHUNK < to ? fromBlock + LOG_CHUNK : to;
      const logs = await client.getContractEvents({ ...nameBook, eventName: 'GameAdded', fromBlock, toBlock, strict: true });
      for (const log of logs) if (!labels.includes(log.args.label)) labels.push(log.args.label);
      scanned = toBlock;
    }
  }

  async function nameOf(address: Address, blockNumber: bigint): Promise<string | null> {
    const name = await client.readContract({ ...nameBook, functionName: 'nameOf', args: [address], blockNumber });
    return name || null;
  }

  async function game(label: string, blockNumber: bigint, now: number): Promise<GameView> {
    const [info, title, open] = await Promise.all([
      client.readContract({ ...nameBook, functionName: 'getGame', args: [label], blockNumber }),
      client.readContract({ ...nameBook, functionName: 'getTitle', args: [label], blockNumber }),
      client.readContract({ ...cups, functionName: 'openCup', args: [label], blockNumber }),
    ]);
    const holder = isAddressEqual(title.holder, zeroAddress) ? null : title.holder;
    return {
      label,
      name: fullName(label),
      titleTerm: Number(info.titleTerm),
      title: {
        name: titleName(label),
        holder,
        holderName: holder ? await nameOf(holder, blockNumber) : null,
        streak: Number(title.streak),
        expiry: Number(title.expiry),
        live: holder !== null && Number(title.expiry) > now,
      },
      openCup: open === 0n ? null : open,
    };
  }

  async function cup(id: bigint, blockNumber: bigint): Promise<CupView> {
    const c = await client.readContract({ ...cups, functionName: 'getCup', args: [id], blockNumber });
    const winner = isAddressEqual(c.winner, zeroAddress) ? null : c.winner;
    let leader: CupView['leader'] = null;
    if (!c.closed) {
      const [first] = await client.readContract({ ...cups, functionName: 'top', args: [id], blockNumber });
      if (first) {
        const [entry, name] = await Promise.all([
          client.readContract({ ...cups, functionName: 'entryOf', args: [id, first], blockNumber }),
          nameOf(first, blockNumber),
        ]);
        leader = { address: first, name, points: entry.points };
      }
    }
    return {
      id,
      game: c.game,
      label: c.label,
      name: championshipName(c.label, c.game),
      ends: Number(c.ends),
      prize: c.prize,
      closed: c.closed,
      winner,
      winnerName: winner ? await nameOf(winner, blockNumber) : null,
      leader,
    };
  }

  return {
    async view(head) {
      const { number: blockNumber, timestamp } = head ?? (await client.getBlock());
      const now = Number(timestamp);
      await scanGames(blockNumber);
      const count = await client.readContract({ ...cups, functionName: 'cupCount', blockNumber });
      const ids: bigint[] = [];
      for (let id = count; id > 0n && ids.length < CUPS_SHOWN; id--) ids.push(id);
      const [games, latest] = await Promise.all([
        Promise.all(labels.map((label) => game(label, blockNumber, now))),
        Promise.all(ids.map((id) => cup(id, blockNumber))),
      ]);
      return { block: blockNumber, now, games, cups: latest };
    },
  };
}

export function adminReads(client: PublicClient, admin: Address): AdminReads {
  const board = boardReads(client);
  const nameBook = names();
  const cups = cupsContract();
  const usdcToken = { address: contractAddress('FakeUSDC'), abi: fakeUsdcAbi } as const;
  return {
    async view() {
      const head = await client.getBlock();
      const at = { blockNumber: head.number } as const;
      const [view, eth, usdc, gamesRole, cupsRole, minter] = await Promise.all([
        board.view(head),
        client.getBalance({ address: admin, ...at }),
        client.readContract({ ...usdcToken, functionName: 'balanceOf', args: [admin], ...at }),
        client.readContract({ ...nameBook, functionName: 'hasRole', args: [GAME_BOX_ROLES.DEFAULT_ADMIN_ROLE, admin], ...at }),
        client.readContract({ ...cups, functionName: 'hasRole', args: [GAME_BOX_ROLES.DEFAULT_ADMIN_ROLE, admin], ...at }),
        client.readContract({ ...usdcToken, functionName: 'hasRole', args: [USDC_ROLES.MINTER_ROLE, admin], ...at }),
      ]);
      return { ...view, admin, eth, usdc, roles: { games: gamesRole, cups: cupsRole, minter } };
    },
  };
}
