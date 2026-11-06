// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title P256
/// @notice P-256 (secp256r1) signature checks through the EIP-7951 precompile at `0x100`, live on Sepolia since Fusaka.
///         A high `s` is refused, so each signature has one valid form. A chain without the precompile returns
///         nothing, which counts as a failure, never as a success.
library P256 {
    /// @notice The EIP-7951 `P256VERIFY` precompile.
    address internal constant VERIFIER = address(0x100);

    /// @notice Half the order of P-256: the largest low `s`.
    uint256 internal constant HALF_N = 0x7FFFFFFF800000007FFFFFFFFFFFFFFFDE737D56D38BCF4279DCE5617E3192A8;

    /// @notice Whether `(r, s)` is a valid low-`s` signature of `digest` by the key `(qx, qy)`.
    /// @param digest The signed 32 bytes.
    /// @param r The signature's `r`.
    /// @param s The signature's `s`; must be at most `HALF_N`.
    /// @param qx The public key's x coordinate.
    /// @param qy The public key's y coordinate.
    /// @return True only if the precompile answered and said valid.
    function verify(bytes32 digest, bytes32 r, bytes32 s, bytes32 qx, bytes32 qy) internal view returns (bool) {
        if (uint256(s) > HALF_N) return false;
        (bool ok, bytes memory out) = VERIFIER.staticcall(abi.encode(digest, r, s, qx, qy));
        return ok && out.length == 32 && uint256(bytes32(out)) == 1;
    }
}
