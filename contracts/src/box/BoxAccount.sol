// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {IBoxAccount} from "./IBoxAccount.sol";
import {P256} from "./P256.sol";

/// @title BoxAccount
/// @notice A Box's on-chain account, bound to one P-256 key. It runs the calls that key signed; anyone may submit them.
contract BoxAccount is IBoxAccount, EIP712 {
    /// @notice The EIP-712 type hash of `Execute`.
    bytes32 public constant EXECUTE_TYPEHASH =
        keccak256("Execute(address target,uint256 value,bytes32 dataHash,uint256 nonce,uint256 deadline)");

    bytes32 private immutable QX;
    bytes32 private immutable QY;

    /// @inheritdoc IBoxAccount
    mapping(uint256 nonce => bool used) public nonceUsed;

    /// @param qx The x coordinate of the Box's P-256 key.
    /// @param qy The y coordinate of the Box's P-256 key.
    constructor(bytes32 qx, bytes32 qy) EIP712("Game Box", "1") {
        QX = qx;
        QY = qy;
    }

    /// @notice Takes ETH, which `execute` may send on.
    receive() external payable {}

    /// @inheritdoc IBoxAccount
    function execute(
        address target,
        uint256 value,
        bytes calldata data,
        uint256 nonce,
        uint256 deadline,
        bytes32 r,
        bytes32 s
    ) external returns (bytes memory result) {
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);
        if (target == address(this)) revert SelfCall();
        if (nonceUsed[nonce]) revert NonceUsed(nonce);
        if (!P256.verify(executeDigest(target, value, data, nonce, deadline), r, s, QX, QY)) {
            revert InvalidSignature();
        }
        nonceUsed[nonce] = true;

        bool ok;
        (ok, result) = target.call{value: value}(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
        emit Executed(nonce, target, value, keccak256(data));
    }

    /// @inheritdoc IBoxAccount
    function executeDigest(address target, uint256 value, bytes calldata data, uint256 nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(EXECUTE_TYPEHASH, target, value, keccak256(data), nonce, deadline))
        );
    }

    /// @inheritdoc IBoxAccount
    function publicKey() external view returns (bytes32 qx, bytes32 qy) {
        return (QX, QY);
    }
}
