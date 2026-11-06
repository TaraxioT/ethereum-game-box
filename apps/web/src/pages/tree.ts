// Home: the tree. gamebox.eth, then its own registry, then every Box, player, game and title name with its resolver.
// Each part of the ENS brief sits in the margin next to the row that shows it.
import { type Address, zeroAddress } from "viem";
import { PARENT_NAME, contractAddress, fullName, gameBoxNamesAbi, permissionedRegistryAbi, titleName } from "@egb/shared/names";

import { dir, go, state } from "../app.ts";
import { client } from "../chain.ts";
import { AGENT_LABEL, GAMES } from "../config.ts";
import { readAddress } from "../ens.ts";
import { locate } from "../registry.ts";
import { addressLink, h, key, nameParts, note, short } from "../ui/dom.ts";
import { countdownEl } from "../ui/live.ts";
import { readHolders } from "../model.ts";

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
    row({ depth: 0, name: PARENT_NAME, what: ".eth name, in ENSv2's .eth registry", resolver: parent.resolver, expiry: expiryCell(parent.expiry), focus: "parent" }),
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

  // Boxes, newest licence first; lapsed pop-ups read as such.
  const boxes = [...d.boxes.values()].sort((a, b) => Number(b.block - a.block)).slice(0, 8);
  const boxStates = await Promise.all(
    boxes.map(async (box) => ({ box, where: await locate(client, fullName(box.label)), resolves: await readAddress(client, fullName(box.label)) })),
  );
  let firstPopup = true;
  let firstBox = true;
  for (const { box, where, resolves } of boxStates) {
    const popup = box.label.startsWith("popup-");
    const dead = resolves === null;
    rows.push(
      row({
        depth: 2,
        name: fullName(box.label),
        label: nameParts(fullName(box.label)),
        what: dead ? h("span.expired-note", {}, `${popup ? "pop-up Box" : "Box"} · expired: no longer resolves`) : `${popup ? "pop-up Box · 10-minute licence" : "Box · licensed to an operator"}`,
        resolver: where.resolver ?? box.resolver,
        expiry: dead ? h("span.expired-note", {}, "expired") : expiryCell(where.expiry),
        dead,
        note: popup && !dead && firstPopup ? "Expiring names" : !popup && firstBox ? "Revocable names: the registrar alone writes status" : undefined,
        focus: popup ? `popup ${box.label === state.story.popup ? "story-popup" : ""}` : "box",
      }),
    );
    if (popup && !dead) firstPopup = false;
    if (!popup) firstBox = false;
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
        note: i === 0 ? "Forever names with no parent control" : i === 1 ? "Subnames get their own Permissioned Resolver" : undefined,
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
      h("div.actions", {}, key("Claim a name", () => void go("#/players")), key("Open a pop-up Box", () => void go("#/boxes")), key("Report a match", () => void go("#/champions"))),
    ),
  );
}

async function isEmancipated(registry: Address): Promise<boolean> {
  if (registry === zeroAddress) return false;
  return client.readContract({ address: registry, abi: permissionedRegistryAbi, functionName: "isEmancipated" });
}
