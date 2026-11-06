// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {GameBoxNames} from "../../src/names/GameBoxNames.sol";
import {IGameBoxNames} from "../../src/names/IGameBoxNames.sol";
import {NamesScript} from "./NamesScript.sol";

/// @notice Licenses `<BOX_LABEL>.gamebox.eth` for 30 days to a Box whose P-256 public key is `BOX_QX`, `BOX_QY`: the
///         HYP2003 token on the Pi for `mumbai-01`, the demo-box Worker's key for `demo-01`. It deploys the Box's
///         `P256Account` through the factory if it doesn't exist and records it as `.contracts.<BOX_ACCOUNT>`. The
///         operator is `OPERATOR_ACCOUNT`, or the Box's own account when that is unset (no operator passkey exists
///         yet). Skips the licence if it is live.
contract RegisterBox is NamesScript {
    function run() external {
        GameBoxNames names = _names();
        string memory label = vm.envString("BOX_LABEL");
        (bytes32 qx, bytes32 qy) = (vm.envBytes32("BOX_QX"), vm.envBytes32("BOX_QY"));
        address box = _factory().accountOf(qx, qy);
        address operator = vm.envOr("OPERATOR_ACCOUNT", box);

        vm.startBroadcast();
        if (box.code.length == 0) _factory().deploy{gas: CREATE_GAS}(qx, qy);
        IGameBoxNames.Box memory current = names.getBox(label);
        if (current.status == IGameBoxNames.BoxStatus.None || current.expiry <= block.timestamp) {
            names.registerBox{gas: CREATE_GAS}(label, operator, box, qx, qy, uint64(block.timestamp + 30 days));
        }
        vm.stopBroadcast();
        _saveCreatedBy(vm.envString("BOX_ACCOUNT"), box, "P256AccountFactory");
    }
}
