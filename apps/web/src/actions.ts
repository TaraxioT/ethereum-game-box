// The site's writes, each through the transaction strip: claim a name, revoke PlayerStats' `stats` role (after a
// drip, for a test badge), open a pop-up Box and report a match. Pages and the Story both call these.
import { type Address, type Hex, encodeFunctionData, parseEther, zeroAddress } from "viem";
import {
  PRIMARY_NAME_MAX_EXPIRY_SECONDS,
  RESOLVER_ROLES,
  contractAddress,
  fullName,
  gameBoxNamesAbi,
  labelProblem,
  permissionedRegistryAbi,
  permissionedResolverAbi,
  popupLabel,
  popupLabelProblem,
  textResource,
  titleName,
} from "@egb/shared/names";

import { type CallOutcome, type TryCell, callOutcome, tryCell } from "./access.ts";
import type { Badge } from "./badge.ts";
import { client } from "./chain.ts";
import { DEMO_BOX_LABEL } from "./config.ts";
import { locate } from "./registry.ts";
import { demoBox, relayer } from "./relayer.ts";
import { direct, relayed } from "./txs.ts";

/** How long a claim signature stays good. The relayer wants at least 24 s. */
const CLAIM_WINDOW = 10 * 60;
/** How long the primary-name signature stays good: inside ENS's one-hour limit. */
const PRIMARY_NAME_WINDOW = PRIMARY_NAME_MAX_EXPIRY_SECONDS - 10 * 60;

// ---------------------------------------------------------------------------------------------------------------------
// Free or taken

export type Availability = { free: true } | { free: false; why: string };

/** Whether a player may claim `label`: the label rule, a Box's label (`LabelHeldByBox`), and the registry. */
export async function availability(label: string): Promise<Availability> {
  const problem = labelProblem(label);
  if (problem) return { free: false, why: problem };
  const [box, where] = await Promise.all([
    client.readContract({ address: contractAddress("GameBoxNames"), abi: gameBoxNamesAbi, functionName: "getBox", args: [label] }),
    locate(client, fullName(label)),
  ]);
  if (box.status !== 0) return { free: false, why: "LabelHeldByBox: a Box's name" };
  if (where.status !== "available") return { free: false, why: "taken" };
  return { free: true };
}

/** Whether `popup-<label>` is free to open. */
export async function popupAvailability(label: string): Promise<Availability> {
  const problem = popupLabelProblem(label);
  if (problem) return { free: false, why: problem };
  const where = await locate(client, fullName(popupLabel(label)));
  return where.status === "available" ? { free: true } : { free: false, why: "live now" };
}

/** A fresh label: `<prefix>-` and four base-36 characters. */
export function freshLabel(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 6).padEnd(4, "0")}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Writes

/** The badge signs `ClaimName`, and ENS's primary-name message for the new name; the relayer sends both, so
 * `getEnsName(badge)` returns the name. No ETH needed. */
export async function claim(badge: Badge, label: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const deadline = BigInt(now + CLAIM_WINDOW);
  const signature = await badge.signClaim({ label, badge: badge.address, deadline });
  const expiry = BigInt(now + PRIMARY_NAME_WINDOW);
  const primary = await badge.signPrimaryName({ badge: badge.address, name: fullName(label), expiry });
  await relayed("CLAIM", fullName(label), () =>
    relayer.claim({
      label,
      badge: badge.address,
      deadline: deadline.toString(),
      signature,
      primaryName: { expiry: expiry.toString(), signature: primary },
    }),
  );
}

/** A little ETH for a badge's own transactions, once. Skipped when the badge already has enough. */
export async function dripIfNeeded(badge: Badge): Promise<void> {
  const balance = await client.getBalance({ address: badge.address });
  if (balance >= parseEther("0.0001")) return;
  await relayed("DRIP", `0.0003 ETH → ${badge.kind === "test" ? "test badge" : "badge"}`, () => relayer.drip({ badge: badge.address }));
}

/** The badge takes `stats` away from `PlayerStats` on its own resolver: a direct transaction from the badge. */
export async function revokeStats(badge: Badge, label: string): Promise<void> {
  const where = await locate(client, fullName(label));
  if (!where.resolver) throw new Error(`${fullName(label)} has no resolver`);
  await dripIfNeeded(badge);
  const data = encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "revokeRoles",
    args: [textResource("stats"), RESOLVER_ROLES.SET_TEXT, contractAddress("PlayerStats")],
  });
  const resolver = where.resolver;
  await direct(client, "REVOKE", `stats ← PlayerStats on ${fullName(label)}`, () => badge.send(resolver, data));
}

/** Opens `popup-<label>.gamebox.eth` for 10 minutes. */
export async function openPopup(label: string): Promise<void> {
  await relayed("POP-UP", fullName(popupLabel(label)), () => relayer.popup({ label }));
}

/** The demo Box (a software key) signs a result and sends it through the relayer. */
export async function reportWin(game: string, winner: { label: string; badge: Address }, loser: { label: string; badge: Address }): Promise<void> {
  const subject = `${game}: ${winner.label} beat ${loser.label}`;
  await relayed("RESULT", subject, async () => {
    const { id } = await demoBox.report({ box: DEMO_BOX_LABEL, game, winner: winner.badge, loser: loser.badge, draw: false });
    return relayer.tx(id);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The title's transfer, tried

export interface TransferTry {
  holder: Address;
  to: Address;
  tokenId: bigint;
  registry: Address;
  cell: TryCell;
  outcome: CallOutcome;
}

/** The holder tries to give the title away (`unsafeTransfer`, as an `eth_call` from the holder). It reverts
 * `TransferDisallowed`: the title is soulbound. */
export async function tryTransfer(game: string, to: Address): Promise<TransferTry | null> {
  const where = await locate(client, titleName(game));
  if (!where.registry || !where.owner || where.status !== "registered") return null;
  const data: Hex = encodeFunctionData({ abi: permissionedRegistryAbi, functionName: "unsafeTransfer", args: [to, where.tokenId, "0x"] });
  const outcome = await callOutcome(client, where.owner, where.registry, data);
  return { holder: where.owner, to, tokenId: where.tokenId, registry: where.registry, cell: tryCell(outcome), outcome };
}

/** The title's token id now, and whether an earlier token id still names a registered token. */
export async function tokenGone(game: string, oldTokenId: bigint): Promise<boolean> {
  const where = await locate(client, titleName(game));
  if (!where.registry) return true;
  if (where.tokenId === oldTokenId) return false;
  const owner = await client
    .readContract({ address: where.registry, abi: permissionedRegistryAbi, functionName: "ownerOf", args: [oldTokenId] })
    .catch(() => zeroAddress);
  return owner === zeroAddress;
}

