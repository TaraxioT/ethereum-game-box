// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IDemoLicences} from "./IDemoLicences.sol";
import {IGameBoxNames} from "./IGameBoxNames.sol";

/// @title DemoLicences
/// @notice Opens 10-minute pop-up Boxes linked to the demo Box, for anyone (see `IDemoLicences`).
contract DemoLicences is IDemoLicences {
    /// @inheritdoc IDemoLicences
    uint64 public constant POPUP_TERM = 10 minutes;
    /// @inheritdoc IDemoLicences
    string public constant BOX = "mumbai-01";

    /// @inheritdoc IDemoLicences
    IGameBoxNames public immutable NAMES;

    /// @param names The registrar; this contract needs its `LICENSOR_ROLE`.
    constructor(IGameBoxNames names) {
        NAMES = names;
    }

    /// @inheritdoc IDemoLicences
    function openPopup(string calldata label) external returns (string memory popupLabel) {
        uint64 expiry = uint64(block.timestamp) + POPUP_TERM;
        popupLabel = NAMES.registerPopup(label, BOX, expiry);
        emit PopupOpened(popupLabel, expiry);
    }
}
