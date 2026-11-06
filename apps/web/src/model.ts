// What each kind of name reads as, put together from the directory, the ENS reads and the contracts. Every value is
// read from chain when a page asks; nothing is kept between reads but the event directory.
import { type Address, type PublicClient, getAddress, zeroAddress } from "viem";
import {
  AGENT_KEYS,
  AGENT_PROTOCOLS,
  BOX_KEYS,
  BOX_STATUS,
  DEFAULT_KEYS,
  PARENT_NAME,
  POPUP_PREFIX,
  TITLE_KEYS,
  agentEndpointKey,
  contractAddress,
  demoLicencesAbi,
  fullName,
  gameBoxNamesAbi,
  titleName,
} from "@egb/shared/names";

import { type Account, ADDR } from "./access.ts";
import { AGENT_LABEL, GAMES } from "./config.ts";
import { type Crowning, type Directory, playerLabel } from "./directory.ts";
import { readAddress, readPrimaryName, readText, readTexts } from "./ens.ts";
import { knownRelayer } from "./relayer.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Boxes

export interface BoxView {
  label: string;
  name: string;
  /** The `addr` record, or null when the name no longer resolves (its licence lapsed). */
  resolves: Address | null;
  status: string | null;
  expiry: bigint;
  operator: Address;
  account: Address;
  resolver: Address;
  lastSeen: number | null;
  game: string | null;
  /** Every Box key, read through ENS on this name. A lapsed pop-up reads `gamebox.eth`'s default record here. */
  records: Record<(typeof BOX_KEYS)[keyof typeof BOX_KEYS], string | null>;
  /** For a pop-up: the Box it is linked to (`mumbai-01`). Null for a Box. */
  ofBox: string | null;
  /** For a lapsed pop-up: what `gamebox.eth`'s default record says instead (wildcard). */
  fallback: { url: string | null; description: string | null } | null;
}

const BOX_STATUS_NAMES = ["none", ...BOX_STATUS] as const;

/** A Box or a pop-up Box. A pop-up has no Box of its own: its operator, account and resolver are its Box's. */
export async function readBox(client: PublicClient, label: string): Promise<BoxView> {
  const name = fullName(label);
  const at = { address: contractAddress("GameBoxNames"), abi: gameBoxNamesAbi } as const;
  const popup = label.startsWith(POPUP_PREFIX) ? await client.readContract({ ...at, functionName: "getPopup", args: [label] }) : null;
  const ofBox = popup && popup.ofBox !== "" ? popup.ofBox : null;
  const [box, resolves, records] = await Promise.all([
    client.readContract({ ...at, functionName: "getBox", args: [ofBox ?? label] }),
    readAddress(client, name),
    readTexts(client, name, Object.values(BOX_KEYS)),
  ]);
  const lastSeen = records.lastSeen ? Number(records.lastSeen) : null;
  const lapsedPopup = ofBox !== null && resolves === null;
  return {
    label,
    name,
    resolves,
    status: records.status ?? (resolves && !ofBox ? (BOX_STATUS_NAMES[box.status] ?? null) : null),
    expiry: BigInt(popup && ofBox ? popup.expiry : box.expiry),
    operator: box.operator,
    account: box.account,
    resolver: box.resolver,
    lastSeen: Number.isFinite(lastSeen) ? lastSeen : null,
    game: records.game,
    records,
    ofBox,
    fallback: lapsedPopup ? { url: await readText(client, name, DEFAULT_KEYS.url), description: records.description } : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Players

export interface PlayerView {
  label: string;
  name: string;
  badge: Address;
  resolves: Address | null;
  stats: Record<string, { wins: number; losses: number; draws: number }> | null;
  statsText: string | null;
  /** The badge's primary name (`getEnsName`), or null if it set none. */
  primary: string | null;
  /** The titles it holds now: game labels. */
  titles: string[];
}

export function parseStats(text: string | null): PlayerView["stats"] {
  if (!text) return null;
  try {
    return JSON.parse(text) as PlayerView["stats"];
  } catch {
    return null;
  }
}

export async function readPlayer(client: PublicClient, dir: Directory, label: string, holders: Map<string, Address | null>): Promise<PlayerView> {
  const entry = dir.players.get(label);
  const name = fullName(label);
  const [resolves, statsText] = await Promise.all([readAddress(client, name), readText(client, name, "stats")]);
  const badge = entry?.badge ?? resolves ?? zeroAddress;
  const primary = badge === zeroAddress ? null : await readPrimaryName(client, badge).catch(() => null);
  const titles = [...holders].filter(([, holder]) => holder && getAddress(holder) === getAddress(badge)).map(([game]) => game);
  return { label, name, badge, resolves, stats: parseStats(statsText), statsText, primary, titles };
}

// ---------------------------------------------------------------------------------------------------------------------
// Titles

export interface TitleView {
  game: string;
  name: string;
  /** The holder's badge, read through ENS (null when the title has lapsed or was never won). */
  holder: Address | null;
  /** The holder's player name, from the `holder` record. */
  holderName: string | null;
  start: number | null;
  streak: number | null;
  round: string | null;
  expiry: bigint;
  term: bigint;
  titleRegistry: Address;
  history: Crowning[];
}

export async function readTitle(client: PublicClient, dir: Directory, game: string): Promise<TitleView> {
  const name = titleName(game);
  const at = { address: contractAddress("GameBoxNames"), abi: gameBoxNamesAbi } as const;
  const [title, info, holder, records] = await Promise.all([
    client.readContract({ ...at, functionName: "getTitle", args: [game] }),
    client.readContract({ ...at, functionName: "getGame", args: [game] }),
    readAddress(client, name),
    readTexts(client, name, Object.values(TITLE_KEYS)),
  ]);
  return {
    game,
    name,
    holder,
    holderName: records.holder ?? (holder ? (playerLabel(dir, holder) ? fullName(playerLabel(dir, holder)!) : null) : null),
    start: records.start ? Number(records.start) : null,
    streak: records.streak ? Number(records.streak) : null,
    round: records.round,
    expiry: BigInt(title.expiry),
    term: BigInt(info.titleTerm),
    titleRegistry: info.titleRegistry,
    history: dir.crowns.filter((crown) => crown.game === game),
  };
}

/** Who holds each game's title now, through ENS (null for none). */
export async function readHolders(client: PublicClient): Promise<Map<string, Address | null>> {
  const holders = await Promise.all(GAMES.map((game) => readAddress(client, titleName(game))));
  return new Map(GAMES.map((game, i) => [game, holders[i] ?? null]));
}

// ---------------------------------------------------------------------------------------------------------------------
// The agent

export const AGENT_RECORD_KEYS = [AGENT_KEYS.context, ...AGENT_PROTOCOLS.map(agentEndpointKey)] as const;

export interface AgentView {
  name: string;
  address: Address | null;
  records: Record<(typeof AGENT_RECORD_KEYS)[number], string | null>;
  stats: string | null;
}

export async function readAgent(client: PublicClient): Promise<AgentView> {
  const name = fullName(AGENT_LABEL);
  const [address, records, stats] = await Promise.all([
    readAddress(client, name),
    readTexts(client, name, AGENT_RECORD_KEYS),
    readText(client, name, "stats"),
  ]);
  return { name, address, records, stats };
}

// ---------------------------------------------------------------------------------------------------------------------
// What a name is, and who and what its inspector shows

export type NameKind = "parent" | "box" | "popup" | "player" | "agent" | "game" | "title" | "other";

export function kindOf(dir: Directory, name: string): NameKind {
  if (name === PARENT_NAME) return "parent";
  const labels = name.split(".");
  if (labels.length === 4 && labels[0] === "champion" && name.endsWith(`.${PARENT_NAME}`)) return "title";
  if (labels.length !== 3 || !name.endsWith(`.${PARENT_NAME}`)) return "other";
  const label = labels[0] ?? "";
  if (label === AGENT_LABEL) return "agent";
  if (dir.boxes.has(label)) return "box";
  if (dir.popups.has(label) || label.startsWith(POPUP_PREFIX)) return "popup";
  if (dir.players.has(label)) return "player";
  if (dir.games.has(label) || (GAMES as readonly string[]).includes(label)) return "game";
  return "other";
}

/** The keys a name's Try grid tries. */
export function keysFor(kind: NameKind): string[] {
  switch (kind) {
    case "box":
    case "popup":
      return [ADDR, ...Object.values(BOX_KEYS)];
    case "player":
      return [ADDR, "stats", "avatar", "url", "description"];
    case "agent":
      return [ADDR, "stats", AGENT_KEYS.context, agentEndpointKey("mcp"), "avatar"];
    case "title":
      return [ADDR, ...Object.values(TITLE_KEYS)];
    case "game":
      return ["title", "titleTerm", "description"];
    default:
      return [ADDR, "description"];
  }
}

/** Whether a Box holds a live licence now: registered, and not expired. Pop-ups link to a licensed Box only. */
export async function boxLicensed(client: PublicClient, label: string): Promise<boolean> {
  const box = await client.readContract({ address: contractAddress("GameBoxNames"), abi: gameBoxNamesAbi, functionName: "getBox", args: [label] });
  return box.status !== 0 && BigInt(box.expiry) > BigInt(Math.floor(Date.now() / 1000));
}

/** The demo Box (`DemoLicences.BOX()`, the Box every pop-up links to) and its `P256Account`. */
export async function demoBox(client: PublicClient): Promise<{ label: string; account: Address }> {
  const label = await client.readContract({ address: contractAddress("DemoLicences"), abi: demoLicencesAbi, functionName: "BOX" });
  const box = await client.readContract({ address: contractAddress("GameBoxNames"), abi: gameBoxNamesAbi, functionName: "getBox", args: [label] });
  // Before the Box is licensed, its account is the one deployed for it (`DemoBoxAccount`).
  return { label, account: box.account === zeroAddress ? contractAddress("DemoBoxAccount") : box.account };
}

/** The accounts a name's role table and Try grid show: everyone with a stake in it, and a stranger or two. */
export async function accountsFor(client: PublicClient, dir: Directory, name: string, kind: NameKind): Promise<Account[]> {
  const label = name.split(".")[0] ?? "";
  const names = contractAddress("GameBoxNames");
  const stats = contractAddress("PlayerStats");
  const out: Account[] = [];
  const add = (account: Account | null) => {
    if (account && !out.some((a) => getAddress(a.address) === getAddress(account.address))) out.push(account);
  };
  const otherPlayer = (not: Address | null) => {
    const other = [...dir.players.values()].reverse().find((p) => !not || getAddress(p.badge) !== getAddress(not));
    return other ? { label: other.label, role: "another player", address: other.badge } : null;
  };
  if (kind === "player" || kind === "agent") {
    const badge = dir.players.get(label)?.badge ?? (await readAddress(client, name));
    if (badge) add({ label, role: kind === "agent" ? "the agent" : "badge", address: badge });
    add({ label: "PlayerStats", role: "the game's stats writer", address: stats });
    add({ label: "GameBoxNames", role: "registrar", address: names });
    add({ label: "demo Box", role: "a Box", address: (await demoBox(client)).account });
    add(otherPlayer(badge));
  } else if (kind === "box" || kind === "popup") {
    const box = await readBox(client, label);
    add({ label: "GameBoxNames", role: "registrar", address: names });
    add({ label: "operator", role: box.ofBox ? `owns ${box.ofBox} and this pop-up` : "owns the licence", address: box.operator });
    add({ label: box.ofBox ? `${box.ofBox}` : "Box", role: box.ofBox ? "the Box it is linked to" : "the Box's own account", address: box.account });
    add({ label: "PlayerStats", role: "the game's stats writer", address: stats });
    add(otherPlayer(null));
  } else if (kind === "title") {
    const holder = await readAddress(client, name);
    add({ label: "GameBoxNames", role: "registrar", address: names });
    if (holder) add({ label: playerLabel(dir, holder) ?? "holder", role: "holds the title", address: holder });
    add({ label: "PlayerStats", role: "the game's stats writer", address: stats });
    add(otherPlayer(holder));
  } else {
    add({ label: "GameBoxNames", role: "registrar", address: names });
    add({ label: "PlayerStats", role: "the game's stats writer", address: stats });
    add(otherPlayer(null));
  }
  const relayer = knownRelayer();
  if (relayer) add({ label: "relayer", role: "pays gas, holds nothing", address: relayer });
  return out;
}
