// Championships: time-boxed competitions, each an ENS name, `<label>.<game>.gamebox.eth`. An open one shows its live
// records (the standings, the leader by name, the countdown to `ends` and the prize), read through ENS. The latest
// closed one shows its frozen name, its winner, and the Try grid with every write reverting. Below, every
// championship, from `Championships`' events.
import { getAddress } from "viem";
import { type Standing, formatUsdc, fullName, ourContract } from "@egb/shared/names";

import { readRoleTable } from "../access.ts";
import { closeCup } from "../actions.ts";
import { dir, render } from "../app.ts";
import { client } from "../chain.ts";
import { type CupView, readCup } from "../cups.ts";
import { type CupEntry, type Directory, closedCups, hasWinner, openCups } from "../directory.ts";
import { readAccountKinds } from "../kinds.ts";
import { accountsFor, keysFor } from "../model.ts";
import { nowSeconds, when } from "../time.ts";
import { TxFailed } from "../txs.ts";
import { roleTable, tryBlock } from "../ui/access-view.ts";
import { addressLink, append, h, key, nameParts, short, tag, txLink } from "../ui/dom.ts";
import { countdownEl } from "../ui/live.ts";

const usdcText = (base: bigint | null) => (base === null ? "—" : `${formatUsdc(base)} USDC`);

/** A badge by its player name, from the directory, or short. */
const playerOf = (d: Directory, address: string): string => {
  const label = d.labelOf.get(address.toLowerCase());
  return label ? fullName(label) : short(address);
};

function standingsTable(rows: readonly Standing[]): HTMLElement {
  const table = h("table.roles.ledger", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "player"), h("th", {}, "pts"), h("th", {}, "W"), h("th", {}, "D"), h("th", {}, "L")));
  rows.forEach((row, i) => {
    table.append(
      h(
        i === 0 ? "tr.on" : "tr",
        {},
        h("td.num", {}, String(i + 1)),
        h("td", {}, row.name ? h("a.nm", { href: `#/name/${row.name}` }, row.name) : short(row.addr)),
        h("td.num", {}, String(row.points)),
        h("td.num", {}, String(row.wins)),
        h("td.num", {}, String(row.draws)),
        h("td.num", {}, String(row.losses)),
      ),
    );
  });
  return h("div.scroll", {}, table);
}

function liveCup(cup: CupView): HTMLElement {
  const ends = cup.ends ?? cup.entry.ends;
  const over = ends <= BigInt(nowSeconds());
  const hint = h("span.hint.wait", {}, "Anyone may close it now; the demo Box closes it on its next beat if nobody does.");
  const close = async () => {
    button.disabled = true;
    try {
      await closeCup(cup.entry.game, cup.entry.name);
      await render(true);
    } catch (err) {
      hint.className = "hint bad";
      hint.textContent = err instanceof TxFailed ? err.message : String(err);
      button.disabled = false;
    }
  };
  const button = key("Close it", () => void close(), true);
  return h(
    "div.panel.cup",
    { "data-focus": "cups cup-live" },
    h("div.kind", {}, "cup", tag("live records", "ok"), tag(cup.entry.game)),
    h("a.cn", { href: `#/name/${cup.entry.name}` }, nameParts(cup.entry.name)),
    h("span.big", {}, countdownEl(ends)),
    h(
      "dl.dl",
      {},
      h("div", {}, h("dt", {}, "prize"), h("dd", {}, usdcText(cup.prize), h("small", {}, "the prize record"))),
      h("div", {}, h("dt", {}, "leader"), h("dd", {}, cup.leader ?? "nobody yet", h("small", {}, "the leader record"))),
      h("div", {}, h("dt", {}, "addr"), h("dd", {}, cup.addr ? addressLink(cup.addr) : "—", h("small", {}, "follows the leader"))),
    ),
    cup.standings?.length ? standingsTable(cup.standings) : h("p", {}, "No results yet: the standings record is ", h("code", {}, "[]"), "."),
    h(
      "p.hint.wait",
      {},
      `Championships rewrites standings, leader and addr after every ${cup.entry.game} result BoxResults accepts before it ends: win 3, draw 1, loss 0. Scoring stops at `,
      when(ends),
      ".",
    ),
    over ? h("div.field", {}, button, hint) : null,
  );
}

async function frozenCup(d: Directory, cup: CupView): Promise<HTMLElement> {
  const name = cup.entry.name;
  const closed = cup.entry.closed!;
  const panel = h(
    "div.panel.cup.frozen",
    { "data-focus": "cups cup-frozen" },
    h("div.kind", {}, "cup", tag("closed"), tag("records frozen", "warn")),
    h("a.cn", { href: `#/name/${name}` }, nameParts(name)),
    h(
      "dl.dl",
      {},
      h("div.yes", {}, h("dt", {}, "winner"), h("dd", {}, cup.winner ?? playerOf(d, closed.winner), h("small", {}, "the winner record"))),
      h("div", {}, h("dt", {}, "holds the name"), h("dd", {}, cup.where.owner ? addressLink(cup.where.owner) : "—", h("small", {}, "the winner's badge"))),
      h("div.yes", {}, h("dt", {}, "expiry"), h("dd", {}, countdownEl(cup.where.expiry), h("small", {}, "no expiry"))),
      h("div", {}, h("dt", {}, "prize paid"), h("dd", {}, usdcText(closed.prize), h("small", {}, txLink(closed.hash)))),
    ),
    cup.standings?.length ? standingsTable(cup.standings) : null,
    h(
      "div.callout.sys",
      {},
      h(
        "span",
        {},
        h("b", {}, "The records are frozen, and the winner holds the name with no expiry. "),
        "At close, Championships gave up every role it held on this name's resolver, and nobody else held one, so no account can change these records again. Championships keeps its registrar roles on the game's registry, because it needs them to open the next cup; it has no function that touches a closed one.",
      ),
    ),
  );
  if (!cup.where.resolver) return panel;
  const resolver = cup.where.resolver;
  const accounts = await accountsFor(client, d, name, "cup");
  const keys = keysFor("cup");
  const kinds = await readAccountKinds(client, accounts.map((a) => a.address));
  for (const account of accounts) account.kind = kinds.get(getAddress(account.address));
  const roles = h("div", {}, h("p.reading", {}, "Reading roles…"));
  void readRoleTable(client, resolver, accounts, keys)
    .then((rows) => roles.replaceChildren(roleTable(rows)))
    .catch(() => roles.replaceChildren(h("p.failed", {}, "Couldn't read the roles.")));
  append(
    panel,
    h("h3", { style: "margin-top:22px" }, "WHO MAY WRITE WHAT"),
    roles,
    h("h3", { style: "margin-top:22px" }, "TRY IT"),
    h("p", {}, "Every account tries to write every record, as an ", h("code", {}, "eth_call"), " from that account: ours, the winner's and Championships' own. Each one reverts."),
    tryBlock(name, resolver, accounts, keys).el,
  );
  return panel;
}

function historyRow(d: Directory, cup: CupEntry): HTMLElement {
  const status = !cup.closed
    ? cup.ends <= BigInt(nowSeconds())
      ? h("span", {}, "ended · waiting to close")
      : h("span", {}, "open · ends in ", countdownEl(cup.ends))
    : hasWinner(cup)
      ? h("span", {}, "won by ", h("b", { style: "color:var(--fg)" }, playerOf(d, cup.closed.winner)), ` · ${usdcText(cup.closed.prize)}`)
      : h("span", {}, "nobody played · the prize went back and the name was unregistered");
  return h(
    "li",
    {},
    h("span.r", {}, `#${cup.id}`),
    h("a.nm", { href: `#/name/${cup.name}` }, cup.name),
    status,
    txLink(cup.hash),
    cup.closed ? txLink(cup.closed.hash) : null,
  );
}

export async function championshipsPage(): Promise<HTMLElement> {
  const page = h(
    "div",
    {},
    h("div.eyebrow", {}, "LIVE RECORDS, THEN FROZEN"),
    h("h1", {}, "Championships"),
    h(
      "p.intro",
      {},
      "A cup is a time-boxed competition: points across many matches, and a USDC prize. Each one is an ENS name in its game's registry, ",
      h("code", {}, "<label>.<game>.gamebox.eth"),
      ", with ",
      h("b", {}, "its own resolver"),
      ". While it runs, every result rewrites its records. When it closes, the prize is paid, the name goes to the winner for good, and ",
      h("b", {}, "its records are frozen"),
      ".",
    ),
  );
  if (!ourContract("Championships")) {
    append(page, h("p", {}, "Championships isn't deployed yet."));
    return page;
  }
  const d = await dir();
  const open = openCups(d);
  const frozen = closedCups(d).find(hasWinner);
  // A block behind the head, which every public RPC node has.
  const at = (await client.getBlockNumber({ cacheTime: 0 })) - 1n;
  const [live, last] = await Promise.all([Promise.all(open.map((cup) => readCup(client, cup, at))), frozen ? readCup(client, frozen, at) : null]);
  append(
    page,
    h("h2", {}, "OPEN NOW"),
    ...(live.length ? live.map(liveCup) : [h("p", {}, "No cup is open right now. The next one opens at the booth.")]),
    h("h2", {}, "CLOSED, FROZEN FOR GOOD"),
    last ? await frozenCup(d, last) : h("p", {}, "None has closed with a winner yet."),
    h("h2", {}, "EVERY CHAMPIONSHIP"),
    d.cups.size
      ? h("ul.history", {}, ...[...d.cups.values()].reverse().map((cup) => historyRow(d, cup)))
      : h("p", {}, "None opened yet."),
  );
  return page;
}
