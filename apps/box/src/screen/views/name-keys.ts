// The lobby's on-screen keyboard for typing a name: the characters a label may hold (0-9, a-z and -), a backspace, DONE
// and CLAIM. The Pi's own touch keyboard opens under the full-screen kiosk, where nobody can see it, so the Box draws its
// own. Its keys never take focus (a press is held back from the browser), so the name field keeps its caret.
import { el } from "../shell/dom.ts";

const ROWS = ["1234567890", "qwertyuiop", "asdfghjkl-", "zxcvbnm"] as const;

export interface NameKeysActions {
  /** A character to insert at the caret. */
  type(ch: string): void;
  /** Backspace. */
  erase(): void;
  claim(): void;
  /** Close the keyboard, keeping what was typed. */
  done(): void;
}

export interface NameKeys {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
  /** Whether CLAIM may be pressed (the name keeps the label rule and no claim is on its way). */
  claimable(on: boolean): void;
}

export function createNameKeys(actions: NameKeysActions): NameKeys {
  const root = el("div", "name-keys");
  root.hidden = true;
  const button = (label: string, kind: string, act: () => void): HTMLButtonElement => {
    const b = el("button", `name-key ${kind}`, label) as HTMLButtonElement;
    b.type = "button";
    b.tabIndex = -1;
    // Held back so the press never moves focus off the field (and with it the caret).
    b.addEventListener("pointerdown", (e) => e.preventDefault());
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", act);
    return b;
  };
  for (const [i, row] of ROWS.entries()) {
    const line = el("div", "name-keys-row");
    for (const ch of row) line.append(button(ch, "char", () => actions.type(ch)));
    if (i === ROWS.length - 1) line.append(button("⌫", "erase", actions.erase));
    root.append(line);
  }
  const claim = button("CLAIM", "go", actions.claim);
  const last = el("div", "name-keys-row");
  last.append(button("DONE", "done", actions.done), claim);
  root.append(last);
  // Nothing on the keyboard reaches the page under it.
  root.addEventListener("pointerdown", (e) => e.stopPropagation());

  return {
    el: root,
    open() {
      root.hidden = false;
    },
    close() {
      root.hidden = true;
    },
    claimable(on) {
      claim.disabled = !on;
    },
  };
}
