// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPermissionedResolver} from "../../src/names/IENSv2.sol";
import {NameLib} from "../../src/names/NameLib.sol";
import {NamesScript} from "./NamesScript.sol";

/// @notice The demo operator writes its four keys on `mumbai-01.gamebox.eth`, from its own wallet
///         (`DEMO_OPERATOR_KEY`, which needs a little ETH for gas). Run without `--account`.
contract OperatorRecords is NamesScript {
    function run() external {
        string memory label = "mumbai-01";
        IPermissionedResolver resolver = IPermissionedResolver(_names().getBox(label).resolver);
        bytes memory name = NameLib.dnsName(label);
        vm.startBroadcast(_operatorKey());
        resolver.setText(name, "commission", "500");
        resolver.setText(name, "location", "Mumbai");
        resolver.setText(name, "description", "The Game Box demo Box: stake, tap your badge, play.");
        resolver.setText(name, "games", "stockduel,quickdraw");
        vm.stopBroadcast();
    }
}
