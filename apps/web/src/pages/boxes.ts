// Boxes: every Box licence under gamebox.eth. Each shows its status, its licence counting down, when it was last
// seen, its current game and its operator's records. A lapsed pop-up reads "expired: no longer resolves", because
// `getEnsAddress` returned null for it. "Open a pop-up Box" asks the relayer for a 10-minute licence.
import { BOX_OPERATOR_KEYS } from "@egb/shared/names";

import { freshLabel, openPopup, popupAvailability } from "../actions.ts";
import { dir, render, state } from "../app.ts";
import { client } from "../chain.ts";
import { type BoxView, readBox } from "../model.ts";
import { TxFailed } from "../txs.ts";
import { addressLink, h, key, nameParts, tag } from "../ui/dom.ts";
import { agoEl, countdownEl } from "../ui/live.ts";

function statusTag(status: string | null): HTMLElement {
  return status === "active" ? tag("active", "ok") : status ? tag(status, "bad") : tag("none", "warn");
}

export function boxCard(box: BoxView): HTMLElement {
  const dead = box.resolves === null;
  const focus = [box.popup ? "popup" : "box", box.label === state.story.popup ? "story-popup" : "", box.label === "mumbai-01" ? "mumbai" : ""].join(" ");
  if (dead) {
    return h(
      "div.card.dead",
      { "data-focus": focus },
      h("div.kind", {}, box.popup ? "pop-up Box" : "Box"),
      h("a.cn", { href: `#/name/${box.name}` }, nameParts(box.name)),
      h("p.expired-note", { style: "margin:8px 0 0" }, "expired: no longer resolves"),
      h("dl", {}, h("dt", {}, "getEnsAddress"), h("dd.mono", {}, "null"), h("dt", {}, "licence ended"), h("dd", {}, countdownEl(box.expiry))),
    );
  }
  const operatorRecords = BOX_OPERATOR_KEYS.flatMap((k) => [h("dt", {}, k), h("dd", {}, box.records[k] ?? "—")]);
  return h(
    "div.card",
    { "data-focus": focus },
    h("div.kind", {}, box.popup ? "pop-up Box" : "Box", statusTag(box.status)),
    h("a.cn", { href: `#/name/${box.name}` }, nameParts(box.name)),
    h("span.big", {}, countdownEl(box.expiry)),
    h(
      "dl",
      {},
      h("dt", {}, "status"),
      h("dd", {}, box.status ?? "—", h("span.hint", { style: "color:var(--fg-3)" }, " · GameBoxNames alone")),
      h("dt", {}, "lastSeen"),
      h("dd", {}, box.lastSeen ? agoEl(box.lastSeen) : "never", h("span.hint", { style: "color:var(--fg-3)" }, " · the Box")),
      h("dt", {}, "game"),
      h("dd", {}, box.game ?? "—"),
      ...operatorRecords,
      h("dt", {}, "operator"),
      h("dd", {}, addressLink(box.operator)),
      h("dt", {}, "Box account"),
      h("dd", {}, addressLink(box.account)),
    ),
  );
}

function popupPanel(): HTMLElement {
  const input = h("input", { type: "text", value: freshLabel("demo").replace("demo-", ""), maxlength: 26, "aria-label": "pop-up label", spellcheck: "false", autocomplete: "off" });
  const hint = h("span.hint.wait", {}, "");
  const check = async () => {
    const label = input.value.trim();
    hint.className = "hint wait";
    hint.textContent = "checking…";
    const free = await popupAvailability(label).catch(() => ({ free: false as const, why: "couldn't check" }));
    if (input.value.trim() !== label) return;
    hint.className = free.free ? "hint ok" : "hint bad";
    hint.textContent = free.free ? "free" : free.why;
    button.disabled = !free.free;
  };
  input.addEventListener("input", () => void check());
  const button = key("Open a pop-up Box", () => void open(), true);
  const open = async () => {
    button.disabled = true;
    const label = input.value.trim();
    try {
      await openPopup(label);
      state.story.popup = `popup-${label}`;
      await render(true);
    } catch (err) {
      hint.className = "hint bad";
      hint.textContent = err instanceof TxFailed ? err.message : String(err);
      button.disabled = false;
    }
  };
  void check();
  return h(
    "div.panel",
    {},
    h("h3", {}, "OPEN A POP-UP BOX"),
    h("p", {}, "Anyone may open one. ", h("code", {}, "DemoLicences"), " registers it to the demo Box for 10 minutes; the relayer pays the gas. Then it lapses, and from that block on it no longer resolves."),
    h("div.field", {}, h("span.suffix", {}, "popup-"), input, h("span.suffix", {}, ".gamebox.eth"), button, hint),
  );
}

export async function boxesPage(): Promise<HTMLElement> {
  const d = await dir();
  const labels = [...d.boxes.values()].sort((a, b) => Number(b.block - a.block)).map((b) => b.label);
  const boxes = await Promise.all(labels.slice(0, 12).map((label) => readBox(client, label)));
  // Live licences first, then the lapsed, each newest first.
  boxes.sort((a, b) => Number(a.resolves === null) - Number(b.resolves === null));
  return h(
    "div",
    {},
    h("div.eyebrow", {}, "EXPIRING NAMES · REVOCABLE NAMES"),
    h("h1", {}, "Boxes"),
    h(
      "p.intro",
      {},
      "A Box's name is its licence: it expires when the licence does. Its ",
      h("code", {}, "status"),
      " is written by the registrar alone, so a licence can be suspended or revoked; ",
      h("code", {}, "lastSeen"),
      " and ",
      h("code", {}, "game"),
      " are written by the Box's own account; the operator writes its four keys.",
    ),
    popupPanel(),
    h("h2", {}, "EVERY LICENCE"),
    boxes.length ? h("div.cards", {}, ...boxes.map(boxCard)) : h("p", {}, "No Box licences yet."),
  );
}
