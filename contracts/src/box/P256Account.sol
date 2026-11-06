// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";

import {IP256Account} from "./IP256Account.sol";
import {P256} from "./P256.sol";

/// @title P256Account
/// @notice An account bound to one P-256 key, raw or passkey (see `IP256Account`).
contract P256Account is IP256Account, ERC1155Holder, EIP712 {
    /// @notice The EIP-712 type hash of `Execute`.
    bytes32 public constant EXECUTE_TYPEHASH =
        keccak256("Execute(address target,uint256 value,bytes32 dataHash,uint256 nonce,uint256 deadline)");

    /// @notice The length of a raw signature, `r ‖ s`.
    uint256 internal constant RAW_SIGNATURE_LENGTH = 64;

    bytes32 private _qx;
    bytes32 private _qy;

    /// @inheritdoc IP256Account
    mapping(uint256 nonce => bool used) public nonceUsed;

    /// @param qx The x coordinate of the account's P-256 key.
    /// @param qy The y coordinate of the account's P-256 key.
    constructor(bytes32 qx, bytes32 qy) EIP712("Game Box", "1") {
        _setKey(qx, qy);
    }

    /// @notice Takes ETH, which a call may send on.
    receive() external payable {}

    /// @inheritdoc IP256Account
    function execute(
        address target,
        uint256 value,
        bytes calldata data,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external returns (bytes memory result) {
        bytes32 dataHash = keccak256(data);
        _use(_digest(target, value, dataHash, nonce, deadline), nonce, deadline, signature);
        result = _call(target, value, data);
        emit Executed(nonce, target, value, dataHash);
    }

    /// @inheritdoc IP256Account
    function executeBatch(Call[] calldata calls, uint256 nonce, uint256 deadline, bytes calldata signature)
        external
        returns (bytes[] memory results)
    {
        bytes32 dataHash = keccak256(abi.encode(calls));
        _use(_digest(address(this), 0, dataHash, nonce, deadline), nonce, deadline, signature);
        results = new bytes[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            Call calldata c = calls[i];
            results[i] = _call(c.target, c.value, c.data);
            emit Executed(nonce, c.target, c.value, keccak256(c.data));
        }
        emit ExecutedBatch(nonce, dataHash);
    }

    /// @inheritdoc IP256Account
    function rotateKey(bytes32 qx, bytes32 qy) external {
        if (msg.sender != address(this)) revert OnlySelf();
        _setKey(qx, qy);
    }

    /// @inheritdoc IP256Account
    function executeDigest(address target, uint256 value, bytes calldata data, uint256 nonce, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _digest(target, value, keccak256(data), nonce, deadline);
    }

    /// @inheritdoc IP256Account
    function batchDigest(Call[] calldata calls, uint256 nonce, uint256 deadline) external view returns (bytes32) {
        return _digest(address(this), 0, keccak256(abi.encode(calls)), nonce, deadline);
    }

    /// @inheritdoc IP256Account
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4 magicValue) {
        bool valid = signature.length == RAW_SIGNATURE_LENGTH
            && P256.verify(hash, bytes32(signature[0:32]), bytes32(signature[32:64]), _qx, _qy);
        return valid ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }

    /// @inheritdoc IP256Account
    function publicKey() external view returns (bytes32 qx, bytes32 qy) {
        return (_qx, _qy);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------------------------

    function _digest(address target, uint256 value, bytes32 dataHash, uint256 nonce, uint256 deadline)
        private
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(EXECUTE_TYPEHASH, target, value, dataHash, nonce, deadline)));
    }

    /// @dev Checks the deadline, the nonce and the signature of `digest`, then spends the nonce.
    function _use(bytes32 digest, uint256 nonce, uint256 deadline, bytes calldata signature) private {
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);
        if (nonceUsed[nonce]) revert NonceUsed(nonce);
        if (!_verify(digest, signature)) revert InvalidSignature();
        nonceUsed[nonce] = true;
    }

    /// @dev Raw `r ‖ s` over the digest, or a WebAuthn assertion whose challenge is the digest, user verification
    ///      required. Both refuse a high `s`.
    function _verify(bytes32 digest, bytes calldata signature) private view returns (bool) {
        if (signature.length == RAW_SIGNATURE_LENGTH) {
            return P256.verify(digest, bytes32(signature[0:32]), bytes32(signature[32:64]), _qx, _qy);
        }
        (bool decoded, WebAuthn.WebAuthnAuth calldata auth) = WebAuthn.tryDecodeAuth(signature);
        return decoded && WebAuthn.verify(abi.encodePacked(digest), auth, _qx, _qy, true);
    }

    /// @dev Calls `target`; a revert bubbles up with the target's own reason.
    function _call(address target, uint256 value, bytes calldata data) private returns (bytes memory result) {
        bool ok;
        (ok, result) = target.call{value: value}(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
    }

    function _setKey(bytes32 qx, bytes32 qy) private {
        if (qx == 0 || qy == 0) revert ZeroKey();
        (_qx, _qy) = (qx, qy);
        emit KeyRotated(qx, qy);
    }
}
