// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IERC5267} from "@openzeppelin/contracts/interfaces/IERC5267.sol";

/// @title IP256Account
/// @notice An account bound to one P-256 key: the Box (its HYP2003 token), an operator or the admin (a passkey), or
///         an agent (a Worker secret). It runs calls the key signed, and anyone may submit them; the relayer does,
///         and pays the gas. It can own names (ERC-1155 receiver) and sign for itself (ERC-1271).
/// @dev The signed message is EIP-712 `Execute(address target,uint256 value,bytes32 dataHash,uint256 nonce,
///      uint256 deadline)`, domain `Game Box`, version `1`, the chain id and this account.
///      - `execute` signs the call itself: `dataHash` is `keccak256(data)`.
///      - `executeBatch` signs `target` = this account, `value` = 0 and `dataHash` = `keccak256(abi.encode(calls))`.
///        `abi.encode(calls)` starts with four zero bytes, which match no function here, so a batch signature never
///        runs as a single call.
///
///      A signature is one of two forms, told apart by length:
///      - **raw** (64 bytes, `r ‖ s`): ECDSA P-256 over the 32-byte digest itself, with no prehash. The precompile gets
///        the digest as `h`. This is what the HYP2003 (`CKM_ECDSA`) and a Worker key sign.
///      - **WebAuthn** (anything else): `abi.encode(r, s, challengeIndex, typeIndex, authenticatorData,
///        clientDataJSON)` (the fields of OpenZeppelin's `WebAuthn.WebAuthnAuth`, in order, with no outer offset),
///        a passkey assertion whose challenge is the
///        digest (base64url, no padding), with `"type":"webauthn.get"` and the user-present and user-verified flags
///        set. It is checked by OpenZeppelin's `WebAuthn.verify` over `sha256(authenticatorData ‖
///        sha256(clientDataJSON))`.
///
///      Either way `s` must be low (at most n/2 of P-256): normalise it before submitting.
interface IP256Account is IERC5267, IERC1271 {
    /// @notice One call of a batch.
    /// @param target The contract to call.
    /// @param value The wei to send, from this account's balance.
    /// @param data The calldata.
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    /// @notice A signed call ran.
    /// @param nonce The nonce it used.
    /// @param target The contract it called.
    /// @param value The wei it sent.
    /// @param dataHash `keccak256` of the calldata.
    event Executed(uint256 indexed nonce, address indexed target, uint256 value, bytes32 dataHash);
    /// @notice A signed batch ran (each of its calls also emits `Executed` with the batch's nonce).
    /// @param nonce The nonce it used.
    /// @param dataHash `keccak256(abi.encode(calls))`.
    event ExecutedBatch(uint256 indexed nonce, bytes32 dataHash);
    /// @notice The account's key was set: at deploy, and by `rotateKey`. The old key no longer signs anything.
    /// @param qx The new key's x coordinate.
    /// @param qy The new key's y coordinate.
    event KeyRotated(bytes32 qx, bytes32 qy);

    /// @notice The deadline has passed.
    error DeadlineExpired(uint256 deadline);
    /// @notice The nonce was already used.
    error NonceUsed(uint256 nonce);
    /// @notice The signature does not verify against this account's key, its `s` is high, or (WebAuthn) its
    ///         challenge, type or flags are wrong.
    error InvalidSignature();
    /// @notice Only the account itself (a signed call to itself) may do this.
    error OnlySelf();
    /// @notice A key coordinate is zero.
    error ZeroKey();

    /// @notice Runs `target.call{value}(data)` if the key signed it. A revert in the target bubbles up with its own
    ///         reason, and the nonce stays unused.
    /// @param target The contract to call. The account itself, for `rotateKey`.
    /// @param value The wei to send, from this account's balance.
    /// @param data The calldata.
    /// @param nonce Any unused nonce; each nonce works once, in any order.
    /// @param deadline The last timestamp the call may run at.
    /// @param signature Raw (`r ‖ s`, 64 bytes) or WebAuthn (the encoded assertion).
    /// @return result The call's return data.
    function execute(
        address target,
        uint256 value,
        bytes calldata data,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external returns (bytes memory result);

    /// @notice Runs every call in order, all or none, if the key signed the list: one signature (one passkey prompt)
    ///         for several writes.
    /// @param calls The calls.
    /// @param nonce Any unused nonce.
    /// @param deadline The last timestamp the batch may run at.
    /// @param signature Raw or WebAuthn, over `batchDigest(calls, nonce, deadline)`.
    /// @return results Each call's return data.
    function executeBatch(Call[] calldata calls, uint256 nonce, uint256 deadline, bytes calldata signature)
        external
        returns (bytes[] memory results);

    /// @notice Moves the account to a new P-256 key. Only the account itself may call it, so the current key signs it
    ///         (an `execute` with `target` = this account). The account keeps its address; `P256AccountFactory`'s
    ///         `accountOf` still answers for the original key.
    /// @param qx The new key's x coordinate.
    /// @param qy The new key's y coordinate.
    function rotateKey(bytes32 qx, bytes32 qy) external;

    /// @notice The EIP-712 digest the key signs for `execute`.
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

    /// @notice The EIP-712 digest the key signs for `executeBatch`: `Execute` with this account as `target`, `value`
    ///         0 and `dataHash` = `keccak256(abi.encode(calls))`.
    /// @param calls The calls.
    /// @param nonce The nonce.
    /// @param deadline The deadline.
    /// @return The digest.
    function batchDigest(Call[] calldata calls, uint256 nonce, uint256 deadline) external view returns (bytes32);

    /// @notice ERC-1271: `0x1626ba7e` if `signature` is a raw P-256 signature (`r ‖ s`, low `s`) of `hash` by the
    ///         current key, otherwise `0xffffffff`. This is how the account signs a `ClaimName`.
    /// @param hash The 32 bytes signed.
    /// @param signature `r ‖ s`, 64 bytes.
    /// @return magicValue `0x1626ba7e` or `0xffffffff`.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4 magicValue);

    /// @notice Whether `nonce` has been used.
    /// @param nonce The nonce.
    /// @return True once a call or batch with it ran.
    function nonceUsed(uint256 nonce) external view returns (bool);

    /// @notice The P-256 key the account is bound to now.
    /// @return qx The x coordinate.
    /// @return qy The y coordinate.
    function publicKey() external view returns (bytes32 qx, bytes32 qy);
}
