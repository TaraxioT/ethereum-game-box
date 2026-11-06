// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BoxAccount} from "../../src/box/BoxAccount.sol";
import {GameBoxNames} from "../../src/names/GameBoxNames.sol";
import {IPermissionedResolver} from "../../src/names/IENSv2.sol";
import {IGameBoxNames} from "../../src/names/IGameBoxNames.sol";
import {NameLib} from "../../src/names/NameLib.sol";
import {NamesScript} from "./NamesScript.sol";

/// @notice Licenses `mumbai-01.gamebox.eth` for 30 days to the demo operator, run by the demo Box, then sends the demo
///         Box's first heartbeat (`lastSeen` and `game`) through its `BoxAccount`. The deployer submits the Box's signed
///         calls for now; the relayer does later. Skips the licence if it is live.
contract RegisterBox is NamesScript {
    string internal constant LABEL = "mumbai-01";

    function run() external {
        GameBoxNames names = _names();
        BoxAccount box = _demoBox();
        vm.startBroadcast();
        IGameBoxNames.Box memory current = names.getBox(LABEL);
        if (current.status == IGameBoxNames.BoxStatus.None || current.expiry <= block.timestamp) {
            (bytes32 qx, bytes32 qy) = _boxPublicKey();
            names.registerBox(LABEL, vm.addr(_operatorKey()), address(box), qx, qy, uint64(block.timestamp + 30 days));
        }
        vm.stopBroadcast();

        address resolver = names.getBox(LABEL).resolver;
        bytes memory name = NameLib.dnsName(LABEL);
        _heartbeat(box, resolver, abi.encodeCall(IPermissionedResolver.setText, (name, "game", "stockduel")));
        _heartbeat(
            box,
            resolver,
            abi.encodeCall(IPermissionedResolver.setText, (name, "lastSeen", vm.toString(block.timestamp)))
        );
    }

    /// @dev Signs `data` with the demo Box's P-256 key and submits it through the Box's account.
    function _heartbeat(BoxAccount box, address resolver, bytes memory data) internal {
        uint256 nonce = uint256(keccak256(abi.encode(block.timestamp, data)));
        uint256 deadline = block.timestamp + 1 hours;
        (bytes32 r, bytes32 s) = _boxSign(box.executeDigest(resolver, 0, data, nonce, deadline));
        vm.broadcast();
        box.execute(resolver, 0, data, nonce, deadline, r, s);
    }
}
