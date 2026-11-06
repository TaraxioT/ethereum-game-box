import { describe, expect, it } from 'vitest';

import { REGISTRY_ROLES, RESOLVER_ROLES, addressResource, roleNames, textResource } from './roles.ts';

describe('roles', () => {
  it('decodes a bitmap into role names', () => {
    // gamebox.eth's token roles for its .eth owner, read from ETHRegistry on Sepolia.
    const ownerRoles = 0x1110000000000000000000000000000001100000n;
    expect(roleNames(ownerRoles, REGISTRY_ROLES)).toEqual([
      'SET_SUBREGISTRY',
      'SET_SUBREGISTRY_ADMIN',
      'SET_RESOLVER',
      'SET_RESOLVER_ADMIN',
      'CAN_TRANSFER_ADMIN',
    ]);
    expect(roleNames(RESOLVER_ROLES.SET_TEXT | RESOLVER_ROLES.SET_TEXT_ADMIN, RESOLVER_ROLES)).toEqual([
      'SET_TEXT',
      'SET_TEXT_ADMIN',
    ]);
  });

  it('computes resolver resources as PermissionedResolverLib does', () => {
    // `cast keccak stats` and `cast keccak <uint256 60, abi-encoded>`.
    expect(textResource('stats')).toBe(0x3d71da1a501db4dfb9a53fbeb3d4dc8b8f0879ab738914bf6345a84772667d54n);
    expect(addressResource(60n)).toBe(0xc6bb06cb7f92603de181bf256cd16846b93b752a170ff24824098b31aa008a7en);
  });
});
