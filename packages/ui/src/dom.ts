// A small element builder, and the links, tags and form rows every view of the sites uses.

import type { Address, Hash } from 'viem';
import { ETHERSCAN } from '@egb/shared/web';

export type Child = Node | string | number | null | undefined | false;
export type Attrs = Record<string, string | number | boolean | null | undefined | ((event: Event) => void)>;

/** `h('p.hint.bad', { title }, 'text')`: a tag with classes after dots, attributes (`on*` are listeners; `false`,
 *  `null` and `undefined` are left out; `true` is an empty attribute), and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  spec: K | `${K}.${string}`,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = spec.split('.') as [K, ...string[]];
  const el = document.createElement(tag);
  if (classes.length) el.className = classes.join(' ');
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === 'function') el.addEventListener(name.replace(/^on/, ''), value);
    else if (name === 'class') el.className = [el.className, value].filter(Boolean).join(' ');
    else el.setAttribute(name, value === true ? '' : String(value));
  }
  append(el, ...children);
  return el;
}

export function append(el: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

/** `0x8e4f…12ab`. */
export function short(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

/** An address, linked to Etherscan. */
export function addressLink(address: Address, text: string = short(address)): HTMLAnchorElement {
  return h('a.ext.mono', { href: `${ETHERSCAN}/address/${address}`, target: '_blank', rel: 'noopener' }, `${text} ↗`);
}

/** A transaction hash, linked to Etherscan. */
export function txLink(hash: Hash): HTMLAnchorElement {
  return h('a.ext.mono', { href: `${ETHERSCAN}/tx/${hash}`, target: '_blank', rel: 'noopener' }, `${short(hash)} ↗`);
}

export type Tone = 'ok' | 'warn' | 'bad' | 'sys';

/** A state in a word: `active`, `never expires`. */
export function tag(text: string, tone: Tone = 'sys'): HTMLSpanElement {
  return h(`span.tag.${tone}`, {}, text);
}

/** A button styled as a key of light: `lit` for the main action, `out` otherwise, `bad` for a destructive one. */
export function key(label: string, onclick: () => void, style: 'lit' | 'out' | 'bad' = 'out'): HTMLButtonElement {
  return h(`button.btn.${style}`, { type: 'button', onclick }, label);
}

/** "Reading from Sepolia…", while a view's reads are in flight. */
export function reading(what = 'Reading from Sepolia…'): HTMLParagraphElement {
  return h('p.reading', {}, what);
}

/** A failed read, said plainly. */
export function failed(err: unknown): HTMLParagraphElement {
  return h('p.failed', {}, `Couldn't read: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
}

/** A form row: a label, its input, and a hint under it for the field's rule or its problem. */
export function field(label: string, input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, hint: HTMLElement): HTMLDivElement {
  input.id ||= `f-${Math.random().toString(36).slice(2, 9)}`;
  return h('div.form-row', {}, h('label', { for: input.id }, label), h('div.in', {}, input, hint));
}
