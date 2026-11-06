// The signed-in account: its address (from `accountOf`, before and after it exists), the passkey's public key, and
// what the account may do.
import { boxKeyText } from "../p256.ts";
import { type Session, close } from "../session.ts";
import { addressLink, h, short } from "../ui/dom.ts";

export function accountView(session: Session): HTMLElement {
  const { account, deployed, licensor, passkey } = session;
  const out = h("button.btn.out", { type: "button" }, "Sign out");
  out.addEventListener("click", close);
  const publicKey = boxKeyText(passkey);
  const copy = h("button.copy", { type: "button", title: "Copy the public key (0x04 + x + y)" }, "copy");
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(publicKey).then(() => {
      copy.textContent = "copied";
    });
  });
  return h(
    "section.account",
    {},
    h(
      "dl.dl",
      {},
      h(
        "div",
        { "data-account": account ?? "" },
        h("dt", {}, "Account"),
        h(
          "dd",
          {},
          account ? addressLink(account) : "not known yet",
          h(
            "small",
            {},
            !account
              ? "P256AccountFactory isn't deployed yet."
              : deployed
                ? "A P256Account on Sepolia."
                : "Not deployed yet: your first change deploys it, free.",
          ),
        ),
      ),
      h(
        "div",
        {},
        h("dt", {}, "Passkey"),
        h("dd.mono", { title: publicKey }, short(publicKey), " ", copy, h("small", {}, `credential ${short(passkey.id)}`)),
      ),
      h(
        "div",
        {},
        h("dt", {}, "May"),
        h("dd", {}, licensor ? "operate and license Boxes" : "operate its Boxes", h("small", {}, licensor ? "LICENSOR_ROLE on GameBoxNames" : "the four operator records")),
      ),
    ),
    h("div.actions", {}, out),
  );
}
