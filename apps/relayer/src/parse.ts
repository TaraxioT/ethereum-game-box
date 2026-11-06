// Field readers for a JSON request body. Each one returns the typed value or throws a 400 that names the field (as
// `<parent>.<field>` when the body is nested).

import { type Address, type Hex, getAddress, isAddress, isHex } from 'viem';

import { Refusal } from './refusal.ts';

export type Body = Record<string, unknown>;

const bad = (field: string, want: string, parent?: string) =>
  new Refusal(400, `${parent ? `${parent}.` : ''}${field}: ${want}`);

export function object(value: unknown, field = 'body'): Body {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw bad(field, 'expected an object');
  return value as Body;
}

export function text(body: Body, field: string, parent?: string): string {
  const value = body[field];
  if (typeof value !== 'string') throw bad(field, 'expected a string', parent);
  return value;
}

export function address(body: Body, field: string, parent?: string): Address {
  const value = body[field];
  if (typeof value !== 'string' || !isAddress(value, { strict: false })) throw bad(field, 'expected an address', parent);
  return getAddress(value);
}

export function hex(body: Body, field: string, parent?: string): Hex {
  const value = body[field];
  if (typeof value !== 'string' || !isHex(value) || value.length % 2 !== 0) throw bad(field, 'expected 0x-hex bytes', parent);
  return value.toLowerCase() as Hex;
}

export function bytes32(body: Body, field: string, parent?: string): Hex {
  const value = hex(body, field, parent);
  if (value.length !== 66) throw bad(field, 'expected 32 bytes of hex', parent);
  return value;
}

/** A uint256, given as a decimal or 0x string, or as a safe integer. */
export function uint(body: Body, field: string, parent?: string): bigint {
  const value = body[field];
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/.test(value)) {
    const n = BigInt(value);
    if (n < 2n ** 256n) return n;
  }
  throw bad(field, 'expected an unsigned integer', parent);
}

export function bool(body: Body, field: string, parent?: string): boolean {
  const value = body[field];
  if (typeof value !== 'boolean') throw bad(field, 'expected true or false', parent);
  return value;
}
