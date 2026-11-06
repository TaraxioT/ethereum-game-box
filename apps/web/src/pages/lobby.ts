// Lobby: a player's test USDC, by name. Pick a player from the list or type a name: it resolves through ENS, and the
// balance is read from the token. "Top up" asks the relayer for 100 USDC; no ETH and no wallet needed. Below, every
// player name with its balance.
import type { Address } from "viem";
import { contractAddress, formatUsdc, fullName } from "@egb/shared/names";

import { topUp } from "../actions.ts";
import { type Route, dir, go, render, state } from "../app.ts";
import { client } from "../chain.ts";
import { playerLabel } from "../directory.ts";
import { playerName, readAddress } from "../ens.ts";
import { TxFailed } from "../txs.ts";
import { addressLink, h, key } from "../ui/dom.ts";
import { readBalance, readBalances } from "../usdc.ts";

const usdcText = (base: bigint) => `${Number(formatUsdc(base)).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`;

function pickForm(current: string, names: readonly string[]): HTMLElement {
  const input = h("input", { type: "text", value: current, list: "players", "aria-label": "player name", placeholder: "nova.gamebox.eth", spellcheck: "false", autocomplete: "off" });
  const look = () => {
    if (input.value.trim()) void go(`#/lobby/${playerName(input.value)}`);
  };
  input.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter") look();
  });
  return h(
    "div.field",
    {},
    input,
    h("datalist", { id: "players" }, ...names.map((name) => h("option", { value: name }))),
    key("Look up", look, true),
  );
}

async function playerPanel(name: string): Promise<HTMLElement> {
  const address = await readAddress(client, name);
  if (!address) {
    return h("div", {}, h("p.hint.bad", {}, `${name} doesn't resolve: getEnsAddress returns null. Claim it on the Players page first.`));
  }
  const balance = await readBalance(client, address);
  const hint = h("span.hint.wait", {}, "The relayer mints 100 test USDC, once per address every 10 minutes.");
  const run = async () => {
    button.disabled = true;
    hint.className = "hint wait";
    hint.textContent = "Asking the relayer…";
    try {
      await topUp(name);
      await render(true);
    } catch (err) {
      hint.className = "hint bad";
      hint.textContent = err instanceof TxFailed ? err.message : String(err);
      button.disabled = false;
    }
  };
  const button = key("Top up 100 USDC", () => void run(), true);
  return h(
    "div",
    {},
    h(
      "dl.dl",
      {},
      h("div", {}, h("dt", {}, "player"), h("dd", {}, name)),
      h("div", {}, h("dt", {}, "addr"), h("dd", {}, addressLink(address), h("small", {}, "getEnsAddress, through the Universal Resolver"))),
      h("div.yes", { "data-focus": "balance" }, h("dt", {}, "balance"), h("dd", {}, usdcText(balance), h("small", {}, "balanceOf on the test USDC"))),
    ),
    h("div.field", {}, button, hint),
  );
}

function balanceTable(rows: { name: string; badge: Address; balance: bigint }[], current: string): HTMLElement {
  const table = h("table.roles.ledger", {}, h("tr", {}, h("th", {}, "player"), h("th", {}, "badge"), h("th", {}, "USDC")));
  for (const row of rows) {
    table.append(
      h(
        row.name === current ? "tr.on" : "tr",
        {},
        h("td", {}, h("a.nm", { href: `#/lobby/${row.name}` }, row.name)),
        h("td", {}, addressLink(row.badge)),
        h("td.num", {}, formatUsdc(row.balance)),
      ),
    );
  }
  return h("div.scroll", { "data-focus": "balances" }, table);
}

export async function lobbyPage(route: Route): Promise<HTMLElement> {
  const d = await dir();
  const mine = playerLabel(d, state.badge?.address ?? null);
  const current = route.arg ? playerName(route.arg) : state.story.label ? fullName(state.story.label) : mine ? fullName(mine) : "";
  const players = [...d.players.values()].sort((a, b) => Number(b.block - a.block));
  const [balances, panel] = await Promise.all([readBalances(client, players.map((p) => p.badge)), current ? playerPanel(current) : null]);
  const rows = players.map((p, i) => ({ name: fullName(p.label), badge: p.badge, balance: balances[i] ?? 0n })).sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0));
  return h(
    "div",
    {},
    h("div.eyebrow", {}, "THE LOBBY · TEST USDC"),
    h("h1", {}, "Lobby"),
    h(
      "p.intro",
      {},
      "Players stake test USDC on a match. Here they top up by name, with no ETH and no wallet: type a player name, ENS resolves it to the badge, and the relayer mints to that address. The token is ",
      addressLink(contractAddress("FakeUSDC")),
      ", a 6-decimal test coin on Sepolia with no value.",
    ),
    h("div.panel", { "data-focus": "topup" }, h("h3", {}, "A PLAYER'S BALANCE"), pickForm(current, players.map((p) => fullName(p.label))), panel),
    h("h2", {}, "EVERY PLAYER"),
    rows.length ? balanceTable(rows, current) : h("p", {}, "No players yet."),
  );
}
