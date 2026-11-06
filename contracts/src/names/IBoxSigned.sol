// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IBoxSigned
/// @notice The refusals every contract that takes a Box-signed message shares (`BoxResults`, `DuelPot`, `BoxSeats`):
///         the Box must be registered in `GameBoxNames`, live (its name unexpired) and `Active`, and the message must
///         carry a P-256 signature by the Box's key, low `s`, over its raw EIP-712 digest, before its deadline.
interface IBoxSigned {
    /// @notice No Box was ever registered under the label.
    error UnknownBox(string box);
    /// @notice The Box's licence (its name) has expired.
    error BoxExpired(string box);
    /// @notice The Box's `status` is not `active`.
    error BoxNotActive(string box);
    /// @notice The deadline has passed.
    error DeadlineExpired(uint256 deadline);
    /// @notice The P-256 signature does not verify against the Box's key, or its `s` is high.
    error InvalidSignature();
}
