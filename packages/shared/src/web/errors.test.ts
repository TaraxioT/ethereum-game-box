import { encodeErrorResult, getAbiItem } from 'viem';
import { describe, expect, it } from 'vitest';

import { gameBoxNamesAbi } from '../names/abis.ts';
import { decodeRevert, errorName, revertData } from './errors.ts';

const unknownBox = encodeErrorResult({
  abi: [getAbiItem({ abi: gameBoxNamesAbi, name: 'UnknownBox' })],
  errorName: 'UnknownBox',
  args: ['mumbai-01'],
});

describe('decodeRevert', () => {
  it('names a names-contract error, with its arguments', () => {
    expect(decodeRevert(unknownBox)).toEqual({ name: 'UnknownBox', args: ['mumbai-01'] });
  });

  it('returns null for data no known error matches', () => {
    expect(decodeRevert('0xdeadbeef')).toBeNull();
    expect(decodeRevert('0x')).toBeNull();
  });
});

describe('revertData and errorName', () => {
  it('find the data at any depth and name it', () => {
    const nested = { data: { data: unknownBox } };
    expect(revertData(nested)).toBe(unknownBox);
    expect(errorName({ data: unknownBox })).toBe('UnknownBox');
  });

  it('say a closed passkey prompt plainly', () => {
    expect(errorName(new DOMException('cancelled', 'NotAllowedError'))).toBe('the passkey prompt was closed');
  });

  it("fall back to an error's first line", () => {
    expect(errorName(new Error('first\nsecond'))).toBe('first');
    expect(errorName('plain')).toBe('plain');
  });
});
