// The record watch: one key (`location`) read through ENS on a Box and on every pop-up linked to it, again at each
// new block. The operator changes it on the operator site; here the new value appears on the Box and its pop-ups in
// the same block, with the transaction that wrote it.
import { fullName } from "@egb/shared/names";

import { recordIdOf } from "../answer.ts";
import { dir } from "../app.ts";
import { client, onHead } from "../chain.ts";
import { OPERATOR_SITE_URL } from "../config.ts";
import { readText } from "../ens.ts";
import { readBox } from "../model.ts";
import { nowSeconds } from "../time.ts";
import { type Watched, lastTextWrite, track } from "../watch.ts";
import { h, nameLink, txLink } from "./dom.ts";

/** A link to the operator site, styled as a key. */
export function operatorSiteKey(text = "Open the operator site ↗"): HTMLAnchorElement {
  return h("a.btn.out", { href: OPERATOR_SITE_URL, target: "_blank", rel: "noopener" }, text);
}

/** The names to watch: the Box and its live pop-ups. */
async function watchedNames(box: string, boxState: string | null): Promise<{ name: string; state: string | null }[]> {
  const d = await dir();
  const now = BigInt(nowSeconds());
  const popups = [...d.popups.values()]
    .filter((p) => p.ofBox === box && p.expiry > now)
    .sort((a, b) => Number(b.block - a.block))
    .slice(0, 4)
    .map((p) => ({ name: fullName(p.label), state: null }));
  return [{ name: fullName(box), state: boxState }, ...popups];
}

export function recordWatch(box: string, key: string): HTMLElement {
  const rows = h("div.watch", {}, h("p.reading", {}, "Reading…"));
  const last = h("p.hint.wait", {}, "");
  const panel = h(
    "div.panel.wide-panel",
    { "data-focus": "operator-watch" },
    h("h3", {}, `${key.toUpperCase()} ON ${box.toUpperCase()} AND ITS POP-UPS`),
    h(
      "p",
      {},
      "The operator signs in on the operator site with a passkey and saves a new ",
      h("code", {}, key),
      ": one ",
      h("code", {}, "executeBatch"),
      " from its P256Account, sent by the relayer. Every pop-up is linked to ",
      h("b", {}, box),
      "'s record, so the new value shows on all of them at the same block. Read again at every block.",
    ),
    rows,
    last,
    h("div.actions", {}, operatorSiteKey()),
  );

  let seen = new Map<string, Watched>();
  let busy = false;
  let wasConnected = false;
  const unsubscribe = onHead((block) => {
    if (panel.isConnected) wasConnected = true;
    else if (wasConnected) return unsubscribe();
    if (busy) return;
    busy = true;
    void refresh(block).finally(() => (busy = false));
  });

  async function refresh(block: bigint): Promise<void> {
    const view = await readBox(client, box);
    // A Box that was never licensed has expiry 0; one whose licence ran out has a past expiry.
    const boxState = view.resolves !== null ? null : view.expiry === 0n ? "not licensed yet: gamebox.eth's default" : "lapsed: gamebox.eth's default";
    const watched = await watchedNames(box, boxState);
    const [values, records] = await Promise.all([
      Promise.all(watched.map(({ name }) => readText(client, name, key).catch(() => null))),
      Promise.all(watched.map(({ name }) => recordIdOf(client, view.resolver, name))),
    ]);
    seen = track(seen, new Map(watched.map(({ name }, i) => [name, values[i] ?? null])), block);
    rows.replaceChildren(
      ...watched.map(({ name, state: note }, i) => {
        const w = seen.get(name)!;
        const record = records[i] ?? 0n;
        return h(
          `div.wr${w.changedAt !== null ? ".changed" : ""}${note ? ".lapsed" : ""}` as "div",
          {},
          nameLink(name),
          h("span.wv", {}, w.value ?? h("span.bad", {}, "—")),
          h("span.wid", {}, note ?? (record === 0n ? "no record yet" : `record #${record}`)),
          h("span.wc", {}, w.changedAt !== null ? `changed at block ${w.changedAt}` : ""),
        );
      }),
    );
    const recordId = records[0] ?? 0n;
    const write = recordId === 0n ? null : await lastTextWrite(client, view.resolver, recordId, key, block).catch(() => null);
    last.replaceChildren(
      write ? h("span", {}, `Last written in block ${write.block}: `, txLink(write.hash)) : `No ${key} write in the last 10,000 blocks.`,
    );
  }
  return panel;
}
