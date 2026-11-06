import { decodeFunctionData, erc20Abi, parseEther } from 'viem';
import { describe, expect, it } from 'vitest';

import { boxLeaseAbi } from '../names/abis.ts';
import { contractAddress } from '../names/deployments.ts';
import { CREATES_STORAGE_GAS } from '../names/gas.ts';
import { AdminInputError } from './calls.ts';
import { type LeaseView, lapseCall, leaseLeft, leaseOpen, stakeCalls, unstakeCall } from './lease.ts';

const ADMIN = '0xB2b6B516Df4B159c0E4Eb1d6D7D65a5f2F04C30E';
const KEY = { qx: `0x${'11'.repeat(32)}`, qy: `0x${'22'.repeat(32)}` } as const;
const NOW = 1_800_000_000;

function view(over: Partial<LeaseView> = {}): LeaseView {
  return {
    label: 'mumbai-01',
    name: 'mumbai-01.gamebox.eth',
    standing: 'active',
    expiry: NOW + 86_400,
    key: KEY,
    lease: { operator: ADMIN, stake: parseEther('300'), start: NOW - 3_600, end: NOW + 7_200 },
    now: NOW,
    ratePerHour: parseEther('100'),
    minHours: 1,
    maxHours: 720,
    staker: { address: ADMIN, gbx: parseEther('1000'), allowance: 0n },
    ...over,
  };
}

describe('a Box lease', () => {
  it('is open while the name is active and the lease runs', () => {
    expect(leaseOpen(view())).toBe(true);
    expect(leaseLeft(view())).toBe(7_200);
    expect(leaseOpen(view({ standing: 'suspended' }))).toBe(false);
    expect(leaseOpen(view({ lease: null }))).toBe(false);
    expect(leaseOpen(view({ expiry: NOW }))).toBe(false);
    expect(leaseOpen(view({ lease: { operator: ADMIN, stake: 1n, start: NOW - 10, end: NOW } }))).toBe(false);
    expect(leaseLeft(view({ lease: null }))).toBe(0);
  });

  it('approves the GBX first when the allowance is short, then stakes at the storage gas', () => {
    const [approve, stake] = stakeCalls(view(), KEY, 3);
    expect(approve?.to).toBe(contractAddress('GBX'));
    expect(decodeFunctionData({ abi: erc20Abi, data: approve!.data }).args).toEqual([contractAddress('BoxLease'), parseEther('300')]);
    expect(approve?.what).toBe('approve 300 GBX for BoxLease');
    expect(stake?.gas).toBe(CREATES_STORAGE_GAS);
    expect(decodeFunctionData({ abi: boxLeaseAbi, data: stake!.data })).toEqual({
      functionName: 'stake',
      args: ['mumbai-01', KEY.qx, KEY.qy, 3n],
    });
    expect(stakeCalls(view({ staker: { address: ADMIN, gbx: parseEther('1000'), allowance: parseEther('300') } }), KEY, 3)).toHaveLength(1);
  });

  it('refuses a stake out of range, too big for the staker, or on a revoked Box', () => {
    expect(() => stakeCalls(view(), KEY, 0)).toThrow(AdminInputError);
    expect(() => stakeCalls(view(), KEY, 721)).toThrow(/1 to 720/);
    expect(() => stakeCalls(view(), KEY, 1.5)).toThrow(/whole hours/);
    expect(() => stakeCalls(view(), KEY, 11)).toThrow(/too little GBX/);
    expect(() => stakeCalls(view({ standing: 'revoked' }), KEY, 1)).toThrow(/revoked/);
  });

  it('unstakes and closes a lease only when one is held', () => {
    expect(decodeFunctionData({ abi: boxLeaseAbi, data: unstakeCall(view()).data })).toEqual({ functionName: 'unstake', args: ['mumbai-01'] });
    expect(decodeFunctionData({ abi: boxLeaseAbi, data: lapseCall(view()).data })).toEqual({ functionName: 'lapse', args: ['mumbai-01'] });
    expect(() => unstakeCall(view({ lease: null }))).toThrow(/nothing is staked/);
  });
});
