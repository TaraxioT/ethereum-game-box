// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPermissionedRegistry, IRegistry} from "../../src/names/IENSv2.sol";
import {NamesScript} from "./NamesScript.sol";

/// @notice Points `gamebox.eth`'s subregistry at the registry `GameBoxNames` created. Only the `.eth` owner of
///         `gamebox.eth` (holding `SET_SUBREGISTRY` on it) can. It changes nothing else on `gamebox.eth`: no role is
///         granted or revoked.
contract PointGameBox is NamesScript {
    uint256 internal constant GAMEBOX = uint256(keccak256("gamebox"));

    function run() external {
        IPermissionedRegistry eth = IPermissionedRegistry(_ens("ETHRegistry"));
        IRegistry registry = IRegistry(address(_names().REGISTRY()));
        vm.startBroadcast();
        (, address sender,) = vm.readCallers();
        require(
            eth.getOwner(GAMEBOX) == sender,
            "PointGameBox: the deployer doesn't own gamebox.eth; move it to the deployer first"
        );
        if (address(eth.getSubregistry("gamebox")) != address(registry)) eth.setSubregistry(GAMEBOX, registry);
        vm.stopBroadcast();
    }
}
