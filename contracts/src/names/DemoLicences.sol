// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IBoxAccount} from "../box/IBoxAccount.sol";
import {IDemoLicences} from "./IDemoLicences.sol";
import {IGameBoxNames} from "./IGameBoxNames.sol";
import {NameLib} from "./NameLib.sol";

/// @title DemoLicences
/// @notice Opens 10-minute pop-up Boxes, run by the demo Box, for anyone (see `IDemoLicences`).
contract DemoLicences is IDemoLicences {
    /// @inheritdoc IDemoLicences
    uint64 public constant POPUP_TERM = 10 minutes;
    /// @inheritdoc IDemoLicences
    string public constant PREFIX = "popup-";

    /// @inheritdoc IDemoLicences
    IGameBoxNames public immutable NAMES;
    /// @inheritdoc IDemoLicences
    address public immutable OPERATOR;
    /// @inheritdoc IDemoLicences
    address public immutable BOX;

    /// @param names The registrar; this contract needs its `LICENSOR_ROLE`.
    /// @param operator The demo operator, who owns every pop-up name.
    /// @param box The demo Box's `BoxAccount`.
    constructor(IGameBoxNames names, address operator, address box) {
        NAMES = names;
        OPERATOR = operator;
        BOX = box;
    }

    /// @inheritdoc IDemoLicences
    function openPopup(string calldata label) external returns (string memory boxLabel) {
        boxLabel = string.concat(PREFIX, label);
        if (bytes(label).length == 0 || bytes(label)[0] == "-" || !NameLib.isValidLabel(boxLabel)) {
            revert InvalidLabel(label);
        }
        (bytes32 qx, bytes32 qy) = IBoxAccount(BOX).publicKey();
        uint64 expiry = uint64(block.timestamp) + POPUP_TERM;
        NAMES.registerBox(boxLabel, OPERATOR, BOX, qx, qy, expiry);
        emit PopupOpened(boxLabel, expiry);
    }
}
