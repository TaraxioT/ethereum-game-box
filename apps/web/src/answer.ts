// Which resolver answered a name, and why. The Universal Resolver keeps the deepest resolver it finds on the way down
// the registries, so a name is answered by:
// - its own resolver, from its own record;
// - its own resolver, from a record it is linked to (a pop-up Box uses its Box's record: record aliasing);
// - an ancestor's resolver, by wildcard (ENSIP-10): the name has no resolver of its own (never registered, or
//   expired), and the ancestor's resolver has no record for it, so it answers with its default record;
// - or nobody: no resolver anywhere on the path, so the name doesn't resolve.
import { type Address, type PublicClient, getAddress, namehash, zeroAddress } from "viem";
import { contractAddress, ensAddress, gameBoxNamesAbi, permissionedResolverAbi } from "@egb/shared/names";

import { locate } from "./registry.ts";

export type Answer =
  | { kind: "none" }
  | { kind: "own"; resolver: Address; recordId: bigint }
  | { kind: "linked"; resolver: Address; recordId: bigint; linkedTo: string }
  | { kind: "wildcard"; resolver: Address; from: string | null; recordId: bigint };

/** What `classifyAnswer` decides from: all chain reads. */
export interface AnswerReads {
  /** The resolver the Universal Resolver found, or null for none (`ResolverNotFound`). */
  answeredBy: Address | null;
  /** The resolver the name's own registry entry points at, or null (none, or expired). */
  own: Address | null;
  /** The record the name uses on `answeredBy` (`getRecordId(namehash(name))`); 0 for none. */
  recordId: bigint;
  /** Each ancestor (`gamebox.eth`, …) with its own resolver, nearest first. */
  ancestors: readonly { name: string; resolver: Address | null }[];
  /** The name this one may be linked to (a pop-up's Box), with the record that name uses. */
  link: { name: string; recordId: bigint } | null;
}

const same = (a: Address, b: Address): boolean => getAddress(a) === getAddress(b);

/** Decides who answered and why, from the reads. */
export function classifyAnswer(reads: AnswerReads): Answer {
  const { answeredBy, own, recordId, link } = reads;
  if (!answeredBy) return { kind: "none" };
  if (own && same(answeredBy, own)) {
    if (link && recordId !== 0n && recordId === link.recordId) {
      return { kind: "linked", resolver: answeredBy, recordId, linkedTo: link.name };
    }
    return { kind: "own", resolver: answeredBy, recordId };
  }
  const from = reads.ancestors.find((a) => a.resolver && same(a.resolver, answeredBy))?.name ?? null;
  return { kind: "wildcard", resolver: answeredBy, from, recordId };
}

/** The answer in a short headline and a sentence, for a person. */
export function explainAnswer(answer: Answer): { headline: string; why: string } {
  switch (answer.kind) {
    case "none":
      return {
        headline: "No resolver",
        why: "No resolver anywhere on the name's path, so the Universal Resolver reverts ResolverNotFound: the name doesn't resolve.",
      };
    case "own":
      return answer.recordId === 0n
        ? { headline: "Its own resolver", why: "The name's own PermissionedResolver answers. Nothing has been written for it yet, so its records are empty." }
        : { headline: "Its own resolver", why: `The name's own PermissionedResolver answers, from the name's own record #${answer.recordId}.` };
    case "linked":
      return {
        headline: `A linked record: ${answer.linkedTo}'s`,
        why: `The name is linked (linkToNode) to record #${answer.recordId} on ${answer.linkedTo}'s resolver, so it serves exactly ${answer.linkedTo}'s records: record aliasing at the resolver level.`,
      };
    case "wildcard":
      return {
        headline: `${answer.from ?? "A parent"}'s resolver, by wildcard`,
        why: `The name has no resolver of its own (never registered, or expired). The Universal Resolver kept the deepest resolver on the way down, ${answer.from ?? "a parent's"}, and called resolve() with the full name (ENSIP-10). ${answer.recordId === 0n ? "It has no record for this name, so it answers with its default record." : `It answers from record #${answer.recordId}.`}`,
      };
  }
}

/** The ancestors of `name`, nearest first, stopping before `eth`: `a.b.gamebox.eth` → `b.gamebox.eth`, `gamebox.eth`. */
export function ancestorsOf(name: string): string[] {
  const labels = name.split(".");
  const out: string[] = [];
  for (let i = 1; i < labels.length - 1; i++) out.push(labels.slice(i).join("."));
  return out;
}

/** The resolver the Universal Resolver finds for `name`, or null when there is none. */
export async function answeringResolver(client: PublicClient, name: string): Promise<Address | null> {
  try {
    const resolver = await client.getEnsResolver({ name, universalResolverAddress: ensAddress("UniversalResolver") });
    return resolver && resolver !== zeroAddress ? resolver : null;
  } catch {
    // `ResolverNotFound`: doesn't resolve.
    return null;
  }
}

/** The record `name` uses on `resolver`, or 0. A resolver without records (not a PermissionedResolver) reads as 0. */
export function recordIdOf(client: PublicClient, resolver: Address, name: string): Promise<bigint> {
  return client
    .readContract({ address: resolver, abi: permissionedResolverAbi, functionName: "getRecordId", args: [namehash(name)] })
    .catch(() => 0n);
}

/** The Box a pop-up label is linked to, or null if it isn't a pop-up. */
export async function popupOf(client: PublicClient, label: string): Promise<string | null> {
  const popup = await client.readContract({ address: contractAddress("GameBoxNames"), abi: gameBoxNamesAbi, functionName: "getPopup", args: [label] });
  return popup.ofBox === "" ? null : popup.ofBox;
}

/** Reads who answers `name` now, and why. */
export async function readAnswer(client: PublicClient, name: string): Promise<Answer> {
  const label = name.split(".")[0] ?? "";
  const ancestors = ancestorsOf(name);
  const [answeredBy, where, parents, ofBox] = await Promise.all([
    answeringResolver(client, name),
    locate(client, name),
    Promise.all(ancestors.map(async (a) => ({ name: a, resolver: (await locate(client, a)).resolver }))),
    ancestors.length === 1 ? popupOf(client, label).catch(() => null) : Promise.resolve(null),
  ]);
  if (!answeredBy) return { kind: "none" };
  const linkName = ofBox ? `${ofBox}.${ancestors[0]}` : null;
  const [recordId, linkRecord] = await Promise.all([
    recordIdOf(client, answeredBy, name),
    linkName ? recordIdOf(client, answeredBy, linkName) : Promise.resolve(0n),
  ]);
  return classifyAnswer({
    answeredBy,
    own: where.status === "registered" ? where.resolver : null,
    recordId,
    ancestors: parents,
    link: linkName ? { name: linkName, recordId: linkRecord } : null,
  });
}
