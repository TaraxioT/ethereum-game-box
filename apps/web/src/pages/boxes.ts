// Boxes: every Box licence and pop-up Box under gamebox.eth. Each shows its status, its licence counting down, when it
// was last seen, its current game and its operator's records. A pop-up is linked to its Box's record and shows the
// same values; once it lapses, `getEnsAddress` returns null and gamebox.eth's default record answers for it (wildcard).
// "Open a pop-up Box" asks the relayer for a 10-minute licence. The record watch shows the operator's `location` on
// mumbai-01 and its pop-ups, block by block.
import { BOX_KEYS, BOX_OPERATOR_KEYS, fullName } from "@egb/shared/names";

import { freshLabel, openPopup, popupAvailability } from "../actions.ts";
import { dir, render } from "../app.ts";
import { client } from "../chain.ts";
import { POPUP_BOX_LABEL } from "../config.ts";
import { type BoxView, boxLicensed, readBox } from "../model.ts";
import { TxFailed } from "../txs.ts";
import { addressLink, h, key, nameParts, tag } from "../ui/dom.ts";
import { agoEl, countdownEl } from "../ui/live.ts";
import { operatorSiteKey, recordWatch } from "../ui/watch-view.ts";

function statusTag(status: string | null): HTMLElement {
  return status === "active" ? tag("active", "ok") : status ? tag(status, "bad") : tag("none", "warn");
}

export function boxCard(box: BoxView): HTMLElement {
  const dead = box.resolves === null;
  const popup = box.ofBox !== null;
  const focus = [popup ? "popup" : "box", box.label === POPUP_BOX_LABEL ? "mumbai" : ""].join(" ");
  if (dead) {
    return h(
      "div.card.dead",
      { "data-focus": focus },
      h("div.kind", {}, popup ? "pop-up Box" : "Box"),
      h("a.cn", { href: `#/name/${box.name}` }, nameParts(box.name)),
      h("p.expired-note", { style: "margin:8px 0 0" }, popup ? "expired: no address, and gamebox.eth's default record answers (wildcard)" : "expired: no longer resolves"),
      h(
        "dl",
        {},
        h("dt", {}, "getEnsAddress"),
        h("dd.mono", {}, "null"),
        box.fallback ? h("dt", {}, "description") : null,
        box.fallback ? h("dd", {}, box.fallback.description ?? "—") : null,
        box.fallback ? h("dt", {}, "url") : null,
        box.fallback ? h("dd", {}, box.fallback.url ?? "—") : null,
        h("dt", {}, "licence ended"),
        h("dd", {}, countdownEl(box.expiry)),
      ),
    );
  }
  const operatorRecords = BOX_OPERATOR_KEYS.flatMap((k) => [h("dt", {}, k), h("dd", {}, box.records[k] ?? "—")]);
  return h(
    "div.card",
    { "data-focus": focus },
    h("div.kind", {}, popup ? "pop-up Box" : "Box", statusTag(box.status)),
    h("a.cn", { href: `#/name/${box.name}` }, nameParts(box.name)),
    popup ? h("p.linked", {}, "linked to ", h("a", { href: `#/name/${fullName(box.ofBox!)}` }, fullName(box.ofBox!)), "'s record: the same values") : null,
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

function popupPanel(licensed: boolean): HTMLElement {
  if (!licensed) {
    return h(
      "div.panel",
      { "data-focus": "popup" },
      h("h3", {}, "OPEN A POP-UP BOX"),
      h(
        "p",
        {},
        h("b", {}, fullName(POPUP_BOX_LABEL)),
        " isn't licensed yet: its operator registers it from the operator site with a passkey. A pop-up links to its record, so pop-ups open once it is. Until then, the name answers with ",
        h("b", {}, "gamebox.eth"),
        "'s default record, like any free name.",
      ),
      h("div.actions", {}, operatorSiteKey()),
    );
  }
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
    h(
      "p",
      {},
      "Anyone may open one. ",
      h("code", {}, "DemoLicences"),
      " registers it for 10 minutes and links it to ",
      h("b", {}, fullName(POPUP_BOX_LABEL)),
      "'s record, so it serves exactly the same records; the relayer pays the gas. Then it lapses: it has no address, and ",
      h("b", {}, "gamebox.eth"),
      "'s default record answers for it.",
    ),
    h("div.field", {}, h("span.suffix", {}, "popup-"), input, h("span.suffix", {}, ".gamebox.eth"), button, hint),
  );
}

export async function boxesPage(): Promise<HTMLElement> {
  const d = await dir();
  const entries = [...d.boxes.values(), ...d.popups.values()].sort((a, b) => Number(b.block - a.block));
  const [boxes, licensed] = await Promise.all([
    Promise.all(entries.slice(0, 12).map((entry) => readBox(client, entry.label))),
    boxLicensed(client, POPUP_BOX_LABEL),
  ]);
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
      " are written by the Box's own account; the operator writes its four keys on the operator site. A pop-up Box borrows its Box's record for 10 minutes.",
    ),
    popupPanel(licensed),
    recordWatch(POPUP_BOX_LABEL, BOX_KEYS.location),
    h("h2", {}, "EVERY LICENCE"),
    boxes.length ? h("div.cards", {}, ...boxes.map(boxCard)) : h("p", {}, "No Box licences yet."),
  );
}
