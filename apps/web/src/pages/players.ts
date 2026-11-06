// Players: every player name, with its address, its `stats` and the title it holds. "Claim a name": pick a badge (a
// wallet, or a test badge made in this browser), type a label (checked as you type), sign `ClaimName`, and the
// relayer sends it. Afterwards the badge sees what it controls and can take `stats` away from the game.
import { fullName } from "@egb/shared/names";

import { availability, claim, freshLabel } from "../actions.ts";
import { dir, go, render, state } from "../app.ts";
import { connectWallet, hasInjectedWallet, newTestBadge } from "../badge.ts";
import { client } from "../chain.ts";
import { AGENT_LABEL } from "../config.ts";
import { type PlayerView, readHolders, readPlayer } from "../model.ts";
import { TxFailed } from "../txs.ts";
import { addressLink, append, h, key, nameParts, tag } from "../ui/dom.ts";

export function statsLine(view: PlayerView): string {
  if (!view.stats) return view.statsText ?? "no games yet";
  return Object.entries(view.stats)
    .map(([game, s]) => `${game} ${s.wins}W ${s.losses}L${s.draws ? ` ${s.draws}D` : ""}`)
    .join(" · ");
}

function playerCard(view: PlayerView): HTMLElement {
  const mine = state.badge && view.badge.toLowerCase() === state.badge.address.toLowerCase();
  return h(
    "div.card",
    { "data-focus": `player${view.label === state.story.label ? " story-player" : ""}` },
    h("div.kind", {}, "player", tag("never expires"), mine ? h("span.testmark", {}, state.badge?.kind === "test" ? "your test badge" : "your wallet") : null),
    h("a.cn", { href: `#/name/${view.name}` }, nameParts(view.name)),
    h(
      "dl",
      {},
      h("dt", {}, "addr"),
      h("dd", {}, view.resolves ? addressLink(view.resolves) : h("span.bad", {}, "null")),
      h("dt", {}, "primary name"),
      h("dd", {}, view.primary ?? h("span", { style: "color:var(--fg-3)" }, "none set")),
      h("dt", {}, "stats"),
      h("dd", {}, statsLine(view)),
      h("dt", {}, "title"),
      h("dd", {}, view.titles.length ? h("span.p1t", {}, view.titles.map((g) => `champion.${g}`).join(", ")) : "—"),
    ),
  );
}

/** The badge picker and the claim form. */
function claimPanel(): HTMLElement {
  const panel = h("div.panel", { "data-focus": "claim" });
  const draw = () => {
    panel.replaceChildren(h("h3", {}, "CLAIM A NAME"));
    const badge = state.badge;
    const pick = h(
      "div.badge-line",
      {},
      badge
        ? h(
            "span",
            {},
            badge.kind === "test" ? h("span.testmark", {}, "test badge") : h("span.tag.sys", {}, "wallet"),
            " ",
            addressLink(badge.address),
          )
        : h("span", {}, "First, a badge: anything that signs EIP-712 stands in for the HaLo chip."),
      key(badge ? "New test badge" : "Make a test badge", () => {
        state.badge = newTestBadge();
        draw();
      }),
      hasInjectedWallet() ? key("Connect a wallet", () => void connectWallet().then((b) => ((state.badge = b), draw())).catch((err) => alert(String(err)))) : null,
    );
    append(panel, pick);
    if (badge?.kind === "test") {
      append(panel, h("p.labelled", {}, h("b", {}, "Test badge. "), "A key made in this browser and kept in its localStorage, so it's only as safe as this browser. It holds no ETH; claiming needs none."));
    }
    if (!badge) return;

    const input = h("input", { type: "text", value: freshLabel("judge"), maxlength: 32, "aria-label": "label", spellcheck: "false", autocomplete: "off" });
    const hint = h("span.hint.wait", {}, "");
    const button = key("Sign and claim", () => void submit(), true);
    let checking = 0;
    const check = async () => {
      const id = ++checking;
      const label = input.value.trim();
      hint.className = "hint wait";
      hint.textContent = "checking…";
      button.disabled = true;
      const free = await availability(label).catch(() => ({ free: false as const, why: "couldn't check" }));
      if (id !== checking) return;
      hint.className = free.free ? "hint ok" : "hint bad";
      hint.textContent = free.free ? "free" : free.why;
      button.disabled = !free.free;
    };
    const submit = async () => {
      button.disabled = true;
      const label = input.value.trim();
      try {
        hint.className = "hint wait";
        hint.textContent = "sign with the badge…";
        await claim(badge, label);
        await go(`#/name/${fullName(label)}`);
      } catch (err) {
        hint.className = "hint bad";
        hint.textContent = err instanceof TxFailed ? err.message : err instanceof Error ? err.message.split("\n")[0]! : String(err);
        button.disabled = false;
      }
    };
    input.addEventListener("input", () => void check());
    append(
      panel,
      h("p", {}, "The badge signs ", h("code", {}, "ClaimName"), " (EIP-712); the relayer sends it and pays the gas. The name never expires, and the badge holds every role on its own resolver."),
      h("div.field", {}, input, h("span.suffix", {}, ".gamebox.eth"), button, hint),
    );
    void check();
  };
  draw();
  return panel;
}

export async function playersPage(): Promise<HTMLElement> {
  const d = await dir();
  const holders = await readHolders(client);
  const labels = [...d.players.values()].filter((p) => p.label !== AGENT_LABEL).sort((a, b) => Number(b.block - a.block)).map((p) => p.label);
  const views = await Promise.all(labels.slice(0, 18).map((label) => readPlayer(client, d, label, holders)));
  const mine = state.badge ? (d.labelOf.get(state.badge.address.toLowerCase()) ?? null) : null;
  return h(
    "div",
    {},
    h("div.eyebrow", {}, "FOREVER NAMES WITH NO PARENT CONTROL"),
    h("h1", {}, "Players"),
    h("p.intro", {}, "A player name belongs to a badge, forever. Its registry is emancipated and its resolver is the badge's alone; the game was granted one key, ", h("code", {}, "stats"), ", and the badge can take that back."),
    mine
      ? h("div.callout.sys", {}, h("span", {}, "Your badge holds ", h("b", {}, fullName(mine)), ". One name per badge."), key("Inspect it", () => void go(`#/name/${fullName(mine)}`), true))
      : claimPanel(),
    mine ? h("div.actions", {}, key("Use a new test badge", () => ((state.badge = newTestBadge()), void render()))) : null,
    h("h2", {}, "EVERY PLAYER"),
    views.length ? h("div.cards", {}, ...views.map(playerCard)) : h("p", {}, "No players yet."),
  );
}
