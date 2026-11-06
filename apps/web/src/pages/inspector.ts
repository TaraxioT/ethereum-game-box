// The inspector, on any name: where it lives (registry, resolver, expiry, emancipation), which resolver answered it
// and why, who may write what (the role table, with each account's kind), and Try: every known account tries every
// key with an `eth_call`, and the chain answers each cell. A badge's own name shows its QR code and its primary name.
import { type Address, getAddress } from "viem";
import { BOX_KEYS, PARENT_NAME } from "@egb/shared/names";

import { type Account, type RoleRow, readRoleTable } from "../access.ts";
import { revokeStats, setPrimaryName, tryTransfer } from "../actions.ts";
import { readAnswer } from "../answer.ts";
import { type Route, dir, render, setFocus, state } from "../app.ts";
import { client } from "../chain.ts";
import { ensAppLink } from "../config.ts";
import { readAccountKinds } from "../kinds.ts";
import { readAddress, readPrimaryName, readText } from "../ens.ts";
import { type NameKind, accountsFor, keysFor, kindOf } from "../model.ts";
import { FOREVER, type Location, locate } from "../registry.ts";
import { TxFailed } from "../txs.ts";
import { roleTable, tryBlock } from "../ui/access-view.ts";
import { answerView } from "../ui/answer-view.ts";
import { addressLink, append, h, key, short } from "../ui/dom.ts";
import { qrCode } from "../ui/qr.ts";
import { operatorSiteKey, recordWatch } from "../ui/watch-view.ts";
import { agoEl, countdownEl } from "../ui/live.ts";
import { when } from "../time.ts";

const LEDE: Record<NameKind, string> = {
  parent: "The .eth name everything hangs from. Its subregistry is a UserRegistry we deployed, so every name below lives in our own registry.",
  box: "A Box name. Its licence is its expiry. GameBoxNames writes boxKey and status, the operator writes its four keys from the operator site, and the Box itself writes lastSeen and game: each on its own keys and nothing else.",
  popup: "A pop-up Box. It has no resolver or record of its own: it is linked to its Box's record on its Box's resolver, so it serves exactly the Box's records while its 10-minute licence lasts. Then it falls back to gamebox.eth's default record.",
  player: "A player name. The badge that claimed it holds every role on its own resolver, and the parent kept none. The game's PlayerStats may write stats, and nothing else, until the badge takes that away.",
  agent: "The practice opponent's name. The agent holds every role on its own resolver and keeps its ENSIP-26 records there; the game may write its stats and nothing else.",
  game: "A game name, with its own title registry. Only GameBoxNames writes it.",
  title: "A champion title. It moves to each new winner (the old token is unregistered and a new one minted), lapses a term after the last win, and can't be transferred.",
  cup: "A championship. While it runs, Championships rewrites its standings, leader and addr after every result. At close it is registered to the winner with no expiry, and Championships gives up every role on its resolver: the records are frozen, and nobody can write them again.",
  other: "A name under gamebox.eth.",
};

const BRIEF: Record<NameKind, string> = {
  parent: "Deploy your own subname registry",
  box: "Expiring names · Revocable names · Edit only certain text records",
  popup: "Record aliasing at the resolver level · Expiring names · Wildcard resolution",
  player: "Forever names with no parent control",
  agent: "Agents as namespaces",
  game: "Deploy your own subname registry: one per game",
  title: "Non-transferable names",
  cup: "Live records, then frozen: no account can change them",
  other: "Resolve subnames off a parent's resolver (wildcard)",
};

function fact(label: string, value: Node | string, small?: Node | string, yes = false): HTMLElement {
  return h(yes ? "div.yes" : "div", {}, h("dt", {}, label), h("dd", {}, value, small ? h("small", {}, small) : null));
}

function expiryFact(where: Location): HTMLElement {
  if (where.expiry >= FOREVER) return fact("expiry", "never", "2^64 − 1", true);
  if (where.status !== "registered" && where.expiry === 0n) return fact("expiry", "not registered", "free to claim, or not licensed yet");
  if (where.status !== "registered") return fact("expiry", h("span.bad", {}, "expired"), "no address of its own any more");
  return fact("expiry", countdownEl(where.expiry), when(where.expiry));
}

export async function inspectorPage(route: Route): Promise<HTMLElement> {
  const name = route.arg.toLowerCase();
  const d = await dir();
  const kind = kindOf(d, name);
  const [where, address, answer] = await Promise.all([locate(client, name), readAddress(client, name), readAnswer(client, name)]);
  // `eth / gamebox.eth / nova`: each parent links to its own inspector.
  const parts = name.split(".");
  const crumb = h("div.crumb");
  for (let i = parts.length - 1; i >= 0; i--) {
    const sub = parts.slice(i).join(".");
    if (i < parts.length - 1) append(crumb, " / ");
    append(crumb, i === 0 || sub === "eth" ? (i === 0 ? parts[0] : "eth") : h("a", { href: `#/name/${sub}` }, sub));
  }

  const page = h(
    "div",
    {},
    crumb,
    h("h1", { style: "margin-top:12px" }, h("span.g", {}, name)),
    h("p.intro", { style: "margin-bottom:0" }, LEDE[kind]),
  );

  const facts = h(
    "dl.dl",
    {},
    fact("registry", where.registry ? addressLink(where.registry) : "—", name === PARENT_NAME ? "ENSv2's .eth registry" : `${name.split(".").slice(1).join(".")}'s registry`),
    fact("resolver", where.resolver ? addressLink(where.resolver) : "none", where.resolver ? (kind === "popup" ? "its Box's PermissionedResolver" : "its own PermissionedResolver") : "none of its own"),
    fact("addr", address ? addressLink(address) : h("span.bad", {}, "null"), address ? (state.badge && getAddress(address) === getAddress(state.badge.address) ? `your ${state.badge.kind === "test" ? "test badge" : "wallet"}` : undefined) : "getEnsAddress: does not resolve"),
    expiryFact(where),
    fact("registry emancipated", where.emancipated ? "yes" : "no", where.emancipated ? "the parent holds no role in it" : "the parent can still act on it", where.emancipated),
    fact("token", where.owner ? addressLink(where.owner, short(where.owner)) : "—", where.owner && where.tokenId ? `id ${short(where.tokenId.toString(16))}` : undefined),
  );
  if (kind === "box" || kind === "popup") {
    const [status, lastSeen, game] = await Promise.all(["status", "lastSeen", "game"].map((k) => readText(client, name, k)));
    append(
      facts,
      fact("status", status ?? "—", "written by GameBoxNames alone"),
      fact("lastSeen", lastSeen ? agoEl(Number(lastSeen)) : "never", "written by the Box's own account"),
      fact("game", game ?? "—", "written by the Box's own account"),
    );
  }
  if (kind === "player" || kind === "agent") {
    const [stats, primary] = await Promise.all([
      readText(client, name, "stats"),
      address ? readPrimaryName(client, address).catch(() => null) : Promise.resolve(null),
    ]);
    append(
      facts,
      fact("stats", stats ?? "—", "written by PlayerStats"),
      fact("primary name", primary ?? "none set", primary === name ? "getEnsName(addr) gives this name back" : "getEnsName(addr)", primary === name),
    );
  }
  append(page, facts, answerView(answer), h("p.pull", {}, BRIEF[kind]));

  if (kind === "player" && state.badge && address && getAddress(address) === getAddress(state.badge.address)) {
    const primary = await readPrimaryName(client, address).catch(() => null);
    append(page, yourName(name, primary));
  }
  if (kind === "box" || kind === "popup") {
    append(
      page,
      h(
        "div.callout.sys",
        {},
        h("span", {}, h("b", {}, "Operators work on the operator site. "), "They sign in with a passkey, and their P256Account writes ", h("code", {}, "commission"), ", ", h("code", {}, "location"), ", ", h("code", {}, "description"), " and ", h("code", {}, "games"), ". Nothing the operator does happens on the Box."),
        operatorSiteKey(),
      ),
    );
  }
  if (kind === "box") append(page, recordWatch(name.split(".")[0]!, BOX_KEYS.location));

  if (!where.resolver) return page;
  const resolver = where.resolver;
  const accounts = await accountsFor(client, d, name, kind);
  const keys = keysFor(kind);
  // Each account's kind (P256Account, EOA or contract), for the role table and the grid.
  const kinds = await readAccountKinds(client, accounts.map((a) => a.address));
  for (const account of accounts) account.kind = kinds.get(getAddress(account.address));

  // Who may write what.
  const roles = h("div", { "data-focus": "roles" }, h("p.reading", {}, "Reading roles…"));
  append(
    page,
    h("h2", {}, "WHO MAY WRITE WHAT"),
    h("p", {}, "Read from the resolver with ", h("code", {}, "roles"), " and ", h("code", {}, "hasRoles"), ", and decoded with ENSv2's role names."),
    roles,
  );
  void readRoleTable(client, resolver, accounts, keys)
    .then((rows: RoleRow[]) => roles.replaceChildren(roleTable(rows)))
    .catch(() => roles.replaceChildren(h("p.failed", {}, "Couldn't read the roles.")));

  // Try.
  const tried = tryBlock(name, resolver, accounts, keys);
  append(
    page,
    h("h2", {}, "TRY IT"),
    h(
      "p",
      {},
      "Every account below tries to write every key, as an ",
      h("code", {}, "eth_call"),
      " from that account. Nothing is sent and no gas is spent; the chain answers each one. ",
      h("span.sys", {}, "◆ Enhanced Access Control: edit only certain text records."),
    ),
    tried.el,
  );

  // The badge that owns this name may take `stats` away from the game.
  if (kind === "player" && state.badge && address && getAddress(address) === getAddress(state.badge.address)) {
    append(page, revokePanel(name, tried.run));
  }
  if (kind === "title") append(page, await transferPanel(name, accounts));
  return page;
}

/** The badge's own name: a QR code to it in the ENS app, and its primary name, set here if it isn't yet. */
function yourName(name: string, primary: string | null): HTMLElement {
  const badge = state.badge!;
  const link = ensAppLink(name);
  const isPrimary = primary === name;
  const status = h(
    `span.hint.${isPrimary ? "ok" : "wait"}` as "span",
    {},
    isPrimary
      ? `It is your primary name: getEnsName(${short(badge.address)}) gives ${name} back.`
      : primary
        ? `Your primary name is ${primary}.`
        : "No primary name yet.",
  );
  const run = async () => {
    button.disabled = true;
    status.className = "hint wait";
    status.textContent = badge.kind === "test" ? "The relayer drips the test badge a little ETH first…" : "Confirm in your wallet…";
    try {
      await setPrimaryName(badge, name);
      await render(true);
    } catch (err) {
      status.className = "hint bad";
      status.textContent = err instanceof TxFailed ? `Failed: ${err.message}` : err instanceof Error ? err.message.split("\n")[0]! : String(err);
      button.disabled = false;
    }
  };
  const button = key("Make it your primary name", () => void run(), true);
  return h(
    "div.panel.yours",
    { "data-focus": "yours" },
    h("a.qrlink", { href: link, target: "_blank", rel: "noopener", title: link }, qrCode(link)),
    h(
      "div",
      {},
      h("h3", {}, "YOUR NAME, ON YOUR PHONE"),
      h("p", {}, "Scan it to open ", h("b", {}, name), " in the ENS app on Sepolia: the same registry, resolver and records, read by ENS's own app. ", h("a.ext", { href: link, target: "_blank", rel: "noopener" }, "sepolia.app.ens.domains ↗")),
      h("p", {}, "A primary name is the reverse record: it lets apps show ", h("b", {}, name), " for your address. ", isPrimary ? "" : "Setting it is a transaction from the badge itself, on ENS's reverse registrar."),
      h("div.actions", { style: "margin-top:8px;align-items:center" }, isPrimary ? null : button, status),
    ),
  );
}

function revokePanel(name: string, again: () => Promise<void>): HTMLElement {
  const badge = state.badge!;
  const label = name.split(".")[0]!;
  const status = h("span.hint.wait", {}, badge.kind === "test" ? "A test badge has no ETH: the relayer drips it 0.0003 ETH first, as its own step." : "");
  const run = async () => {
    button.disabled = true;
    try {
      await revokeStats(badge, label);
      await again();
      setFocus("try");
      status.textContent = "Revoked. PlayerStats' stats cell now reverts; results still count, and PlayerStats skips this player.";
      status.className = "hint ok";
    } catch (err) {
      status.textContent = err instanceof TxFailed ? `Failed: ${err.message}` : String(err);
      status.className = "hint bad";
      button.disabled = false;
    }
  };
  const button = key("Revoke PlayerStats' stats role", () => void run(), true);
  return h(
    "div.callout.sys",
    {},
    h("span", {}, h("b", {}, "Your badge controls this name. "), "Take ", h("code", {}, "SET_TEXT"), " on ", h("code", {}, "stats"), " away from PlayerStats: a transaction from the badge itself. ", status),
    button,
  );
}

async function transferPanel(name: string, accounts: readonly Account[]): Promise<HTMLElement> {
  const game = name.split(".")[1]!;
  const holder = await readAddress(client, name);
  const to: Address | undefined = accounts.find((a) => !holder || getAddress(a.address) !== getAddress(holder))?.address;
  if (!holder || !to) return h("div");
  const result = await tryTransfer(game, to);
  if (!result) return h("div");
  const refused = !result.cell.allowed;
  return h(
    "div",
    { "data-focus": "transfer" },
    h("h2", {}, "TRY TO TRANSFER IT"),
    h("p", {}, "The holder tries to give the title away: ", h("code", {}, "unsafeTransfer"), " on the title registry, as an ", h("code", {}, "eth_call"), " from the holder."),
    h(
      refused ? "div.callout" : "div.callout.sys",
      {},
      h("span", {}, h("b", {}, refused ? `Reverts ${result.cell.allowed ? "" : result.cell.error}. ` : "It would go through. "), refused ? "The title is soulbound: it moves only when someone else wins." : ""),
      key("Try again", () => void render(true)),
    ),
  );
}
