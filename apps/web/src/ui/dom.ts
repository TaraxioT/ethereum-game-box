// A small element builder, and the links and short forms every page uses.
import type { Address, Hash } from "viem";

import { ETHERSCAN } from "../config.ts";

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | ((event: Event) => void)>;

/** `h("a.res", { href }, "text")`: a tag with optional classes after dots, attributes (`on*` are listeners), children. */
export function h<K extends keyof HTMLElementTagNameMap>(spec: K | `${K}.${string}`, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = spec.split(".") as [K, ...string[]];
  const el = document.createElement(tag);
  if (classes.length) el.className = classes.join(" ");
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(name.replace(/^on/, ""), value);
    else if (name === "class") el.className = [el.className, value].filter(Boolean).join(" ");
    else el.setAttribute(name, value === true ? "" : String(value));
  }
  append(el, ...children);
  return el;
}

export function append(el: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
  }
}

/** `0x8e4f…12ab`. */
export function short(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

/** An address, linked to Etherscan. */
export function addressLink(address: Address, text: string = short(address)): HTMLAnchorElement {
  return h("a.ext.mono", { href: `${ETHERSCAN}/address/${address}`, target: "_blank", rel: "noopener" }, `${text} ↗`);
}

/** A transaction hash, linked to Etherscan. */
export function txLink(hash: Hash): HTMLAnchorElement {
  return h("a.ext.mono", { href: `${ETHERSCAN}/tx/${hash}`, target: "_blank", rel: "noopener" }, `${short(hash)} ↗`);
}

/** A link into the site: the inspector for a name. */
export function nameLink(name: string, text: string = name): HTMLAnchorElement {
  return h("a.nm", { href: `#/name/${name}` }, text);
}

/** A full name with its parent dimmed: `nova` + `.gamebox.eth`, as one inline element. */
export function nameParts(name: string): HTMLSpanElement {
  const dot = name.indexOf(".");
  return h("span", {}, dot < 0 ? name : name.slice(0, dot), dot < 0 ? null : h("span.p", {}, name.slice(dot)));
}

/** A tag in a word: `active`, `never expires`. */
export function tag(text: string, tone: "ok" | "warn" | "bad" | "sys" = "sys"): HTMLSpanElement {
  return h(`span.tag.${tone}`, {}, text);
}

/** A button styled as a key of light. `lit` for the main action. */
export function key(label: string, onclick: () => void, lit = false): HTMLButtonElement {
  return h(lit ? "button.btn.lit" : "button.btn.out", { type: "button", onclick }, label);
}

/** A margin note naming the brief's words next to the part that shows them. */
export function note(text: string, focus?: string): HTMLSpanElement {
  return h("span.note", { "data-focus": focus }, text);
}

/** "Reading from Sepolia…", while a page's reads are in flight. */
export function reading(what = "Reading from Sepolia…"): HTMLParagraphElement {
  return h("p.reading", {}, what);
}

/** A failed read, said plainly. */
export function failed(err: unknown): HTMLParagraphElement {
  return h("p.failed", {}, `Couldn't read: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
}
