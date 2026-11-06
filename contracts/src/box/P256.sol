// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title P256: checks a Box's hardware-key signature
/// @notice Verifies secp256r1 (P-256) signatures with the EIP-7951 precompile and accepts only the low-s form, so a
///         used signature cannot be replayed as its twin (r, n - s).
library P256 {
    /// @dev EIP-7951 P256VERIFY. Set by the protocol (live on Sepolia since Fusaka), not a deployment.
    address internal constant VERIFIER = address(0x100);

    /// @dev Order of the P-256 curve.
    uint256 internal constant N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 internal constant HALF_N = N / 2;

    /// @return True when (r, s) is a low-s signature of `digest` by the key (qx, qy).
    function verify(bytes32 digest, bytes32 r, bytes32 s, bytes32 qx, bytes32 qy) internal view returns (bool) {
        if (!isLowS(s)) return false;
        (bool ok, bytes memory out) = VERIFIER.staticcall(abi.encode(digest, r, s, qx, qy));
        // A call to an address without code succeeds with no output, so success alone proves nothing:
        // only exactly 32 bytes holding 1 is a valid signature.
        return ok && out.length == 32 && abi.decode(out, (uint256)) == 1;
    }

    /// @notice Every P-256 signature (r, s) has a twin (r, N - s) that verifies just as well. Accept one form only.
    /// @return True when s is a usable low-s value.
    function isLowS(bytes32 s) internal pure returns (bool) {
        uint256 v = uint256(s);
        return v != 0 && v <= HALF_N;
    }
}
