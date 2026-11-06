// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {GameBoxNames} from "../../src/names/GameBoxNames.sol";
import {IGameBoxNames} from "../../src/names/IGameBoxNames.sol";
import {NamesScript} from "./NamesScript.sol";

/// @notice Licenses `mumbai-01.gamebox.eth` for 30 days to the operator's `P256Account` (`OPERATOR_ACCOUNT`), run by
///         the demo Box's account with its key (`DEMO_BOX_QX`, `DEMO_BOX_QY`). The operator writes its first records
///         from the operator site, and the Box its heartbeat through the relayer. Skips the licence if it is live.
contract RegisterBox is NamesScript {
    string internal constant LABEL = "mumbai-01";

    function run() external {
        GameBoxNames names = _names();
        (bytes32 qx, bytes32 qy) = _boxPublicKey();
        address box = _factory().accountOf(qx, qy);
        require(box.code.length != 0, "the demo Box's account is not deployed: run DeployNames first");
        address operator = vm.envAddress("OPERATOR_ACCOUNT");
        require(operator.code.length != 0, "OPERATOR_ACCOUNT has no code: deploy the operator's P256Account first");

        IGameBoxNames.Box memory current = names.getBox(LABEL);
        if (current.status != IGameBoxNames.BoxStatus.None && current.expiry > block.timestamp) return;
        vm.broadcast();
        names.registerBox{gas: CREATE_GAS}(LABEL, operator, box, qx, qy, uint64(block.timestamp + 30 days));
    }
}
