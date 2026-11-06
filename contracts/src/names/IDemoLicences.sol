// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IGameBoxNames} from "./IGameBoxNames.sol";

/// @title IDemoLicences
/// @notice A licensor for now: anyone may open a pop-up Box, `popup-<label>.gamebox.eth`, linked to the demo Box
///         `mumbai-01` with a fixed 10-minute licence. It serves `mumbai-01`'s records until it lapses, then falls back
///         to `gamebox.eth`'s default record. It makes record aliasing and expiry something to watch, not something to
///         explain.
interface IDemoLicences {
    /// @notice A pop-up Box was opened.
    /// @param popupLabel The pop-up's full label, `popup-<label>`.
    /// @param expiry When its licence lapses.
    event PopupOpened(string popupLabel, uint64 expiry);

    /// @notice Calls `registerPopup(label, BOX, now + POPUP_TERM)` on `NAMES`. The registry refuses a label that is
    ///         still live; once it has lapsed, it works again. Open to anyone.
    /// @param label The pop-up's own part of the label (1 to 26 characters, no hyphen at either end).
    /// @return popupLabel The pop-up's full label, `popup-<label>`.
    function openPopup(string calldata label) external returns (string memory popupLabel);

    /// @notice A pop-up's licence: 10 minutes.
    function POPUP_TERM() external view returns (uint64);
    /// @notice The demo Box every pop-up links to: `mumbai-01`.
    function BOX() external view returns (string memory);
    /// @notice The registrar pop-ups are registered with. This contract needs its `LICENSOR_ROLE`.
    function NAMES() external view returns (IGameBoxNames);
}
