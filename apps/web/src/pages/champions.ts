// Champions: each game's soulbound title, `champion.<game>.gamebox.eth`. Its holder (by name, from the address), the
// streak, start, round and expiry (Quick Draw's 15 minutes count down), the history of moves from `Crowned`, and
// "Report a match", which the demo Box signs with its software key.
import type { Address } from "viem";
import { fullName } from "@egb/shared/names";

import { reportWin } from "../actions.ts";
import { dir, render } from "../app.ts";
import { client } from "../chain.ts";
import { AGENT_LABEL, DEMO_BOX_LABEL, GAMES, STORY_GAME } from "../config.ts";
import type { Directory } from "../directory.ts";
import { type TitleView, boxLicensed, readTitle } from "../model.ts";
import { when } from "../time.ts";
import { TxFailed } from "../txs.ts";
import { addressLink, h, key, nameParts, short, tag, txLink } from "../ui/dom.ts";
import { countdownEl } from "../ui/live.ts";

const nameOf = (d: Directory, address: Address): string => {
  const label = d.labelOf.get(address.toLowerCase());
  return label ? fullName(label) : short(address);
};

function titleCard(d: Directory, t: TitleView): HTMLElement {
  const history = [...t.history].reverse().slice(0, 8);
  return h(
    "div.card",
    { "data-focus": `title title-${t.game}` },
    h("div.kind", {}, "title", tag("soulbound", "warn"), t.term < 3600n ? tag(`${Number(t.term) / 60}-minute term`) : tag(`${Number(t.term) / 86_400}-day term`)),
    h("a.cn", { href: `#/name/${t.name}` }, nameParts(t.name)),
    t.holder
      ? h(
          "dl",
          {},
          h("dt", {}, "holder"),
          h("dd", {}, h("span.p1t", {}, t.holderName ?? nameOf(d, t.holder)), " ", addressLink(t.holder)),
          h("dt", {}, "streak"),
          h("dd", {}, String(t.streak ?? "—")),
          h("dt", {}, "start"),
          h("dd", {}, t.start ? when(t.start) : "—"),
          h("dt", {}, "round"),
          h("dd", {}, t.round ?? "—"),
          h("dt", {}, "expires"),
          h("dd", {}, h("span.big", { style: "font-size:22px;margin:0" }, countdownEl(t.expiry))),
        )
      : h("p.expired-note", {}, t.history.length ? "Lapsed: no longer resolves. The next winner takes it." : "Never won yet."),
    history.length
      ? h(
          "ul.history",
          {},
          ...history.map((c) =>
            h(
              "li",
              {},
              h("span.r", {}, `round ${c.round}`),
              h("span", {}, h("b", { style: "color:var(--fg)" }, nameOf(d, c.winner)), c.previous !== "0x0000000000000000000000000000000000000000" ? ` took it from ${nameOf(d, c.previous)}` : c.streak > 1n ? ` kept it (streak ${c.streak})` : " was crowned"),
              txLink(c.hash),
            ),
          ),
        )
      : null,
  );
}

function reportPanel(d: Directory, licensed: boolean): HTMLElement {
  const players = [...d.players.values()].filter((p) => p.label !== AGENT_LABEL).sort((a, b) => Number(b.block - a.block));
  const options = () => players.map((p) => h("option", { value: p.label }, fullName(p.label)));
  const game = h("select", { "aria-label": "game" }, ...GAMES.map((g) => h("option", { value: g, selected: g === STORY_GAME }, g)));
  const winner = h("select", { "aria-label": "winner" }, ...options());
  const loser = h("select", { "aria-label": "loser" }, ...options());
  if (players[1]) loser.value = players[1].label;
  const blocked = reportBlocked(d, licensed);
  const hint = h(blocked ? "span.hint.bad" : "span.hint.wait", {}, blocked ?? "");
  const button = key("Report the match", () => void send(), true);
  button.disabled = blocked !== null;
  const send = async () => {
    const w = d.players.get(winner.value);
    const l = d.players.get(loser.value);
    if (!w || !l || w.label === l.label) {
      hint.className = "hint bad";
      hint.textContent = "pick two different players";
      return;
    }
    button.disabled = true;
    try {
      await reportWin(game.value, w, l);
      await render(true);
    } catch (err) {
      hint.className = "hint bad";
      hint.textContent = err instanceof TxFailed ? err.message : String(err);
      button.disabled = false;
    }
  };
  return h(
    "div.panel",
    { "data-focus": "report" },
    h("h3", {}, "REPORT A MATCH"),
    h(
      "p.labelled",
      {},
      h("b", {}, "The demo Box reports this result. "),
      `It is a Box Worker with a software P-256 key, licensed as ${fullName(DEMO_BOX_LABEL)}. At the event, the Box signs only after a real match on its table. A result in a game with an open championship scores it too.`,
    ),
    h("div.field", {}, h("label", {}, "game"), game),
    h("div.field", {}, h("label", {}, "winner"), winner, h("label", { style: "min-width:0" }, "beat"), loser),
    h("div.field", {}, button, hint),
  );
}

/** Why a match can't be reported yet, or null. */
function reportBlocked(d: Directory, licensed: boolean): string | null {
  if (!licensed) return `BoxResults takes results only from a Box with a live licence, and ${fullName(DEMO_BOX_LABEL)} isn't licensed yet. Reporting opens once it is.`;
  if ([...d.players.values()].filter((p) => p.label !== AGENT_LABEL).length < 2) return "A match needs two player names: claim one on the Players page first.";
  return null;
}

export async function championsPage(): Promise<HTMLElement> {
  const d = await dir();
  const [titles, licensed] = await Promise.all([Promise.all(GAMES.map((game) => readTitle(client, d, game))), boxLicensed(client, DEMO_BOX_LABEL)]);
  return h(
    "div",
    {},
    h("div.eyebrow", {}, "NON-TRANSFERABLE NAMES"),
    h("h1", {}, "Champions"),
    h("p.intro", {}, "Each game has its own title registry with one name in it. A win by someone else moves the title: the old token is unregistered and a new one is registered to the winner. Nobody can transfer it, and it lapses a term after the holder's last win."),
    h("div.cards", {}, ...titles.map((t) => titleCard(d, t))),
    reportPanel(d, licensed),
  );
}
