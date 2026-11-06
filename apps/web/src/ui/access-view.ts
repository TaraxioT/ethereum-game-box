// Draws the role table and the Try grid. The grid lights the cells the chain allows; a refusal is a quiet ✕ with
// the decoded error in its tooltip; a cell whose answer changed since the last try is outlined in red.
import type { Address } from "viem";

import { type Account, type RoleRow, type TryCell, tryAll } from "../access.ts";
import { client } from "../chain.ts";
import type { AccountKind } from "../kinds.ts";
import { addressLink, append, h, key, short } from "./dom.ts";

const KIND_NOTE: Record<AccountKind, string> = {
  P256Account: "moved only by a P-256 signature (a passkey, the Box's token or a Worker key)",
  EOA: "an ECDSA key",
  contract: "a contract",
};

/** The account's kind, as a small tag: P256Account, EOA or contract. */
function kindTag(account: Account): HTMLElement | null {
  return account.kind ? h(`span.kt.${account.kind === "P256Account" ? "p256" : account.kind.toLowerCase()}` as "span", { title: KIND_NOTE[account.kind] }, account.kind) : null;
}

/** The role table: for each account, the roles it holds and the keys it may write. */
export function roleTable(rows: readonly RoleRow[]): HTMLElement {
  const table = h("table.roles", {}, h("tr", {}, h("th", {}, "account"), h("th", {}, "may write"), h("th", {}, "roles held")));
  for (const row of rows) {
    const writes = Object.entries(row.keys).filter(([, k]) => k.mayWrite).map(([key]) => key);
    const held = h("td");
    const plain = row.root.filter((r) => !r.endsWith("_ADMIN"));
    const admins = row.root.filter((r) => r.endsWith("_ADMIN"));
    if (plain.length || admins.length) {
      append(held, ...plain.map((r) => h("span.rc", { title: "on every key (root)" }, r)));
      if (admins.length) append(held, h("span.rc.adm", { title: admins.join(", ") }, `+ ${admins.length} admin roles`));
    }
    for (const [key, k] of Object.entries(row.keys)) {
      for (const r of k.roles) append(held, h("span.rc", { title: `on ${key} only` }, `${r} on ${key}`));
    }
    if (!held.childNodes.length) append(held, h("span.none", {}, "nothing"));
    table.append(
      h(
        "tr",
        {},
        h("td", {}, row.account.label, h("small", {}, `${row.account.role} · ${short(row.account.address)}`), kindTag(row.account)),
        h("td", {}, ...(writes.length ? writes.map((key) => h("span.rc.key", {}, key)) : [h("span.none", {}, "no key")])),
        held,
      ),
    );
  }
  return h("div.scroll", {}, table);
}

/** A grid cell's previous answer, by `account:key`, so a change shows. */
export type TryMemory = Map<string, boolean>;

export function tryGrid(accounts: readonly Account[], keys: readonly string[], cells: TryCell[][] | null, memory: TryMemory): HTMLElement {
  const grid = h("div.try", { style: `grid-template-columns: minmax(130px, 200px) repeat(${keys.length}, minmax(52px, 1fr))` });
  append(grid, h("div.corner", {}, "account ↓ · key →"), ...keys.map((key) => h("div.kh", {}, key)));
  accounts.forEach((account, row) => {
    append(grid, h("div.ah", {}, h("b", {}, account.label), h("em", {}, account.role, account.kind ? ` · ${account.kind}` : ""), addressLink(account.address)));
    keys.forEach((key, col) => {
      const cell = cells?.[row]?.[col];
      if (!cell) {
        append(grid, h("div.cell.wait", {}, h("i", {}, "···")));
        return;
      }
      const id = `${account.address}:${key}`;
      const before = memory.get(id);
      const changed = before !== undefined && before !== cell.allowed;
      memory.set(id, cell.allowed);
      const title = cell.allowed
        ? `${account.label} may write ${key}: the eth_call succeeds`
        : `${account.label} writing ${key} reverts: ${cell.error}`;
      const cls = `div.cell.${cell.allowed ? "ok" : "no"}${changed ? ".flip" : ""}`;
      append(
        grid,
        h(cls as "div", { title, "data-cell": id }, h("i", {}, cell.allowed ? "✓" : "✕"), changed ? h("span.was", {}, cell.allowed ? "just granted" : "just revoked") : null),
      );
    });
  });
  return h("div.scroll", {}, grid);
}

/** The legend under the grid: the error names the refusals carry. */
export function tryLegend(cells: TryCell[][] | null): HTMLElement {
  const errors = new Set<string>();
  for (const row of cells ?? []) for (const cell of row) if (!cell.allowed) errors.add(cell.error);
  return h(
    "div.legend",
    {},
    h("span", {}, h("i", { style: "background:var(--sys);box-shadow:0 0 6px var(--sys-glow)" }), "allowed"),
    h("span", {}, h("i", { style: "box-shadow:inset 0 0 0 1px rgb(207 232 246 / 0.2)" }), "reverts ", h("code", {}, [...errors].join(", ") || "…")),
    h("span", {}, h("i", { style: "box-shadow:inset 0 0 0 1px var(--alert);background:rgb(255 45 61 / .15)" }), "changed since the last try"),
  );
}

/** Each name's Try answers from its last draw, so a cell that changed shows it. */
const memories = new Map<string, TryMemory>();

/** The Try grid on `name`'s resolver, its legend and a Try-again key, run once at once. `run` tries every cell again. */
export function tryBlock(name: string, resolver: Address, accounts: readonly Account[], keys: readonly string[]): { el: HTMLElement; run: () => Promise<void> } {
  const memory = memories.get(name) ?? new Map();
  memories.set(name, memory);
  const grid = h("div", { "data-focus": "try" }, tryGrid(accounts, keys, null, new Map()));
  const legend = h("div", {}, tryLegend(null));
  const run = async () => {
    grid.replaceChildren(tryGrid(accounts, keys, null, new Map()));
    const cells = await tryAll(client, name, resolver, accounts, keys);
    grid.replaceChildren(tryGrid(accounts, keys, cells, memory));
    legend.replaceChildren(tryLegend(cells));
  };
  void run();
  return { el: h("div", {}, grid, legend, h("div.actions", {}, key("Try again", () => void run()))), run };
}
