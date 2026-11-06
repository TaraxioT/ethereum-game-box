import { describe, expect, it } from 'vitest';

import { formatUsdc, usdc } from './usdc.ts';

describe('usdc', () => {
  it('converts whole USDC to 6-decimal base units and back', () => {
    expect(usdc(10)).toBe(10_000_000n);
    expect(usdc('2.5')).toBe(2_500_000n);
    expect(formatUsdc(20_000_000n)).toBe('20');
    expect(formatUsdc(2_500_000n)).toBe('2.5');
  });
});
