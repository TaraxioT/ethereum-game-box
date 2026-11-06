// Role bits of ENSv2's Enhanced Access Control, as the Sepolia deployment defines them
// (`RegistryRolesLib.sol`, `PermissionedResolverLib.sol`), and the Game Box roles of `GameBoxNames`.
// Each role is one nybble; its admin role is the same bit 128 places up. `contracts/src/names/IENSv2.sol` holds the
// same table, and a test checks the two against each other.

import { type Hex, encodeAbiParameters, keccak256, toHex } from 'viem';

const admin = (role: bigint) => role << 128n;

/** `PermissionedRegistry` roles. */
export const REGISTRY_ROLES = {
  REGISTRAR: 1n << 0n,
  REGISTRAR_ADMIN: admin(1n << 0n),
  REGISTER_RESERVED: 1n << 4n,
  REGISTER_RESERVED_ADMIN: admin(1n << 4n),
  SET_PARENT: 1n << 8n,
  SET_PARENT_ADMIN: admin(1n << 8n),
  UNREGISTER: 1n << 12n,
  UNREGISTER_ADMIN: admin(1n << 12n),
  RENEW: 1n << 16n,
  RENEW_ADMIN: admin(1n << 16n),
  SET_SUBREGISTRY: 1n << 20n,
  SET_SUBREGISTRY_ADMIN: admin(1n << 20n),
  SET_RESOLVER: 1n << 24n,
  SET_RESOLVER_ADMIN: admin(1n << 24n),
  CAN_TRANSFER_ADMIN: admin(1n << 28n),
  SET_URI: 1n << 36n,
  SET_URI_ADMIN: admin(1n << 36n),
  CAN_NAME: 1n << 120n,
  CAN_NAME_ADMIN: admin(1n << 120n),
  UPGRADE: 1n << 124n,
  UPGRADE_ADMIN: admin(1n << 124n),
} as const;

/** `PermissionedResolver` roles. */
export const RESOLVER_ROLES = {
  SET_ADDRESS: 1n << 0n,
  SET_ADDRESS_ADMIN: admin(1n << 0n),
  SET_TEXT: 1n << 4n,
  SET_TEXT_ADMIN: admin(1n << 4n),
  SET_CONTENTHASH: 1n << 8n,
  SET_CONTENTHASH_ADMIN: admin(1n << 8n),
  SET_ABI: 1n << 12n,
  SET_ABI_ADMIN: admin(1n << 12n),
  SET_INTERFACE: 1n << 16n,
  SET_INTERFACE_ADMIN: admin(1n << 16n),
  SET_NAME: 1n << 20n,
  SET_NAME_ADMIN: admin(1n << 20n),
  SET_DATA: 1n << 24n,
  SET_DATA_ADMIN: admin(1n << 24n),
  LINK: 1n << 28n,
  LINK_ADMIN: admin(1n << 28n),
  CAN_NAME: 1n << 120n,
  CAN_NAME_ADMIN: admin(1n << 120n),
  UPGRADE: 1n << 124n,
  UPGRADE_ADMIN: admin(1n << 124n),
} as const;

/** The root resource of every registry and resolver. */
export const ROOT_RESOURCE = 0n;

/** The resolver resource that holds the roles for one text key. */
export function textResource(key: string): bigint {
  return BigInt(keccak256(toHex(key)));
}

/** The resolver resource that holds the roles for one coin type's address. */
export function addressResource(coinType: bigint): bigint {
  return BigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }], [coinType])));
}

/** The names of the roles set in `bitmap`, from `table` (`REGISTRY_ROLES` or `RESOLVER_ROLES`). */
export function roleNames<T extends Record<string, bigint>>(bitmap: bigint, table: T): (keyof T)[] {
  return (Object.keys(table) as (keyof T)[]).filter((name) => (bitmap & table[name]!) !== 0n);
}

/** `GameBoxNames`' OpenZeppelin roles. */
export const GAME_BOX_ROLES = {
  DEFAULT_ADMIN_ROLE: `0x${'00'.repeat(32)}` as Hex,
  LICENSOR_ROLE: keccak256(toHex('LICENSOR_ROLE')),
  REFEREE_ROLE: keccak256(toHex('REFEREE_ROLE')),
} as const;
