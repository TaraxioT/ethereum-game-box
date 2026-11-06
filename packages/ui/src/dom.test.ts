import { describe, expect, it, vi } from 'vitest';

import { addressLink, field, h, key, short, tag, txLink } from './dom.ts';

describe('h', () => {
  it('builds a tag with classes, attributes, listeners and children', () => {
    const click = vi.fn();
    const el = h('button.btn.lit', { type: 'button', disabled: true, title: null, hidden: false, onclick: click }, 'Save ', 2, null, false);
    expect(el.tagName).toBe('BUTTON');
    expect(el.className).toBe('btn lit');
    expect(el.getAttribute('disabled')).toBe('');
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.hasAttribute('hidden')).toBe(false);
    expect(el.textContent).toBe('Save 2');
    el.dispatchEvent(new Event('click'));
    expect(click).toHaveBeenCalledOnce();
  });

  it('adds a class attribute to the dotted classes', () => {
    expect(h('a.ext', { class: 'on' }).className).toBe('ext on');
  });
});

describe('the small parts', () => {
  it('shortens long hex and leaves short text', () => {
    expect(short('0x8e4f00000000000000000000000000000000012ab')).toBe('0x8e4f…12ab');
    expect(short('mumbai-01')).toBe('mumbai-01');
  });

  it('links addresses and transactions to Sepolia Etherscan', () => {
    const address = '0x8e4f00000000000000000000000000000000012a';
    expect(addressLink(address).href).toBe(`https://sepolia.etherscan.io/address/${address}`);
    expect(txLink(`0x${'ab'.repeat(32)}`).textContent).toBe('0xabab…abab ↗');
  });

  it('makes tags, keys and form rows', () => {
    expect(tag('active', 'ok').className).toBe('tag ok');
    expect(key('Go', () => {}, 'lit').className).toBe('btn lit');
    const input = h('input', { type: 'text' });
    const row = field('Location', input, h('span.hint', {}, 'Where'));
    expect(row.querySelector('label')!.htmlFor).toBe(input.id);
    expect(input.id).not.toBe('');
  });
});
