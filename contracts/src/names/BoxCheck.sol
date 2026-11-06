// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {P256} from "../box/P256.sol";
import {IBoxSigned} from "./IBoxSigned.sol";
import {IGameBoxNames} from "./IGameBoxNames.sol";

/// @title BoxCheck
/// @notice The checks behind `IBoxSigned`: a live, `Active` Box's key, and a P-256 signature by it.
library BoxCheck {
    /// @notice The P-256 key of `box`, which must be registered, unexpired and `Active`.
    function liveKey(IGameBoxNames names, string calldata box) internal view returns (bytes32 qx, bytes32 qy) {
        IGameBoxNames.Box memory b = names.getBox(box);
        if (b.status == IGameBoxNames.BoxStatus.None) revert IBoxSigned.UnknownBox(box);
        if (block.timestamp >= b.expiry) revert IBoxSigned.BoxExpired(box);
        if (b.status != IGameBoxNames.BoxStatus.Active) revert IBoxSigned.BoxNotActive(box);
        return (b.qx, b.qy);
    }

    /// @notice Reverts `InvalidSignature` unless `(r, s)` is a low-`s` P-256 signature of `digest` by `(qx, qy)`.
    function verify(bytes32 digest, bytes32 r, bytes32 s, bytes32 qx, bytes32 qy) internal view {
        if (!P256.verify(digest, r, s, qx, qy)) revert IBoxSigned.InvalidSignature();
    }

    /// @notice Reverts `DeadlineExpired` once `deadline` has passed.
    function before(uint256 deadline) internal view {
        if (block.timestamp > deadline) revert IBoxSigned.DeadlineExpired(deadline);
    }
}
