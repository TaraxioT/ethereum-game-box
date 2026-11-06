// The admin view, shown only to an account holding `LICENSOR_ROLE` on `GameBoxNames`: every Box licence, and the four
// licence actions. Each is one `execute` signed by the passkey. A new or rotated Box key's account is deployed after.
import type { Address } from "viem";
import { BOX_STATUS, type BoxStatus, type Call, type P256PublicKey } from "@egb/shared/names";

import { accountOf, ensureDeployed, run } from "../account.ts";
import {
  type LicenceForm,
  checkDays,
  checkLicence,
  registerCall,
  renewCall,
  renewedExpiry,
  rotateCall,
  statusCall,
} from "../admin.ts";
import { type BoxView, boxLabels, readBox } from "../boxes.ts";
import { gameBoxNames } from "../chain.ts";
import { errorName } from "../errors.ts";
import { parseBoxKey } from "../p256.ts";
import { type Session, deployed } from "../session.ts";
import { nowSeconds, relative, utc } from "../time.ts";
import { TxFailed } from "../txs.ts";
import { addressLink, failed, field, h, reading, tag } from "../ui/dom.ts";

const STATUS_TONE = { active: "ok", suspended: "warn", revoked: "bad" } as const;

type Say = (text: string, tone?: "ok" | "bad" | "wait") => void;

function status(): [HTMLParagraphElement, Say] {
  const el = h("p.hint", { role: "status" });
  return [
    el,
    (text, tone = "wait") => {
      el.className = `hint ${tone}`;
      el.textContent = text;
    },
  ];
}

const input = (name: string, placeholder = "") =>
  h("input", { type: "text", name, placeholder, autocomplete: "off", spellcheck: "false" });

/** Watches a Box-key input: as it is typed, reads the key's account, so a click can sign at once (a passkey prompt
 *  must follow the click without waiting on the network). */
function keyWatcher(el: HTMLInputElement, hint: HTMLSpanElement, rule: string): () => { key: P256PublicKey; account: Address } | string {
  let ready: { text: string; key: P256PublicKey; account: Address } | null = null;
  let pending = "";
  el.addEventListener("input", async () => {
    const text = el.value;
    const key = parseBoxKey(text);
    ready = null;
    pending = text;
    hint.className = "hint";
    hint.textContent = key ? "Reading its account…" : rule;
    if (!key) return;
    const account = await accountOf(key).catch(() => null);
    if (pending !== text) return;
    if (account) ready = { text, key, account };
    hint.className = account ? "hint ok" : "hint bad";
    hint.textContent = account ? `Its account: ${account}` : "Couldn't read its account from P256AccountFactory.";
  });
  return () => {
    if (ready && ready.text === el.value) return ready;
    return parseBoxKey(el.value) ? "Its account is still being read." : "a P-256 public key: 0x04 + x + y (65 bytes of hex)";
  };
}

function boxSelect(boxes: readonly BoxView[]): HTMLSelectElement {
  return h("select", { name: "box" }, ...boxes.map((box) => h("option", { value: box.label }, box.label)));
}

export function adminView(session: Session): HTMLElement {
  const body = h("div", {}, reading());
  const root = h(
    "section",
    {},
    h("p.eyebrow", {}, "ADMIN · LICENSOR_ROLE"),
    h("h1", {}, "Box licences"),
    h(
      "p.lede",
      {},
      "A Box's name lives as long as its licence. Register gives the operator the name and the Box its own account; ",
      "the status decides whether the Box may referee; rotating moves a lost Box to a new key.",
    ),
    body,
  );
  const names = gameBoxNames();
  if (!session.licensor || !session.account || !names) {
    body.replaceChildren(failed("This account doesn't hold LICENSOR_ROLE on GameBoxNames."));
    return root;
  }
  const load = async () => {
    try {
      const boxes = (await Promise.all((await boxLabels()).map((label) => readBox(label)))).filter((b): b is BoxView => b !== null);
      body.replaceChildren(
        table(boxes),
        registerPanel(session, names.address, boxes, load),
        ...(boxes.length ? [renewPanel(session, names.address, boxes, load), statusPanel(session, names.address, boxes, load), rotatePanel(session, names.address, boxes, load)] : []),
      );
    } catch (err) {
      body.replaceChildren(failed(`Couldn't read the licences: ${errorName(err)}`));
    }
  };
  void load();
  return root;
}

function table(boxes: readonly BoxView[]): HTMLElement {
  const now = nowSeconds();
  if (boxes.length === 0) return h("p.empty", {}, "No Box is licensed yet.");
  return h(
    "div.scroll",
    {},
    h(
      "table.roles",
      {},
      h("thead", {}, h("tr", {}, h("th", {}, "Box"), h("th", {}, "Status"), h("th", {}, "Licence"), h("th", {}, "Operator"), h("th", {}, "Box account"))),
      h(
        "tbody",
        {},
        ...boxes.map((box) =>
          h(
            "tr",
            { "data-box": box.label },
            h("td.mono", {}, box.label),
            h("td", {}, tag(box.status, STATUS_TONE[box.status])),
            h("td", {}, utc(box.expiry), h("small", {}, box.expiry <= now ? `expired ${relative(box.expiry, now)}` : relative(box.expiry, now))),
            h("td", {}, addressLink(box.operator)),
            h("td", {}, addressLink(box.account)),
          ),
        ),
      ),
    ),
  );
}

/** Runs one licence action from the admin's account, then (for a new key) deploys the Box's account. */
async function act(
  session: Session,
  say: Say,
  kind: string,
  subject: string,
  call: Call,
  after?: { key: P256PublicKey; account: Address; label: string },
): Promise<boolean> {
  say("Sign with your passkey…");
  try {
    await run(session.passkey, session.account!, kind, subject, { call });
    deployed();
    if (after) await ensureDeployed(after.key, after.account, `${after.label}'s Box account`);
    say("Done on chain.", "ok");
    return true;
  } catch (err) {
    say(err instanceof TxFailed ? `Stopped: ${err.message}` : errorName(err), "bad");
    return false;
  }
}

function panel(title: string, text: string, ...children: (Node | null)[]): HTMLElement {
  return h("div.panel", {}, h("h3", {}, title), h("p", {}, text), ...children);
}

function registerPanel(session: Session, names: Address, boxes: readonly BoxView[], reload: () => Promise<void>): HTMLElement {
  const fields = { label: input("label", "mumbai-01"), operator: input("operator", "0x… the operator's account"), boxKey: input("boxKey", "0x04… the Box's P-256 key"), days: input("days") };
  fields.days.value = "30";
  const rules: Record<keyof LicenceForm, string> = {
    label: "3 to 32 of a-z, 0-9 and -.",
    operator: "The operator's account address (from their passkey, on this site).",
    boxKey: "The Box's public key, 0x04 + x + y. Its account is accountOf(x, y).",
    days: "The licence term.",
  };
  const hints = Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, h("span.hint", {}, v)])) as Record<keyof LicenceForm, HTMLSpanElement>;
  const boxAccount = keyWatcher(fields.boxKey, hints.boxKey, rules.boxKey);
  const go = h("button.btn.lit", { type: "button" }, "Register");
  const [said, say] = status();
  go.addEventListener("click", async () => {
    const form = Object.fromEntries(Object.entries(fields).map(([k, el]) => [k, el.value])) as unknown as LicenceForm;
    const { licence, problems } = checkLicence(form, nowSeconds());
    for (const key of ["label", "operator", "days"] as const) {
      hints[key].className = problems[key] ? "hint bad" : "hint";
      hints[key].textContent = problems[key] ?? rules[key];
    }
    const ready = boxAccount();
    if (typeof ready === "string") {
      hints.boxKey.className = "hint bad";
      hints.boxKey.textContent = ready;
    }
    if (!licence || typeof ready === "string") return;
    const held = boxes.find((box) => box.label === licence.label);
    if (held && held.expiry > nowSeconds()) {
      hints.label.className = "hint bad";
      hints.label.textContent = "That Box is already licensed: renew it instead.";
      return;
    }
    const { account } = ready;
    go.disabled = true;
    const call = registerCall(names, licence, account);
    if (await act(session, say, "REGISTER", `${licence.label}.gamebox.eth → ${licence.operator}`, call, { key: licence.key, account, label: licence.label })) {
      await reload();
    }
    go.disabled = false;
  });
  return panel(
    "REGISTER A BOX",
    "Issues a licence: the name goes to the operator, its own resolver is made, and the Box's account may write lastSeen and game.",
    field("Label", fields.label, hints.label),
    field("Operator", fields.operator, hints.operator),
    field("Box key", fields.boxKey, hints.boxKey),
    field("Days", fields.days, hints.days),
    h("div.actions", {}, go),
    said,
  );
}

function renewPanel(session: Session, names: Address, boxes: readonly BoxView[], reload: () => Promise<void>): HTMLElement {
  const box = boxSelect(boxes);
  const days = input("days");
  days.value = "30";
  const hint = h("span.hint", {}, "Days past the later of now and the current expiry.");
  const go = h("button.btn.lit", { type: "button" }, "Renew");
  const [said, say] = status();
  go.addEventListener("click", async () => {
    const chosen = boxes.find((b) => b.label === box.value);
    const term = checkDays(days.value);
    if ("problem" in term) {
      hint.className = "hint bad";
      hint.textContent = term.problem;
      return;
    }
    if (!chosen) return;
    const expiry = renewedExpiry(chosen.expiry, nowSeconds(), term.days);
    go.disabled = true;
    if (await act(session, say, "RENEW", `${chosen.name} until ${utc(Number(expiry))}`, renewCall(names, chosen.label, expiry))) await reload();
    go.disabled = false;
  });
  return panel("RENEW", "Moves a licence's expiry later. It never shortens one, and it revives a lapsed Box with its old owner and roles.", field("Box", box, h("span.hint", {})), field("Days", days, hint), h("div.actions", {}, go), said);
}

function statusPanel(session: Session, names: Address, boxes: readonly BoxView[], reload: () => Promise<void>): HTMLElement {
  const box = boxSelect(boxes);
  const choice = h("select", { name: "status" }, ...BOX_STATUS.map((s) => h("option", { value: s }, s)));
  const go = h("button.btn.lit", { type: "button" }, "Set status");
  const [said, say] = status();
  go.addEventListener("click", async () => {
    const chosen = boxes.find((b) => b.label === box.value);
    if (!chosen) return;
    const value = choice.value as BoxStatus;
    go.disabled = true;
    if (await act(session, say, "STATUS", `${chosen.name}: ${value}`, statusCall(names, chosen.label, value))) await reload();
    go.disabled = false;
  });
  return panel("STATUS", "A suspended or revoked Box is refused as a referee. GameBoxNames writes the status record; nobody else can.", field("Box", box, h("span.hint", {})), field("Status", choice, h("span.hint", {})), h("div.actions", {}, go), said);
}

function rotatePanel(session: Session, names: Address, boxes: readonly BoxView[], reload: () => Promise<void>): HTMLElement {
  const box = boxSelect(boxes);
  const key = input("boxKey", "0x04… the new P-256 key");
  const rule = "The new key, 0x04 + x + y. The name's addr, lastSeen and game move to its account.";
  const hint = h("span.hint", {}, rule);
  const newAccount = keyWatcher(key, hint, rule);
  const go = h("button.btn.bad", { type: "button" }, "Rotate key");
  const [said, say] = status();
  go.addEventListener("click", async () => {
    const chosen = boxes.find((b) => b.label === box.value);
    const ready = newAccount();
    if (typeof ready === "string") {
      hint.className = "hint bad";
      hint.textContent = ready;
    }
    if (!chosen || typeof ready === "string") return;
    const { key: parsed, account } = ready;
    go.disabled = true;
    if (await act(session, say, "ROTATE", `${chosen.name} → ${account}`, rotateCall(names, chosen.label, parsed, account), { key: parsed, account, label: chosen.label })) {
      await reload();
    }
    go.disabled = false;
  });
  return panel("ROTATE KEY", "For a lost or broken Box. The old key stops working for results and the relayer at once.", field("Box", box, h("span.hint", {})), field("New key", key, hint), h("div.actions", {}, go), said);
}
