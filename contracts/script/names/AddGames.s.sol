// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {GameBoxNames} from "../../src/names/GameBoxNames.sol";
import {NamesScript} from "./NamesScript.sol";

/// @notice Adds `stockduel.gamebox.eth` and `stockduel-uniswap.gamebox.eth` (titles last 7 days) and
///         `quickdraw.gamebox.eth` (15 minutes), each with its own title registry. Skips a game that exists.
contract AddGames is NamesScript {
    function run() external {
        GameBoxNames names = _names();
        vm.startBroadcast();
        _add(names, "stockduel", 7 days);
        _add(names, "quickdraw", 15 minutes);
        _add(names, "stockduel-uniswap", 7 days);
        vm.stopBroadcast();
        _saveAddress(".names.titles.stockduel", names.getGame("stockduel").titleRegistry);
        _saveAddress(".names.titles.quickdraw", names.getGame("quickdraw").titleRegistry);
        _saveAddress(".names.titles.stockduel-uniswap", names.getGame("stockduel-uniswap").titleRegistry);
    }

    function _add(GameBoxNames names, string memory label, uint64 term) internal {
        if (names.getGame(label).titleRegistry == address(0)) names.addGame{gas: CREATE_GAS}(label, term);
    }
}
