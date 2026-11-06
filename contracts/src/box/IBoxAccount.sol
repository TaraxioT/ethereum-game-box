// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC5267} from "@openzeppelin/contracts/interfaces/IERC5267.sol";

/// @title IBoxAccount
/// @notice A Box's on-chain account, bound to one P-256 key (the Box's HYP2003 token, or a software key for the
///         demo Box). It runs calls the key signed. Anyone may submit them; the relayer does, and pays the gas.
/// @dev The signed message is EIP-712 `Execute(address target,uint256 value,bytes32 dataHash,uint256 nonce,
///      uint256 deadline)`, domain `Game Box`, version `1`, chain id and this account. `dataHash` is
///      `keccak256(data)`. The key signs the raw 32-byte digest (ECDSA P-256 with no prehash; the precompile gets
///      the digest itself as `h`, not its SHA-256), and the signature must have a low `s` (at most n/2 of P-256).
interface IBoxAccount is IERC5267 {
    /// @notice A signed call ran.
    /// @param nonce The nonce it used.
    /// @param target The contract it called.
    /// @param value The wei it sent.
    /// @param dataHash `keccak256` of the calldata.
    event Executed(uint256 indexed nonce, address indexed target, uint256 value, bytes32 dataHash);

    /// @notice The deadline has passed.
    error DeadlineExpired(uint256 deadline);
    /// @notice The nonce was already used.
    error NonceUsed(uint256 nonce);
    /// @notice The P-256 signature does not verify against this account's key, or its `s` is high.
    error InvalidSignature();
    /// @notice The call targets this account itself.
    error SelfCall();

    /// @notice Runs `target.call{value}(data)` if the Box's key signed it. A revert in the target bubbles up with
    ///         its own reason.
    /// @param target The contract to call. Never this account.
    /// @param value The wei to send, from this account's balance.
    /// @param data The calldata.
    /// @param nonce Any unused nonce; each nonce works once, in any order.
    /// @param deadline The last timestamp the call may run at.
    /// @param r The P-256 signature's `r`.
    /// @param s The P-256 signature's `s` (low).
    /// @return result The call's return data.
    function execute(
        address target,
        uint256 value,
        bytes calldata data,
        uint256 nonce,
        uint256 deadline,
        bytes32 r,
        bytes32 s
    ) external returns (bytes memory result);

    /// @notice The EIP-712 digest the Box signs for a call.
    /// @param target The contract to call.
    /// @param value The wei to send.
    /// @param data The calldata (hashed into `dataHash`).
    /// @param nonce The nonce.
    /// @param deadline The deadline.
    /// @return The digest.
    function executeDigest(address target, uint256 value, bytes calldata data, uint256 nonce, uint256 deadline)
        external
        view
        returns (bytes32);

    /// @notice Whether `nonce` has been used.
    /// @param nonce The nonce.
    /// @return True once a call with it ran.
    function nonceUsed(uint256 nonce) external view returns (bool);

    /// @notice The P-256 public key this account is bound to.
    /// @return qx The x coordinate.
    /// @return qy The y coordinate.
    function publicKey() external view returns (bytes32 qx, bytes32 qy);
}
