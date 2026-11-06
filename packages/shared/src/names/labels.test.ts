import { describe, expect, it } from 'vitest';

import {
  championshipLabelProblem,
  championshipName,
  dnsName,
  fullName,
  labelProblem,
  popupLabel,
  popupLabelProblem,
  titleName,
} from './labels.ts';

describe('labelProblem', () => {
  it.each(['abc', 'mumbai-01', 'bot', 'a-b', '0x0', 'a'.repeat(32), 'quickdraw'])('accepts %s', (label) => {
    expect(labelProblem(label)).toBeNull();
  });

  it.each([
    ['', 'at least 3 characters'],
    ['ab', 'at least 3 characters'],
    ['a'.repeat(33), 'at most 32 characters'],
    ['Alice', 'only a-z, 0-9 and -'],
    ['al ce', 'only a-z, 0-9 and -'],
    ['al.ce', 'only a-z, 0-9 and -'],
    ['al_ce', 'only a-z, 0-9 and -'],
    ['ålice', 'only a-z, 0-9 and -'],
    ['-alice', 'no hyphen at the start or end'],
    ['alice-', 'no hyphen at the start or end'],
  ])('refuses %j: %s', (label, problem) => {
    expect(labelProblem(label)).toBe(problem);
  });
});

describe('pop-up labels', () => {
  it('prefixes popup-', () => {
    expect(popupLabel('x')).toBe('popup-x');
  });

  it('applies the rule to the full label', () => {
    expect(popupLabelProblem('x')).toBeNull();
    expect(popupLabelProblem('a'.repeat(26))).toBeNull();
    expect(popupLabelProblem('a'.repeat(27))).toBe('at most 32 characters');
    expect(popupLabelProblem('')).toBe('at least 1 character');
    expect(popupLabelProblem('-x')).toBe('no hyphen at the start or end');
    expect(popupLabelProblem('x-')).toBe('no hyphen at the start or end');
    expect(popupLabelProblem('X')).toBe('only a-z, 0-9 and -');
  });
});

describe('names', () => {
  it('builds full and title names', () => {
    expect(fullName('alice')).toBe('alice.gamebox.eth');
    expect(titleName('quickdraw')).toBe('champion.quickdraw.gamebox.eth');
  });
});

describe('dnsName', () => {
  it('DNS-encodes the full name, as NameLib.dnsName does', () => {
    expect(dnsName('mumbai-01')).toBe('0x096d756d6261692d30310767616d65626f780365746800');
  });
});

describe('championships', () => {
  it('names a championship in its game', () => {
    expect(championshipName('mumbai-cup', 'stockduel')).toBe('mumbai-cup.stockduel.gamebox.eth');
  });

  it('refuses the title label and bad labels', () => {
    expect(championshipLabelProblem('mumbai-cup')).toBeNull();
    expect(championshipLabelProblem('champion')).toBe('taken by the title');
    expect(championshipLabelProblem('-cup')).toBe('no hyphen at the start or end');
  });
});
