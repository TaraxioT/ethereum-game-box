import { afterEach, describe, expect, it, vi } from 'vitest';

const ADDRESS = '0xf3e90e1a0a17a4680e52573b6188d6c94442493b';
const CHECKSUMMED = '0xF3e90E1a0a17A4680e52573b6188D6c94442493B';

/** The module, loaded against a `deployments/sepolia.json` holding `contracts`. */
async function loadWith(contracts: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock('../../../../deployments/sepolia.json', () => ({ default: { chainId: 11155111, contracts } }));
  return import('./deployments.ts');
}

afterEach(() => {
  vi.doUnmock('../../../../deployments/sepolia.json');
});

describe('the store deployments', () => {
  it('are undefined before the deploy', async () => {
    const { storePotAddress, storeUsdcAddress } = await loadWith({});
    expect(storePotAddress()).toBeUndefined();
    expect(storeUsdcAddress()).toBeUndefined();
  });

  it('are undefined for a zero-address placeholder', async () => {
    const zero = { address: `0x${'0'.repeat(40)}`, deployBlock: 0, txHash: '0x', verified: false };
    const { storePotAddress, storeUsdcAddress } = await loadWith({ StorePot: zero, StoreUSDC: zero });
    expect(storePotAddress()).toBeUndefined();
    expect(storeUsdcAddress()).toBeUndefined();
  });

  it('read each address, checksummed, once deployed', async () => {
    const entry = { address: ADDRESS, deployBlock: 1, txHash: '0x', verified: false };
    const { storePotAddress, storeUsdcAddress } = await loadWith({ StorePot: entry, StoreUSDC: entry });
    expect(storePotAddress()).toBe(CHECKSUMMED);
    expect(storeUsdcAddress()).toBe(CHECKSUMMED);
  });
});
