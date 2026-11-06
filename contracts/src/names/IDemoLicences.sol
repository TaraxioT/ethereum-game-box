// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IGameBoxNames} from "./IGameBoxNames.sol";

/// @title IDemoLicences
/// @notice A licensor for now: anyone may open a pop-up Box, `popup-<label>.gamebox.eth`, run by the demo Box with a
///         fixed 10-minute licence. It makes expiry something to watch, not something to explain.
interface IDemoLicences {
    /// @notice A pop-up Box was opened.
    /// @param boxLabel The pop-up's full label, `popup-<label>`.
    /// @param expiry When its licence lapses.
    event PopupOpened(string boxLabel, uint64 expiry);

    /// @notice `popup-<label>` breaks the label rule (so `label` is 1 to 26 characters, no hyphen at either end).
    error InvalidLabel(string label);

    /// @notice Registers `popup-<label>.gamebox.eth` to the demo operator, run by the demo Box, for `POPUP_TERM`.
    ///         The registry refuses a label that is still live; once it has lapsed, it works again.
    /// @param label The pop-up's own part of the label.
    /// @return boxLabel The pop-up's full label.
    function openPopup(string calldata label) external returns (string memory boxLabel);

    /// @notice A pop-up's licence: 10 minutes.
    function POPUP_TERM() external view returns (uint64);
    /// @notice The prefix of every pop-up label: `popup-`.
    function PREFIX() external view returns (string memory);
    /// @notice The registrar pop-ups are registered with.
    function NAMES() external view returns (IGameBoxNames);
    /// @notice The demo operator, who owns every pop-up name.
    function OPERATOR() external view returns (address);
    /// @notice The demo Box's `BoxAccount`, which runs every pop-up.
    function BOX() external view returns (address);
}
