// Agent: `bot.gamebox.eth`, the practice opponent. Its ENSIP-26 records, what it may write, and what the game may
// write to it: an agent with its own name, records and permissions.
import { fullName } from "@egb/shared/names";

import { readRoleTable } from "../access.ts";
import { dir, go } from "../app.ts";
import { client } from "../chain.ts";
import { AGENT_LABEL } from "../config.ts";
import { AGENT_RECORD_KEYS, accountsFor, keysFor, readAgent } from "../model.ts";
import { locate } from "../registry.ts";
import { roleTable } from "../ui/access-view.ts";
import { addressLink, h, key, nameParts } from "../ui/dom.ts";

export async function agentPage(): Promise<HTMLElement> {
  const d = await dir();
  const name = fullName(AGENT_LABEL);
  const [agent, where] = await Promise.all([readAgent(client), locate(client, name)]);
  const records = h(
    "dl",
    {},
    h("dt", {}, "addr"),
    h("dd", {}, agent.address ? addressLink(agent.address) : h("span.bad", {}, "null")),
    ...AGENT_RECORD_KEYS.flatMap((k) => [h("dt", {}, k), h("dd", {}, agent.records[k] ?? "—")]),
    h("dt", {}, "stats"),
    h("dd", {}, agent.stats ?? "no games yet"),
  );
  const roles = h("div", {}, h("p.reading", {}, "Reading roles…"));
  if (where.resolver) {
    const accounts = (await accountsFor(client, d, name, "agent")).slice(0, 3);
    void readRoleTable(client, where.resolver, accounts, keysFor("agent")).then((rows) => roles.replaceChildren(roleTable(rows)));
  }
  return h(
    "div",
    { "data-focus": "agent" },
    h("div.eyebrow", {}, "AGENTS AS NAMESPACES"),
    h("h1", {}, "The agent"),
    h(
      "p.intro",
      {},
      "The practice opponent you play when no one else is at the table. It has its own name, its own resolver and its own records, published as ENSIP-26 ",
      h("code", {}, "agent-context"),
      " and ",
      h("code", {}, "agent-endpoint[<protocol>]"),
      ", which only the agent itself may write. The game may write its ",
      h("code", {}, "stats"),
      ", as it may for any player, and nothing else.",
    ),
    h("div.card", {}, h("div.kind", {}, "agent"), h("a.cn", { href: `#/name/${name}` }, nameParts(name)), records),
    h("h2", {}, "WHAT IT MAY WRITE, AND WHAT THE GAME MAY WRITE TO IT"),
    roles,
    h("div.actions", {}, key("Inspect and try it", () => void go(`#/name/${name}`), true)),
  );
}
