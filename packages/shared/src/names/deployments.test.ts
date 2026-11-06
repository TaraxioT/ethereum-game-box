import { describe, expect, it } from 'vitest';

import sepolia from '../../../../deployments/sepolia.json' with { type: 'json' };
import { contractAddress, deployedAddresses, ensAddress, namesProxies } from './deployments.ts';

describe('deployedAddresses', () => {
  const all = deployedAddresses();

  it("holds ours, ENS's and the names proxies, once each", () => {
    expect(all).toContain(contractAddress('GameBoxNames'));
    expect(all).toContain(contractAddress('P256AccountFactory'));
    expect(all).toContain(ensAddress('UniversalResolver'));
    expect(all).toContain(namesProxies().gameboxResolver);
    for (const title of Object.values(namesProxies().titles)) expect(all.map((a) => a.toLowerCase())).toContain(title.toLowerCase());
    expect(new Set(all).size).toBe(all.length);
  });

  it('leaves out the external tokens, the transaction hashes and the source links', () => {
    const lower = all.map((a) => a.toLowerCase());
    for (const token of Object.values((sepolia as { external?: Record<string, string> }).external ?? {})) {
      expect(lower).not.toContain(token.toLowerCase());
    }
    for (const address of all) expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
