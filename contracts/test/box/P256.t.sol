// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {P256} from "../../src/box/P256.sol";

/// Runs on forge's osaka EVM, which has the EIP-7951 precompile, signing with real P-256 keys via vm.signP256.
contract P256Test is Test {
    uint256 internal constant KEY = 0xB0C5;
    bytes32 internal constant DIGEST = keccak256("tap");

    struct Signed {
        bytes32 r;
        bytes32 lowS;
        bytes32 highS;
        bytes32 qx;
        bytes32 qy;
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (Signed memory sig) {
        (bytes32 r, bytes32 s) = vm.signP256(key, digest);
        (uint256 qx, uint256 qy) = vm.publicKeyP256(key);
        uint256 low = uint256(s) > P256.HALF_N ? P256.N - uint256(s) : uint256(s);
        sig = Signed(r, bytes32(low), bytes32(P256.N - low), bytes32(qx), bytes32(qy));
    }

    function test_acceptsLowS() public view {
        Signed memory sig = _sign(KEY, DIGEST);
        assertTrue(P256.verify(DIGEST, sig.r, sig.lowS, sig.qx, sig.qy));
    }

    function test_rejectsHighSTwin() public view {
        Signed memory sig = _sign(KEY, DIGEST);
        assertFalse(P256.verify(DIGEST, sig.r, sig.highS, sig.qx, sig.qy));
    }

    function test_rejectsWrongDigest() public view {
        Signed memory sig = _sign(KEY, DIGEST);
        assertFalse(P256.verify(keccak256("other"), sig.r, sig.lowS, sig.qx, sig.qy));
    }

    function test_rejectsWrongKey() public view {
        Signed memory sig = _sign(KEY, DIGEST);
        Signed memory other = _sign(KEY + 1, DIGEST);
        assertFalse(P256.verify(DIGEST, sig.r, sig.lowS, other.qx, other.qy));
    }

    function test_rejectsZeroKey() public view {
        Signed memory sig = _sign(KEY, DIGEST);
        assertFalse(P256.verify(DIGEST, sig.r, sig.lowS, bytes32(0), bytes32(0)));
    }

    function test_rejectsZeroR() public view {
        Signed memory sig = _sign(KEY, DIGEST);
        assertFalse(P256.verify(DIGEST, bytes32(0), sig.lowS, sig.qx, sig.qy));
    }

    function test_isLowSBoundaries() public pure {
        assertFalse(P256.isLowS(bytes32(0)));
        assertTrue(P256.isLowS(bytes32(uint256(1))));
        assertTrue(P256.isLowS(bytes32(P256.HALF_N)));
        assertFalse(P256.isLowS(bytes32(P256.HALF_N + 1)));
        assertFalse(P256.isLowS(bytes32(P256.N)));
        assertFalse(P256.isLowS(bytes32(type(uint256).max)));
    }

    function testFuzz_onlyLowFormVerifies(uint256 key, bytes32 digest) public view {
        key = bound(key, 1, P256.N - 1);
        Signed memory sig = _sign(key, digest);
        assertTrue(P256.verify(digest, sig.r, sig.lowS, sig.qx, sig.qy));
        assertFalse(P256.verify(digest, sig.r, sig.highS, sig.qx, sig.qy));
    }
}
