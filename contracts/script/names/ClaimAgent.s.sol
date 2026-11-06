// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {GameBoxNames} from "../../src/names/GameBoxNames.sol";
import {IPermissionedResolver} from "../../src/names/IENSv2.sol";
import {NameLib} from "../../src/names/NameLib.sol";
import {NamesScript} from "./NamesScript.sol";

/// @notice The practice opponent claims `bot.gamebox.eth` with its own `ClaimName` signature (the deployer submits it,
///         as the relayer will for badges). `claim()` does that; `records()` then has the agent write its ENSIP-26
///         records from its own wallet (`AGENT_PRIVATE_KEY`, which needs a little ETH for gas).
contract ClaimAgent is NamesScript {
    string internal constant LABEL = "bot";

    function claim() external {
        GameBoxNames names = _names();
        address agent = vm.addr(_agentKey());
        if (bytes(names.labelOf(agent)).length != 0) return;
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_agentKey(), names.claimDigest(LABEL, agent, deadline));
        vm.broadcast();
        names.claimPlayer(LABEL, agent, deadline, abi.encodePacked(r, s, v));
    }

    function records() external {
        IPermissionedResolver resolver = IPermissionedResolver(_names().REGISTRY().getResolver(LABEL));
        bytes memory name = NameLib.dnsName(LABEL);
        vm.startBroadcast(_agentKey());
        resolver.setText(
            name,
            "agent-context",
            "# bot.gamebox.eth\n\nThe Game Box's practice opponent. Tap your badge against me at any Box to play a "
            "practice round of Stock Duel or Quick Draw. My results count like any player's: they write my `stats` "
            "record and can win me a champion title. This name, its records and its permissions are mine; the game may "
            "write only `stats`."
        );
        resolver.setText(name, "description", "The Game Box practice opponent");
        vm.stopBroadcast();
    }
}
