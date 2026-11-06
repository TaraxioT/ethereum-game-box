// The operator site: the Sepolia tag, the transaction strip, and one view at a time: sign in, your Boxes, or (for a
// licensor) the admin view.
import "./operator.css";

import { watchHead } from "./chain.ts";
import { current, onSession, resume } from "./session.ts";
import { mountChainTag, mountTxStrip } from "./ui/chrome.ts";
import { failed, h, reading } from "./ui/dom.ts";
import { accountView } from "./views/account.ts";
import { adminView } from "./views/admin.ts";
import { operatorView } from "./views/operator.ts";
import { signInView } from "./views/signin.ts";

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing`);
  return el;
};

const page = byId("page");
const nav = byId("nav");
/** The account strip, redrawn on its own when the account changes under the same passkey. */
const account = h("div");

function render(): void {
  const session = current();
  const route = location.hash.replace(/^#\/?/, "");
  nav.replaceChildren(
    ...(session
      ? [
          h("a", { href: "#/", class: route === "" ? "on" : "" }, "Boxes"),
          session.licensor ? h("a", { href: "#/admin", class: route === "admin" ? "on" : "" }, "Admin") : null,
        ].filter((a): a is HTMLAnchorElement => a !== null)
      : []),
  );
  if (!session) {
    page.replaceChildren(signInView());
    return;
  }
  const view = route === "admin" && session.licensor ? adminView(session) : operatorView(session);
  account.replaceChildren(accountView(session));
  page.replaceChildren(account, view);
}


watchHead();
mountChainTag(byId("chain"));
mountTxStrip(byId("txs"));
onSession((change) => {
  const session = current();
  if (change === "account" && session) account.replaceChildren(accountView(session));
  else render();
});
window.addEventListener("hashchange", render);

page.replaceChildren(reading());
resume()
  .catch((err: unknown) => page.replaceChildren(failed(`Couldn't read your account: ${String(err)}`)))
  .finally(() => {
    if (!current()) render();
  });
