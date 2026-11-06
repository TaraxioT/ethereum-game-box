// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IP256AccountFactory
/// @notice Deploys `P256Account`s with CREATE2, salted by the public key, so an account's address is known from its
///         key before the account exists: an operator site shows a new passkey's address at once. Anyone may deploy
///         any key's account; it can only ever be moved by that key.
interface IP256AccountFactory {
    /// @notice An account was deployed.
    /// @param account Its address, `accountOf(qx, qy)`.
    /// @param qx The key's x coordinate.
    /// @param qy The key's y coordinate.
    event AccountDeployed(address indexed account, bytes32 qx, bytes32 qy);

    /// @notice The address of the account for key `(qx, qy)`, deployed or not.
    /// @param qx The key's x coordinate.
    /// @param qy The key's y coordinate.
    /// @return The account's address.
    function accountOf(bytes32 qx, bytes32 qy) external view returns (address);

    /// @notice Deploys the account for key `(qx, qy)`, or returns it if it already exists. Open to anyone.
    /// @param qx The key's x coordinate.
    /// @param qy The key's y coordinate.
    /// @return account The account's address.
    function deploy(bytes32 qx, bytes32 qy) external returns (address account);
}
