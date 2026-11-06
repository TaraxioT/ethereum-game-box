// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IGameBoxNames} from "../src/names/IGameBoxNames.sol";
import {BoxStaking} from "../src/staking/BoxStaking.sol";
import {Deployments} from "./Deployments.sol";

/// @notice Deploys `BoxStaking` over the recorded GBX, `GameBoxNames` and USDC, with the deployer as admin. Skips it if
///         it is already deployed. The delays are short so a demo can watch them pass.
contract DeployStaking is Deployments {
    uint256 internal constant MIN_OPERATOR_STAKE = 10_000 ether;
    uint64 internal constant UNSTAKE_DELAY = 1 hours;
    uint64 internal constant COMMISSION_DELAY = 1 hours;

    function run() external {
        address gbx = _deployed("GBX");
        address names = _deployed("GameBoxNames");
        address usdc = vm.parseJsonAddress(vm.readFile(PATH), ".external.USDC");
        require(gbx != address(0) && names != address(0), "DeployStaking: GBX and GameBoxNames first");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        BoxStaking staking = BoxStaking(_deployed("BoxStaking"));
        if (address(staking) == address(0)) {
            staking = new BoxStaking(
                IERC20(gbx),
                IERC20(usdc),
                IGameBoxNames(names),
                deployer,
                MIN_OPERATOR_STAKE,
                UNSTAKE_DELAY,
                COMMISSION_DELAY
            );
        }
        vm.stopBroadcast();

        _save("BoxStaking", address(staking));
    }
}
