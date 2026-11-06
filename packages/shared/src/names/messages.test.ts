// Checks each digest against EIP-712 computed by hand from the type strings fixed in the design, so a change to a
// type, a domain or the encoding shows up here. The byte-for-byte check against the contracts is vectors.test.ts.

import { type Address, type Hex, concat, encodeAbiParameters, keccak256, toHex } from 'viem';
import { describe, expect, it } from 'vitest';

import { claimNameDigest, executeDigest, resultDigest } from './messages.ts';

const chainId = 11155111;
const contract: Address = '0x1111111111111111111111111111111111111111';
const alice: Address = '0x2222222222222222222222222222222222222222';
const bob: Address = '0x3333333333333333333333333333333333333333';

const hashString = (s: string) => keccak256(toHex(s));

function domainSeparator(name: string): Hex {
  const typeHash = hashString('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)');
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [typeHash, hashString(name), hashString('1'), BigInt(chainId), contract],
    ),
  );
}

const digest = (domain: string, structHash: Hex) => keccak256(concat(['0x1901', domainSeparator(domain), structHash]));

describe('EIP-712 digests', () => {
  it('ClaimName', () => {
    const typeHash = hashString('ClaimName(string label,address badge,uint256 deadline)');
    const struct = keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }],
        [typeHash, hashString('alice'), alice, 1_800_000_000n],
      ),
    );
    expect(claimNameDigest({ label: 'alice', badge: alice, deadline: 1_800_000_000n }, contract)).toBe(
      digest('Game Box Names', struct),
    );
  });

  it('Execute', () => {
    const data: Hex = '0xdeadbeef';
    const typeHash = hashString(
      'Execute(address target,uint256 value,bytes32 dataHash,uint256 nonce,uint256 deadline)',
    );
    const struct = keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }],
        [typeHash, bob, 5n, keccak256(data), 7n, 1_800_000_000n],
      ),
    );
    expect(executeDigest({ target: bob, value: 5n, data, nonce: 7n, deadline: 1_800_000_000n }, contract)).toBe(
      digest('Game Box', struct),
    );
  });

  it('Result', () => {
    const typeHash = hashString(
      'Result(string box,string game,uint256 round,address winner,address loser,bool draw,uint256 deadline)',
    );
    const struct = keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'bytes32' },
          { type: 'bytes32' },
          { type: 'uint256' },
          { type: 'address' },
          { type: 'address' },
          { type: 'bool' },
          { type: 'uint256' },
        ],
        [typeHash, hashString('mumbai-01'), hashString('quickdraw'), 3n, alice, bob, false, 1_800_000_000n],
      ),
    );
    const result = {
      box: 'mumbai-01',
      game: 'quickdraw',
      round: 3n,
      winner: alice,
      loser: bob,
      draw: false,
      deadline: 1_800_000_000n,
    };
    expect(resultDigest(result, contract)).toBe(digest('Game Box Results', struct));
  });
});
