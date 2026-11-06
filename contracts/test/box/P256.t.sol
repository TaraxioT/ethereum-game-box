// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {P256} from "../../src/box/P256.sol";
import {P256Keys} from "./P256Keys.sol";

contract P256Harness {
    function verify(bytes32 digest, bytes32 r, bytes32 s, bytes32 qx, bytes32 qy) external view returns (bool) {
        return P256.verify(digest, r, s, qx, qy);
    }
}

contract P256Test is Test, P256Keys {
    P256Harness internal harness = new P256Harness();
    uint256 internal key = p256Key("egb-test-p256");
    bytes32 internal digest = keccak256("a Game Box digest");

    function test_precompileIsLive() public view {
        (bytes32 qx, bytes32 qy) = p256Public(key);
        (bytes32 r, bytes32 s) = p256Sign(key, digest);
        (bool ok, bytes memory out) = P256.VERIFIER.staticcall(abi.encode(digest, r, s, qx, qy));
        assertTrue(ok);
        assertEq(out, abi.encode(uint256(1)));
    }

    function test_halfN() public pure {
        assertEq(P256.HALF_N, P256_N / 2);
    }

    function test_validSignaturePasses() public view {
        (bytes32 qx, bytes32 qy) = p256Public(key);
        (bytes32 r, bytes32 s) = p256Sign(key, digest);
        assertTrue(harness.verify(digest, r, s, qx, qy));
    }

    function test_wrongKeyFails() public view {
        (bytes32 qx, bytes32 qy) = p256Public(p256Key("egb-test-other"));
        (bytes32 r, bytes32 s) = p256Sign(key, digest);
        assertFalse(harness.verify(digest, r, s, qx, qy));
    }

    function test_wrongDigestFails() public view {
        (bytes32 qx, bytes32 qy) = p256Public(key);
        (bytes32 r, bytes32 s) = p256Sign(key, digest);
        assertFalse(harness.verify(keccak256("another digest"), r, s, qx, qy));
    }

    function test_highSFails() public view {
        (bytes32 qx, bytes32 qy) = p256Public(key);
        (bytes32 r, bytes32 s) = p256Sign(key, digest);
        bytes32 highS = bytes32(P256_N - uint256(s));
        // The high form is a valid signature to the precompile itself, and P256 still refuses it.
        (, bytes memory out) = P256.VERIFIER.staticcall(abi.encode(digest, r, highS, qx, qy));
        assertEq(out, abi.encode(uint256(1)));
        assertFalse(harness.verify(digest, r, highS, qx, qy));
    }

    function test_signsTheRawDigest() public view {
        (bytes32 qx, bytes32 qy) = p256Public(key);
        (bytes32 r, bytes32 s) = p256Sign(key, digest);
        assertFalse(harness.verify(sha256(abi.encode(digest)), r, s, qx, qy));
    }

    function testFuzz_onlyTheSignedDigestPasses(bytes32 other) public view {
        vm.assume(other != digest);
        (bytes32 qx, bytes32 qy) = p256Public(key);
        (bytes32 r, bytes32 s) = p256Sign(key, digest);
        assertFalse(harness.verify(other, r, s, qx, qy));
    }
}

/// @notice The same signature on a chain without EIP-7951 (Prague): the call to 0x100 succeeds with no return data,
///         and that must read as invalid.
contract P256WithoutPrecompileTest is Test, P256Keys {
    /// forge-config: default.evm_version = "prague"
    function test_missingPrecompileFails() public {
        P256Harness harness = new P256Harness();
        uint256 key = p256Key("egb-test-p256");
        bytes32 digest = keccak256("a Game Box digest");
        (bytes32 qx, bytes32 qy) = p256Public(key);
        (bytes32 r, bytes32 s) = p256Sign(key, digest);
        (bool ok, bytes memory out) = P256.VERIFIER.staticcall(abi.encode(digest, r, s, qx, qy));
        assertTrue(ok);
        assertEq(out.length, 0);
        assertFalse(harness.verify(digest, r, s, qx, qy));
    }
}
