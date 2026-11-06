// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IP256AccountFactory} from "../src/box/IP256AccountFactory.sol";
import {GameBoxNames} from "../src/names/GameBoxNames.sol";
import {IGameBoxNames} from "../src/names/IGameBoxNames.sol";
import {BoxLease} from "../src/staking/BoxLease.sol";
import {Deployments} from "./Deployments.sol";

/// @notice Deploys `BoxLease` over the recorded `GameBoxNames`, GBX and `P256AccountFactory`, and grants it
///         `LICENSOR_ROLE` (the deployer is the names' admin). Skips what is already done.
contract DeployLease is Deployments {
    function run() external {
        GameBoxNames names = GameBoxNames(_deployed("GameBoxNames"));
        address gbx = _deployed("GBX");
        address factory = _deployed("P256AccountFactory");
        require(
            address(names) != address(0) && gbx != address(0) && factory != address(0),
            "DeployLease: GameBoxNames, GBX and P256AccountFactory first"
        );

        vm.startBroadcast();
        BoxLease lease = BoxLease(_deployed("BoxLease"));
        if (address(lease) == address(0)) {
            lease = new BoxLease(IGameBoxNames(address(names)), IERC20(gbx), IP256AccountFactory(factory));
        }
        if (!names.hasRole(names.LICENSOR_ROLE(), address(lease))) {
            names.grantRole(names.LICENSOR_ROLE(), address(lease));
        }
        vm.stopBroadcast();

        _save("BoxLease", address(lease));
    }
}
