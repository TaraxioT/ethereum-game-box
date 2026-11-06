// Signed out: make a passkey, or sign in with one. Either way the site keeps only its public key and credential id.
import type { P256PublicKey } from "@egb/shared/names";

import { accountOf, isDeployed } from "../account.ts";
import { factory } from "../chain.ts";
import { errorName } from "../errors.ts";
import { type SignIn, confirmSignIn, createPasskey, signIn } from "../passkey.ts";
import { open } from "../session.ts";
import { field, h } from "../ui/dom.ts";

/** Of the keys a signature could be from, the one whose account exists (if exactly one does). */
async function deployedOne(keys: P256PublicKey[]): Promise<P256PublicKey | null> {
  const live = await Promise.all(
    keys.map(async (key) => {
      const account = await accountOf(key);
      return account ? isDeployed(account) : false;
    }),
  );
  return live.filter(Boolean).length === 1 ? keys[live.indexOf(true)]! : null;
}

export function signInView(): HTMLElement {
  if (!window.PublicKeyCredential) {
    return h("section", {}, h("h1", {}, "This browser has no passkeys."), h("p.failed", {}, "Open the operator site in a browser with WebAuthn."));
  }

  const status = h("p.hint", { role: "status" });
  const say = (text: string, tone: "ok" | "bad" | "wait" = "wait") => {
    status.className = `hint ${tone}`;
    status.textContent = text;
  };

  const name = h("input", { type: "text", value: "Game Box operator", maxlength: 64, autocomplete: "off", spellcheck: "false" });
  const create = h("button.btn.lit", { type: "button" }, "Create a passkey");
  const login = h("button.btn.out", { type: "button" }, "Sign in with a passkey");
  const confirm = h("div.confirm");
  const busy = (on: boolean) => {
    create.disabled = on;
    login.disabled = on;
  };

  create.addEventListener("click", async () => {
    const label = name.value.trim();
    if (!label) return say("Give the passkey a name, so you can find it later.", "bad");
    busy(true);
    say("Waiting for your passkey…");
    try {
      await open(await createPasskey(label));
    } catch (err) {
      say(errorName(err), "bad");
      busy(false);
    }
  });

  const finish = async (outcome: SignIn) => {
    if ("passkey" in outcome) return open(outcome.passkey);
    say("This device hasn't seen that passkey before. Sign once more, so the site can tell its key apart.");
    const again = h("button.btn.lit", { type: "button" }, "Sign once more");
    again.addEventListener("click", async () => {
      again.disabled = true;
      try {
        await open(await confirmSignIn(outcome.id, outcome.candidates));
      } catch (err) {
        say(errorName(err), "bad");
        again.disabled = false;
      }
    });
    confirm.replaceChildren(again);
  };

  login.addEventListener("click", async () => {
    busy(true);
    say("Waiting for your passkey…");
    try {
      await finish(await signIn(deployedOne));
    } catch (err) {
      say(errorName(err), "bad");
    }
    busy(false);
  });

  return h(
    "section",
    {},
    h("p.eyebrow", {}, "OPERATOR SITE · SEPOLIA"),
    h("h1", {}, "Run your Box from a passkey."),
    h(
      "p.intro",
      {},
      "Your passkey is a P-256 key that never leaves this device. It controls a ",
      h("b", {}, "P256Account"),
      " on Sepolia, and that account owns your Box's name under ",
      h("code", {}, "gamebox.eth"),
      ". You sign each change with the passkey; the relayer pays the gas. No wallet, no ETH.",
    ),
    factory()
      ? null
      : h(
          "p.callout",
          {},
          "P256AccountFactory isn't in deployments/sepolia.json yet, so the account's address can't be shown. ",
          "Your passkey's public key is kept here, and the address appears once the factory is deployed.",
        ),
    h(
      "div.split",
      {},
      h(
        "div.panel",
        {},
        h("h3", {}, "NEW PASSKEY"),
        h("p", {}, "Makes a passkey for this site on this device (or your password manager), with your fingerprint, face or PIN."),
        field("Name", name, h("span.hint", {}, "How the passkey shows in your password manager.")),
        h("div.actions", {}, create),
      ),
      h(
        "div.panel",
        {},
        h("h3", {}, "SIGN IN"),
        h("p", {}, "Already made one? Sign with it. On a new device the site may ask twice, to find its public key."),
        h("div.actions", {}, login),
        confirm,
      ),
    ),
    status,
  );
}
