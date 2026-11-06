// Home: the tree. gamebox.eth, then its own registry, then every Box (with its pop-ups), player, game, title and
// championship name with its resolver.
// Each part of the ENS brief sits in the margin next to the row that shows it.
import { type Address, zeroAddress } from "viem";
import { PARENT_NAME, contractAddress, fullName, gameBoxNamesAbi, permissionedRegistryAbi, titleName } from "@egb/shared/names";

import { dir, go, state } from "../app.ts";
import { client } from "../chain.ts";
import { AGENT_LABEL, POPUP_BOX_LABEL, GAMES } from "../config.ts";
import { hasWinner } from "../directory.ts";
import { locate } from "../registry.ts";
import { addressLink, h, key, nameParts, note, short } from "../ui/dom.ts";
import { countdownEl } from "../ui/live.ts";
import { readHolders } from "../model.ts";
import { nowSeconds } from "../time.ts";

interface Row {
  depth: 0 | 1 | 2 | 3;
  name: string | null;
  label?: Node;
  what: Node | string;
  resolver: Address | null;
  expiry: Node | string;
  note?: string;
  focus?: string;
  dead?: boolean;
}

function row(r: Row): HTMLElement {
  const nm = r.name ? h("a.nm", { href: `#/name/${r.name}` }, r.label ?? nameParts(r.name)) : h("span.nm", {}, r.label ?? "");
  return h(
    `div.tr.d${r.depth}${r.dead ? ".dead" : ""}` as "div",
    { "data-focus": r.focus },
    nm,
    h("span.what", {}, r.what),
    h("span.res", {}, r.resolver ? addressLink(r.resolver) : "—"),
    h("span.exp", {}, r.expiry),
    r.note ? note(r.note, r.focus) : null,
  );
}

const expiryCell = (expiry: bigint) => countdownEl(expiry);

export async function treePage(): Promise<HTMLElement> {
  const d = await dir();
  const parent = await locate(client, PARENT_NAME);
  const holders = await readHolders(client);
  const userRegistry = await client.readContract({ address: contractAddress("GameBoxNames"), abi: gameBoxNamesAbi, functionName: "REGISTRY" });

  const rows: HTMLElement[] = [
    h("div.tr.hd", {}, h("span.nm", {}, "name"), h("span.res", {}, "resolver"), h("span.exp", {}, "expiry")),
    row({
      depth: 0,
      name: PARENT_NAME,
      what: ".eth name, in ENSv2's .eth registry. Its own resolver holds the default record every free name resolves to",
      resolver: parent.resolver,
      expiry: expiryCell(parent.expiry),
      note: "Resolve subnames off a parent's resolver (wildcard)",
      focus: "parent",
    }),
    row({
      depth: 1,
      name: null,
      label: h("span", {}, "UserRegistry ", h("small", {}, "our registry")),
      what: h("span", {}, addressLink(userRegistry), " · ", (await isEmancipated(userRegistry)) ? "emancipated: the parent holds no role in it" : "not emancipated"),
      resolver: null,
      expiry: "—",
      note: "Deploy your own subname registry",
      focus: "registry",
    }),
  ];

  // Boxes, newest licence first, each with its newest pop-ups under it (linked to its record).
  const now = BigInt(nowSeconds());
  const boxes = [...d.boxes.values()].sort((a, b) => Number(b.block - a.block)).slice(0, 6);
  let firstBox = true;
  let firstLive = true;
  let firstLapsed = true;
  for (const box of boxes) {
    const where = await locate(client, fullName(box.label));
    const dead = where.status !== "registered";
    rows.push(
      row({
        depth: 2,
        name: fullName(box.label),
        what: dead ? h("span.expired-note", {}, "Box · expired: no longer resolves") : "Box · licensed to an operator, who manages it on the operator site",
        resolver: where.resolver ?? box.resolver,
        expiry: dead ? h("span.expired-note", {}, "expired") : expiryCell(where.expiry),
        dead,
        note: firstBox ? "Revocable names: the registrar alone writes status" : undefined,
        focus: box.label === POPUP_BOX_LABEL ? "box mumbai" : "box",
      }),
    );
    firstBox = false;
    const popups = [...d.popups.values()]
      .filter((p) => p.ofBox === box.label)
      .sort((a, b) => Number(b.block - a.block))
      .slice(0, 4);
    for (const popup of popups) {
      const lapsed = popup.expiry <= now;
      rows.push(
        row({
          depth: 3,
          name: fullName(popup.label),
          what: lapsed
            ? h("span.expired-note", {}, "pop-up · expired: no address; gamebox.eth's default record answers")
            : h("span", {}, "pop-up · linked to ", h("b", {}, box.label), "'s record · 10-minute licence"),
          resolver: lapsed ? null : box.resolver,
          expiry: lapsed ? h("span.expired-note", {}, "expired") : expiryCell(popup.expiry),
          dead: lapsed,
          note: !lapsed && firstLive ? "Record aliasing at the resolver level · Expiring names" : lapsed && firstLapsed ? "Resolve subnames off a parent's resolver (wildcard)" : undefined,
          focus: "popup",
        }),
      );
      if (lapsed) firstLapsed = false;
      else firstLive = false;
    }
  }

  if (!d.boxes.has(POPUP_BOX_LABEL)) {
    rows.push(
      row({
        depth: 2,
        name: fullName(POPUP_BOX_LABEL),
        what: h("span.expired-note", {}, "Box · not licensed yet: its operator registers it on the operator site"),
        resolver: null,
        expiry: "—",
        dead: true,
        focus: "box mumbai",
      }),
    );
  }

  // Players (the agent has its own row below), newest first.
  const players = [...d.players.values()].filter((p) => p.label !== AGENT_LABEL).sort((a, b) => Number(b.block - a.block)).slice(0, 10);
  players.forEach((p, i) => {
    const held = [...holders].filter(([, holder]) => holder?.toLowerCase() === p.badge.toLowerCase()).map(([game]) => titleName(game));
    rows.push(
      row({
        depth: 2,
        name: fullName(p.label),
        what: h("span", {}, "player · ", short(p.badge), held.length ? h("span.p1t", {}, ` · holds ${held.join(", ")}`) : ""),
        resolver: p.resolver,
        expiry: "never",
        note: i === 0 ? "Forever names with no parent control" : i === 1 ? "Subnames get their own Permissioned Resolver and fully own their data" : undefined,
        focus: `player${p.label === state.story.label ? " story-player" : ""}`,
      }),
    );
  });

  // Games and their soulbound titles.
  for (const game of GAMES) {
    const g = d.games.get(game);
    const gameWhere = await locate(client, fullName(game));
    rows.push(row({ depth: 2, name: fullName(game), what: h("span", {}, "game · its own title registry ", g ? addressLink(g.titleRegistry) : ""), resolver: gameWhere.resolver, expiry: expiryCell(gameWhere.expiry), focus: "game" }));
    const title = await locate(client, titleName(game));
    const holder = holders.get(game) ?? null;
    const holderLabel = holder ? d.labelOf.get(holder.toLowerCase()) : null;
    rows.push(
      row({
        depth: 3,
        name: titleName(game),
        what: holder ? h("span", {}, "title · ", h("span.p1t", {}, holderLabel ?? short(holder))) : h("span.expired-note", {}, "title · unclaimed or lapsed"),
        resolver: title.resolver,
        expiry: holder ? expiryCell(title.expiry) : "—",
        note: game === GAMES[0] ? "Non-transferable names" : undefined,
        focus: "title",
        dead: !holder,
      }),
    );
    // Its championships, newest first: live records while open, then frozen for good under the winner.
    const cups = [...d.cups.values()].filter((cup) => cup.game === game).reverse().slice(0, 3);
    for (const cup of cups) {
      const where = await locate(client, cup.name);
      const gone = cup.closed !== null && !hasWinner(cup);
      const winner = cup.closed && !gone ? (d.labelOf.get(cup.closed.winner.toLowerCase()) ?? short(cup.closed.winner)) : null;
      rows.push(
        row({
          depth: 3,
          name: cup.name,
          what: !cup.closed
            ? "championship · live records: standings, leader and addr move with every result"
            : winner
              ? h("span", {}, "championship · records frozen · held by ", h("span.p1t", {}, winner), " for good")
              : h("span.expired-note", {}, "championship · nobody played: unregistered"),
          resolver: gone ? null : cup.resolver,
          expiry: gone ? "—" : expiryCell(where.expiry),
          note: cup === cups[0] ? "Live records, then frozen" : undefined,
          focus: "cup",
          dead: gone,
        }),
      );
    }
  }

  // The agent.
  const agent = d.players.get(AGENT_LABEL);
  if (agent) {
    rows.push(row({ depth: 2, name: fullName(AGENT_LABEL), what: "agent · ENSIP-26 records", resolver: agent.resolver, expiry: "never", note: "Agents as namespaces", focus: "agent" }));
  }

  return h(
    "div",
    {},
    h("div.eyebrow", {}, "ENSV2 ON SEPOLIA · LIVE"),
    h("h1", {}, "Every name under ", h("span.g", {}, "gamebox.eth")),
    h(
      "p.intro",
      {},
      "Game Box is a console you play by tapping a badge. Each Box, player, game and champion title is an ENSv2 name in ",
      h("b", {}, "a registry we deployed"),
      ", and each one has ",
      h("b", {}, "its own resolver"),
      " that decides who may write which record. Everything below is read from Sepolia as you watch. Open any name to see who may write what, and try it.",
    ),
    h("h2", {}, "THE TREE"),
    h("p", {}, "Indented names live in their parent's registry. The notes on the right say which part of the ENS brief each one shows."),
    h(
      "div.wide",
      {},
      h("div.tree", {}, ...rows),
      h("div.actions", {}, key("Claim a name", () => void go("#/players")), key("Top up in the lobby", () => void go("#/lobby")), key("Report a match", () => void go("#/champions")), key("Championships", () => void go("#/championships"))),
    ),
  );
}

async function isEmancipated(registry: Address): Promise<boolean> {
  if (registry === zeroAddress) return false;
  return client.readContract({ address: registry, abi: permissionedRegistryAbi, functionName: "isEmancipated" });
}
