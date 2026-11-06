// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";

import {P256} from "../../src/box/P256.sol";

/// @notice P-256 test keys and low-`s` signatures, from forge's cheatcodes.
abstract contract P256Keys {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// @notice The order of P-256.
    uint256 internal constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;

    function p256Key(string memory seed) internal pure returns (uint256) {
        return uint256(keccak256(bytes(seed))) % (P256_N - 1) + 1;
    }

    function p256Public(uint256 key) internal pure returns (bytes32 qx, bytes32 qy) {
        (uint256 x, uint256 y) = VM.publicKeyP256(key);
        return (bytes32(x), bytes32(y));
    }

    /// @dev Signs the raw digest (no prehash) and normalises `s` to the low half.
    function p256Sign(uint256 key, bytes32 digest) internal pure returns (bytes32 r, bytes32 s) {
        (r, s) = VM.signP256(key, digest);
        if (uint256(s) > P256.HALF_N) s = bytes32(P256_N - uint256(s));
    }
}
