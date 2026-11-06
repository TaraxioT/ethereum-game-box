import { decodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';

import { championshipsAbi, fakeUsdcAbi, gameBoxNamesAbi } from '../names/abis.ts';
import { contractAddress } from '../names/deployments.ts';
import { CREATES_STORAGE_GAS } from '../names/gas.ts';
import { usdc } from '../names/usdc.ts';
import { AdminInputError, addGameCall, closeCupCall, formatSeconds, openCupCall, openCupCalls } from './calls.ts';

const ADMIN = '0xB2b6B516Df4B159c0E4Eb1d6D7D65a5f2F04C30E';
const NOW = 1_800_000_000;

describe('the admin calls', () => {
  it('adds a game with its title term, at the storage-creating gas limit', () => {
    const call = addGameCall('tapwar', 900);
    expect(call.to).toBe(contractAddress('GameBoxNames'));
    expect(call.gas).toBe(CREATES_STORAGE_GAS);
    expect(decodeFunctionData({ abi: gameBoxNamesAbi, data: call.data })).toEqual({ functionName: 'addGame', args: ['tapwar', 900n] });
    expect(call.what).toBe('add game tapwar.gamebox.eth (title term 15m)');
  });

  it('refuses a bad label or term before anything is sent', () => {
    expect(() => addGameCall('Tap War', 900)).toThrow(AdminInputError);
    expect(() => addGameCall('tapwar', 59)).toThrow(/title term/);
    expect(() => addGameCall('tapwar', 400 * 86_400)).toThrow(/title term/);
    expect(() => addGameCall('tapwar', 90.5)).toThrow(/whole seconds/);
  });

  it('opens a championship that ends in the future, never named after the title', () => {
    const call = openCupCall({ game: 'quickdraw', label: 'demo-cup', ends: NOW + 300, prize: usdc(25) }, NOW);
    expect(call.to).toBe(contractAddress('Championships'));
    expect(decodeFunctionData({ abi: championshipsAbi, data: call.data })).toEqual({
      functionName: 'open',
      args: ['quickdraw', 'demo-cup', BigInt(NOW + 300), 25_000_000n],
    });
    expect(call.what).toBe('open demo-cup.quickdraw.gamebox.eth for 5m, prize 25 USDC');
    expect(() => openCupCall({ game: 'quickdraw', label: 'champion', ends: NOW + 300, prize: 0n }, NOW)).toThrow(/taken by the title/);
    expect(() => openCupCall({ game: 'quickdraw', label: 'demo-cup', ends: NOW + 30, prize: 0n }, NOW)).toThrow(/a championship must be/);
    expect(() => openCupCall({ game: 'quickdraw', label: 'demo-cup', ends: NOW + 300, prize: -1n }, NOW)).toThrow(/negative/);
  });

  it('mints the prize shortfall and approves it before the open, and only what is missing', () => {
    const cup = { game: 'quickdraw', label: 'demo-cup', ends: NOW + 300, prize: usdc(25) };
    const calls = openCupCalls(cup, NOW, ADMIN, { balance: usdc(10), allowance: 0n });
    expect(calls.map((c) => decodeFunctionData({ abi: [...fakeUsdcAbi, ...championshipsAbi], data: c.data }))).toEqual([
      { functionName: 'mint', args: [ADMIN, usdc(15)] },
      { functionName: 'approve', args: [contractAddress('Championships'), usdc(25)] },
      { functionName: 'open', args: ['quickdraw', 'demo-cup', BigInt(NOW + 300), usdc(25)] },
    ]);
    expect(openCupCalls(cup, NOW, ADMIN, { balance: usdc(30), allowance: usdc(25) })).toHaveLength(1);
    expect(openCupCalls({ ...cup, prize: 0n }, NOW, ADMIN, { balance: 0n, allowance: 0n })).toHaveLength(1);
  });

  it('closes a game’s championship', () => {
    expect(decodeFunctionData({ abi: championshipsAbi, data: closeCupCall('quickdraw').data })).toEqual({ functionName: 'close', args: ['quickdraw'] });
  });

  it('says a duration in days, hours, minutes and seconds', () => {
    expect(formatSeconds(0)).toBe('0s');
    expect(formatSeconds(90)).toBe('1m 30s');
    expect(formatSeconds(7 * 86_400)).toBe('7d');
    expect(formatSeconds(93_600)).toBe('1d 2h');
  });
});
