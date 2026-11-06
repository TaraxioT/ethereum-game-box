import { afterEach, describe, expect, it, vi } from 'vitest';

const POT = '0xf3e90e1a0a17a4680e52573b6188d6c94442493b';
const POT_CHECKSUMMED = '0xF3e90E1a0a17A4680e52573b6188D6c94442493B';
const TOKEN = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const TOKEN_CHECKSUMMED = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

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

  it('read each address from its own key, checksummed, once deployed', async () => {
    const entry = (address: string) => ({ address, deployBlock: 1, txHash: '0x', verified: false });
    const { storePotAddress, storeUsdcAddress } = await loadWith({ StorePot: entry(POT), StoreUSDC: entry(TOKEN) });
    expect(storePotAddress()).toBe(POT_CHECKSUMMED);
    expect(storeUsdcAddress()).toBe(TOKEN_CHECKSUMMED);
  });
});
