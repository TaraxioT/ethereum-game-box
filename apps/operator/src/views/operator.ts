// The operator view: every Box name this account operates, with its licence, standing and heartbeat, and a form for
// the four operator records. Saving writes every changed record in one `executeBatch`, under one passkey signature.
import { BOX_OPERATOR_KEYS } from "@egb/shared/names";

import { run } from "../account.ts";
import { type BoxView, boxLabels, gameLabels, readBox } from "../boxes.ts";
import { errorName } from "../errors.ts";
import { type OperatorKey, type OperatorRecords, changedKeys, checkRecords, recordCalls } from "../records.ts";
import { type Session, deployed } from "../session.ts";
import { nowSeconds, relative, utc } from "../time.ts";
import { TxFailed } from "../txs.ts";
import { addressLink, failed, field, h, reading, tag } from "../ui/dom.ts";

const FIELDS: Record<OperatorKey, { label: string; rule: string }> = {
  commission: { label: "Commission", rule: "Basis points of the Box's half: 1000 to 9000 (10% to 90%)." },
  location: { label: "Location", rule: "Where the Box stands. Up to 80 characters." },
  description: { label: "Description", rule: "One line for players. Up to 280 characters." },
  games: { label: "Games", rule: "The games it offers, comma-separated." },
};

const STATUS_TONE = { active: "ok", suspended: "warn", revoked: "bad" } as const;

export function operatorView(session: Session): HTMLElement {
  const list = h("div.boxes", {}, reading());
  const root = h(
    "section",
    {},
    h("p.eyebrow", {}, "OPERATOR"),
    h("h1", {}, "Your Boxes"),
    h(
      "p.lede",
      {},
      "Each Box name below is owned by your account. You write its four operator records; the registrar writes its ",
      h("code", {}, "status"),
      ", and the Box itself writes ",
      h("code", {}, "lastSeen"),
      " and ",
      h("code", {}, "game"),
      ".",
    ),
    list,
  );
  const account = session.account;
  if (!account) {
    list.replaceChildren(failed("Your account's address isn't known until P256AccountFactory is deployed."));
    return root;
  }
  void (async () => {
    try {
      const [labels, games] = await Promise.all([boxLabels(account), gameLabels()]);
      const boxes = (await Promise.all(labels.map((label) => readBox(label)))).filter(
        (box): box is BoxView => box !== null && box.operator === account,
      );
      if (boxes.length === 0) {
        list.replaceChildren(
          h("p.empty", {}, "No Box is licensed to this account yet. The admin registers one to ", addressLink(account, account), "."),
        );
        return;
      }
      list.replaceChildren(...boxes.map((box) => boxCard(box, games, session)));
    } catch (err) {
      list.replaceChildren(failed(`Couldn't read your Boxes: ${errorName(err)}`));
    }
  })();
  return root;
}

function boxCard(box: BoxView, games: readonly string[], session: Session, note = ""): HTMLElement {
  const now = nowSeconds();
  const expired = box.expiry <= now;
  const lastSeen = Number(box.records.lastSeen);
  const current: OperatorRecords = {
    commission: box.records.commission,
    location: box.records.location,
    description: box.records.description,
    games: box.records.games,
  };

  const inputs = {} as Record<OperatorKey, HTMLInputElement | HTMLTextAreaElement>;
  const hints = {} as Record<OperatorKey, HTMLSpanElement>;
  for (const key of BOX_OPERATOR_KEYS) {
    const attrs = { name: key, value: current[key], autocomplete: "off", spellcheck: key === "description" ? "true" : "false" };
    inputs[key] = key === "description" ? h("textarea", { name: key, rows: 2 }, current[key]) : h("input", { type: "text", ...attrs });
    hints[key] = h("span.hint", {}, FIELDS[key].rule);
  }
  inputs.commission.setAttribute("inputmode", "numeric");
  inputs.games.setAttribute("placeholder", games.join(","));

  const save = h("button.btn.lit", { type: "button", disabled: true }, "Save");
  const said = h(note ? "p.hint.ok" : "p.hint", { role: "status" }, note);

  const check = () => {
    const values = Object.fromEntries(BOX_OPERATOR_KEYS.map((key) => [key, inputs[key].value])) as OperatorRecords;
    const checked = checkRecords(values, games.length ? games : undefined);
    for (const key of BOX_OPERATOR_KEYS) {
      const problem = checked.problems[key];
      hints[key].className = problem ? "hint bad" : "hint";
      hints[key].textContent = problem ?? FIELDS[key].rule;
    }
    const keys = changedKeys(checked.values, current);
    const ok = Object.keys(checked.problems).length === 0;
    save.disabled = !ok || keys.length === 0;
    save.textContent = keys.length === 0 ? "Save" : `Save ${keys.length} change${keys.length === 1 ? "" : "s"}`;
    return { values: checked.values, keys, ok };
  };
  for (const key of BOX_OPERATOR_KEYS) inputs[key].addEventListener("input", check);

  const card = h(
    expired ? "article.card.dead" : "article.card",
    { "data-box": box.label },
    h(
      "div.meta",
      {},
      h("div.kind", {}, "BOX", tag(box.status, STATUS_TONE[box.status]), expired ? tag("licence expired", "bad") : null),
      h("span.cn", {}, box.label, h("span.p", {}, ".gamebox.eth")),
      h(
        "dl",
        {},
        h("dt", {}, "Licence"),
        h("dd", {}, utc(box.expiry), " · ", h(expired ? "b.bad" : "b", {}, expired ? `expired ${relative(box.expiry, now)}` : relative(box.expiry, now))),
        h("dt", {}, "Last seen"),
        h("dd", {}, Number.isFinite(lastSeen) && lastSeen > 0 ? relative(lastSeen, now) : "no heartbeat yet"),
        h("dt", {}, "Game"),
        h("dd.mono", {}, box.records.game || "none"),
        h("dt", {}, "Box account"),
        h("dd", {}, addressLink(box.account)),
        h("dt", {}, "Resolver"),
        h("dd", {}, addressLink(box.resolver)),
      ),
    ),
    h(
      "form.records",
      { onsubmit: (event: Event) => event.preventDefault() },
      ...BOX_OPERATOR_KEYS.map((key) => field(FIELDS[key].label, inputs[key], hints[key])),
      h("div.actions", {}, save, h("span.hint", {}, "One passkey signature for every change; the relayer pays.")),
      said,
    ),
  );

  save.addEventListener("click", async () => {
    const { values, keys, ok } = check();
    if (!ok || keys.length === 0 || !session.account) return;
    save.disabled = true;
    said.className = "hint wait";
    said.textContent = "Sign with your passkey…";
    try {
      const view = await run(session.passkey, session.account, "SAVE", `${box.name}: ${keys.join(", ")}`, {
        calls: recordCalls(box.resolver, box.label, values, keys),
      });
      said.className = "hint ok";
      said.textContent = "Saved on chain.";
      deployed();
      const fresh = await readBox(box.label, view.block ? BigInt(view.block) : undefined);
      if (fresh) card.replaceWith(boxCard(fresh, games, session, "Saved on chain."));
    } catch (err) {
      said.className = "hint bad";
      said.textContent = err instanceof TxFailed ? `Not saved: ${err.message}` : errorName(err);
      check();
    }
  });
  return card;
}
