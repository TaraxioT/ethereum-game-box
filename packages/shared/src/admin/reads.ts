// What the admin panel shows, read at one block: the admin's ETH and test USDC, whether it still holds the roles its
// calls need, every game with its title and open championship, and the latest championships. Games come from
// `GameAdded` logs, scanned once and then only from where the last scan stopped.

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
}

export interface AdminView {
  admin: Address;
  block: bigint;
  /** The block's timestamp (unix seconds). */
  now: number;
  /** Wei. */
  eth: bigint;
  /** USDC base units. */
  usdc: bigint;
  /** Whether the admin can still add games, open championships and mint the prize. */
  roles: { games: boolean; cups: boolean; minter: boolean };
  /** Every game, in the order it was added. */
  games: GameView[];
  /** The latest championships, newest first. */
  cups: CupView[];
}

/** How many championships the view lists. */
export const CUPS_SHOWN = 10;

export interface AdminReads {
  view(): Promise<AdminView>;
}

export function adminReads(client: PublicClient, admin: Address): AdminReads {
  const names = { address: contractAddress('GameBoxNames'), abi: gameBoxNamesAbi } as const;
  const cups = { address: contractAddress('Championships'), abi: championshipsAbi } as const;
  const usdcToken = { address: contractAddress('FakeUSDC'), abi: fakeUsdcAbi } as const;
  const labels: string[] = [];
  let scanned = BigInt(ourContract('GameBoxNames')?.deployBlock ?? 0) - 1n;

  async function scanGames(to: bigint): Promise<void> {
    while (scanned < to) {
      const fromBlock = scanned + 1n;
      const toBlock = fromBlock + LOG_CHUNK < to ? fromBlock + LOG_CHUNK : to;
      const logs = await client.getContractEvents({ ...names, eventName: 'GameAdded', fromBlock, toBlock, strict: true });
      for (const log of logs) if (!labels.includes(log.args.label)) labels.push(log.args.label);
      scanned = toBlock;
    }
  }

  async function nameOf(address: Address, blockNumber: bigint): Promise<string | null> {
    const name = await client.readContract({ ...names, functionName: 'nameOf', args: [address], blockNumber });
    return name || null;
  }

  async function game(label: string, blockNumber: bigint, now: number): Promise<GameView> {
    const [info, title, open] = await Promise.all([
      client.readContract({ ...names, functionName: 'getGame', args: [label], blockNumber }),
      client.readContract({ ...names, functionName: 'getTitle', args: [label], blockNumber }),
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
    };
  }

  return {
    async view() {
      const head = await client.getBlock();
      const blockNumber = head.number;
      const now = Number(head.timestamp);
      await scanGames(blockNumber);
      const at = { blockNumber } as const;
      const [eth, usdc, gamesRole, cupsRole, minter, count] = await Promise.all([
        client.getBalance({ address: admin, ...at }),
        client.readContract({ ...usdcToken, functionName: 'balanceOf', args: [admin], ...at }),
        client.readContract({ ...names, functionName: 'hasRole', args: [GAME_BOX_ROLES.DEFAULT_ADMIN_ROLE, admin], ...at }),
        client.readContract({ ...cups, functionName: 'hasRole', args: [GAME_BOX_ROLES.DEFAULT_ADMIN_ROLE, admin], ...at }),
        client.readContract({ ...usdcToken, functionName: 'hasRole', args: [USDC_ROLES.MINTER_ROLE, admin], ...at }),
        client.readContract({ ...cups, functionName: 'cupCount', ...at }),
      ]);
      const ids: bigint[] = [];
      for (let id = count; id > 0n && ids.length < CUPS_SHOWN; id--) ids.push(id);
      const [games, latest] = await Promise.all([
        Promise.all(labels.map((label) => game(label, blockNumber, now))),
        Promise.all(ids.map((id) => cup(id, blockNumber))),
      ]);
      return {
        admin,
        block: blockNumber,
        now,
        eth,
        usdc,
        roles: { games: gamesRole, cups: cupsRole, minter },
        games,
        cups: latest,
      };
    },
  };
}
