import { describe, expect, it } from 'vitest';

import { readVerdict } from '../src/verdict.ts';

const POT = { seats: 3, amount: '5' };
const split = (payouts: unknown, why: unknown = 'why') => ({ kind: 'split', payouts, why });

describe('a verdict', () => {
  it.each([
    [['15', '0', '0']],
    [['5', '5', '5']],
    [['0', '7', '8']],
  ])('stands when it adds up: %j', (payouts) => {
    expect(readVerdict(split(payouts), POT)).toEqual({ verdict: { kind: 'split', payouts, why: 'why' } });
  });

  it('keeps only the fields a verdict has', () => {
    expect(readVerdict({ ...split(['15', '0', '0']), pay: 'me' }, POT)).toEqual({ verdict: split(['15', '0', '0']) });
  });

  it('adds up past what a double can hold', () => {
    const big = { seats: 2, amount: '100000000000000000000' };
    expect(readVerdict(split(['200000000000000000000', '0']), big)).toHaveProperty('verdict');
    expect(readVerdict(split(['200000000000000000001', '0']), big)).toHaveProperty('problem');
  });

  it('takes cannot_judge', () => {
    expect(readVerdict({ kind: 'cannot_judge', why: 'no', payouts: ['1'] }, POT)).toEqual({ verdict: { kind: 'cannot_judge', why: 'no' } });
  });

  it.each([
    ['nothing', undefined],
    ['a string', 'split'],
    ['a list', []],
    ['an unknown kind', { kind: 'pay', why: 'x' }],
    ['no reason', { kind: 'split', payouts: ['15', '0', '0'] }],
    ['a reason too long', split(['15', '0', '0'], 'x'.repeat(2001))],
    ['no payouts', { kind: 'split', why: 'x' }],
    ['payouts that are no list', split('15,0,0')],
    ['too few', split(['15', '0'])],
    ['too many', split(['15', '0', '0', '0'])],
    ['a number', split([15, 0, 0])],
    ['a negative', split(['-5', '20', '0'])],
    ['a fraction', split(['7.5', '7.5', '0'])],
    ['a leading zero', split(['015', '0', '0'])],
    ['hex', split(['0xf', '0', '0'])],
    ['spaces', split([' 15', '0', '0'])],
    ['an empty string', split(['', '15', '0'])],
    ['too little', split(['14', '0', '0'])],
    ['too much', split(['16', '0', '0'])],
    ['past uint256', split([`1${'0'.repeat(78)}`, '0', '0'])],
  ])('fails on %s', (_name, value) => {
    expect(readVerdict(value, POT)).toHaveProperty('problem');
  });
});
