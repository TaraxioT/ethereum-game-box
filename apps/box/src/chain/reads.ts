// What the Box reads from Sepolia (SEPOLIA_RPC_URL): USDC balances, player names, the pot and rounds, the head, and a
// game's title and championship through the Universal Resolver. Every address comes from deployments/sepolia.json
// (the shared loader). The RPC URL carries the node's key, so every error that leaves here has its URLs redacted.
import {
  CUP_KEYS,
  TITLE_KEYS,
  boxResultsAbi,
  championshipName,
  championshipsAbi,
  contractAddress,
  duelPotAbi,
  ensAddress,
  fakeUsdcAbi,
  formatUsdc,
  gameBoxNamesAbi,
  parseStandings,
  titleName,
} from "@egb/shared/names";
import { sepoliaClient } from "@egb/shared/web";
import { type Address, type Hex, type PublicClient, decodeEventLog, isAddressEqual } from "viem";
import type { ChainHead } from "../core/ports.ts";
import type { Board, Standing } from "../core/types.ts";

/** What a settled result did, read at its receipt's block. */
export interface Settled {
  readonly block: bigint;
  /** USDC per seat the pot held, or null when the result settled no pot. */
  readonly pot: number | null;
  readonly names: readonly [string | null, string | null];
  /** The title's holder and streak at that block, or null. */
  readonly title: { readonly name: string; readonly holder: Address; readonly streak: number } | null;
  /** The open championship's name and standings at that block, or null. */
  readonly cup: { readonly label: string; readonly standings: readonly (Standing & { readonly addr: Address })[] } | null;
}

export interface Reads {
  head(): Promise<ChainHead>;
  balance(address: Address): Promise<number>;
  /** `<label>.gamebox.eth`, or null. */
  nameOf(address: Address, block?: bigint): Promise<string | null>;
  /** BoxResults has seen this round, or DuelPot holds a pot for it (open, settled or refunded). */
  roundTaken(box: string, round: number): Promise<boolean>;
  /** The pot is still open (neither settled nor refunded). */
  potOpen(box: string, round: number): Promise<boolean>;
  board(game: string): Promise<Board>;
  /** The P-256 key `GameBoxNames` holds for a Box (zeros for none). */
  boxKey(box: string): Promise<{ readonly qx: Hex; readonly qy: Hex }>;
  settled(game: string, badges: readonly [Address, Address], hash: Hex): Promise<Settled>;
}

/** `message` with every URL replaced by `<rpc>`: the RPC URL holds the node's key. */
export function redact(message: string): string {
  return message.replace(/\b(?:https?|wss?):\/\/[^\s"'`<>)]+/gi, "<rpc>");
}

const POT_OPEN = 1;

/** Runs a read and rethrows its failure as one redacted line. */
async function safely<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const { shortMessage } = error as { shortMessage?: string };
    const message = error instanceof Error ? (shortMessage ?? error.message) : String(error);
    throw new Error(`${what}: ${redact(message.split("\n")[0] ?? "error")}`);
  }
}

export function sepoliaReads(rpcUrl: string, client: PublicClient = sepoliaClient([rpcUrl])): Reads {
  const universalResolverAddress = ensAddress("UniversalResolver");
  const names = { address: contractAddress("GameBoxNames"), abi: gameBoxNamesAbi } as const;
  const usdc = { address: contractAddress("FakeUSDC"), abi: fakeUsdcAbi } as const;
  const pot = { address: contractAddress("DuelPot"), abi: duelPotAbi } as const;
  const results = { address: contractAddress("BoxResults"), abi: boxResultsAbi } as const;
  const cups = { address: contractAddress("Championships"), abi: championshipsAbi } as const;

  /** A text record through the Universal Resolver; a name that doesn't resolve is null. */
  async function text(name: string, key: string, blockNumber?: bigint): Promise<string | null> {
    try {
      return await client.getEnsText({ name, key, universalResolverAddress, ...(blockNumber === undefined ? {} : { blockNumber }) });
    } catch {
      return null;
    }
  }

  async function address(name: string, blockNumber?: bigint): Promise<Address | null> {
    try {
      return await client.getEnsAddress({ name, universalResolverAddress, ...(blockNumber === undefined ? {} : { blockNumber }) });
    } catch {
      return null;
    }
  }

  async function nameOf(badge: Address, blockNumber?: bigint): Promise<string | null> {
    const name = await client.readContract({ ...names, functionName: "nameOf", args: [badge], ...(blockNumber === undefined ? {} : { blockNumber }) });
    return name === "" ? null : name;
  }

  async function title(game: string, blockNumber?: bigint): Promise<Settled["title"]> {
    const name = titleName(game);
    const holder = await address(name, blockNumber);
    if (!holder) return null;
    const streak = Number((await text(name, TITLE_KEYS.streak, blockNumber)) ?? "0");
    return { name, holder, streak: Number.isFinite(streak) ? streak : 0 };
  }

  /** The game's open championship's label and its standings record. */
  async function cup(game: string, blockNumber?: bigint) {
    const at = blockNumber === undefined ? {} : { blockNumber };
    const id = await client.readContract({ ...cups, functionName: "openCup", args: [game], ...at });
    if (id === 0n) return null;
    const info = await client.readContract({ ...cups, functionName: "getCup", args: [id], ...at });
    const name = championshipName(info.label, game);
    const standings = parseStandings((await text(name, CUP_KEYS.standings, blockNumber)) ?? "[]");
    return { info, name, standings };
  }

  return {
    head: () =>
      safely("the head", async () => {
        const block = await client.getBlock({ blockTag: "latest" });
        const gwei = Number(block.baseFeePerGas ?? 0n) / 1e9;
        return { block: Number(block.number), at: Number(block.timestamp) * 1000, gasGwei: Math.round(gwei * 100) / 100 };
      }),
    balance: (badge) =>
      safely("a USDC balance", async () => Number(formatUsdc(await client.readContract({ ...usdc, functionName: "balanceOf", args: [badge] })))),
    nameOf: (badge, block) => safely("a player name", () => nameOf(badge, block)),
    roundTaken: (box, round) =>
      safely("a round", async () => {
        const used = await client.readContract({ ...results, functionName: "roundUsed", args: [box, BigInt(round)] });
        if (used) return true;
        const held = await client.readContract({ ...pot, functionName: "getPot", args: [box, BigInt(round)] });
        return held.state !== 0;
      }),
    potOpen: (box, round) =>
      safely("a pot", async () => (await client.readContract({ ...pot, functionName: "getPot", args: [box, BigInt(round)] })).state === POT_OPEN),
    boxKey: (box) =>
      safely("the Box's key", async () => {
        const [qx, qy] = await client.readContract({ ...names, functionName: "boxKey", args: [box] });
        return { qx, qy };
      }),
    board: (game) =>
      safely("the board", async () => {
        const [held, open] = await Promise.all([title(game), cup(game)]);
        return {
          title: held ? { name: held.name, holder: (await nameOf(held.holder).catch(() => null)) ?? held.holder, streak: held.streak } : null,
          cup: open
            ? {
                name: open.name,
                ends: Number(open.info.ends) * 1000,
                prize: Number(formatUsdc(open.info.prize)),
                standings: open.standings.map(({ name, points, wins, draws, losses }) => ({ name, points, wins, draws, losses })),
              }
            : null,
        };
      }),
    settled: (game, badges, hash) =>
      safely("the result's receipt", async () => {
        const receipt = await client.getTransactionReceipt({ hash });
        const block = receipt.blockNumber;
        let paid: number | null = null;
        for (const log of receipt.logs) {
          if (!isAddressEqual(log.address, pot.address)) continue;
          try {
            const event = decodeEventLog({ abi: duelPotAbi, data: log.data, topics: log.topics });
            if (event.eventName === "PotSettled") paid = Number(formatUsdc(event.args.amount));
          } catch {
            // Another of the pot's events.
          }
        }
        const [one, two, held, open] = await Promise.all([nameOf(badges[0], block), nameOf(badges[1], block), title(game, block), cup(game, block)]);
        return {
          block,
          pot: paid,
          names: [one, two],
          title: held,
          cup: open ? { label: open.info.label, standings: open.standings.map((row) => ({ ...row, addr: row.addr as Address })) } : null,
        };
      }),
  };
}
