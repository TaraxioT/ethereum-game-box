// A small element builder, and the links and short forms every view uses.
import type { Address, Hash } from "viem";

import { ETHERSCAN } from "../config.ts";

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | ((event: Event) => void)>;

/** `h("p.hint.bad", { title }, "text")`: a tag with classes after dots, attributes (`on*` are listeners), children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  spec: K | `${K}.${string}`,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = spec.split(".") as [K, ...string[]];
  const el = document.createElement(tag);
  if (classes.length) el.className = classes.join(" ");
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(name.slice(2), value);
    else el.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "object" ? child : String(child));
  }
  return el;
}

/** `0x8e4f…12ab`. */
export function short(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export function addressLink(address: Address, text: string = short(address)): HTMLAnchorElement {
  return h("a.ext.mono", { href: `${ETHERSCAN}/address/${address}`, target: "_blank", rel: "noopener" }, `${text} ↗`);
}

export function txLink(hash: Hash): HTMLAnchorElement {
  return h("a.ext.mono", { href: `${ETHERSCAN}/tx/${hash}`, target: "_blank", rel: "noopener" }, `${short(hash)} ↗`);
}

export function tag(text: string, tone: "ok" | "warn" | "bad" | "sys" = "sys"): HTMLSpanElement {
  return h(`span.tag.${tone}`, {}, text);
}

export function reading(what = "Reading from Sepolia…"): HTMLParagraphElement {
  return h("p.reading", {}, what);
}

export function failed(text: string): HTMLParagraphElement {
  return h("p.failed", {}, text);
}

/** A labelled input with a hint line under it for its rule or its problem. */
export function field(
  label: string,
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  hint: HTMLElement,
): HTMLDivElement {
  const id = `f-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  return h("div.field", {}, h("label", { for: id }, label), h("div.in", {}, input, hint));
}
