// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Championships} from "../../src/names/Championships.sol";
import {FakeUSDC} from "../../src/token/FakeUSDC.sol";
import {NamesScript} from "./NamesScript.sol";

/// @notice Opens `<CUP_LABEL>.<CUP_GAME>.gamebox.eth` for `CUP_MINUTES` minutes with a prize of `CUP_PRIZE` whole USDC
///         (defaults: `stockduel`, 30 minutes, 100 USDC). It first closes the game's championship if one has ended, and
///         mints the deployer whatever USDC the prize needs beyond its balance. The deployer is `Championships`' admin
///         and USDC's minter. Pick a fresh label each time: a closed championship's name is its winner's for good.
contract OpenChampionship is NamesScript {
    function run() external {
        Championships cups = Championships(_deployed("Championships"));
        FakeUSDC usdc = FakeUSDC(_deployed("FakeUSDC"));
        require(address(cups) != address(0) && address(usdc) != address(0), "run DeployNames first");
        string memory label = vm.envString("CUP_LABEL");
        string memory game = vm.envOr("CUP_GAME", string("stockduel"));
        uint256 prize = vm.envOr("CUP_PRIZE", uint256(100)) * 10 ** usdc.decimals();
        uint64 ends = uint64(block.timestamp + vm.envOr("CUP_MINUTES", uint256(30)) * 1 minutes);

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        uint256 open = cups.openCup(game);
        if (open != 0 && cups.getCup(open).ends <= block.timestamp) cups.close{gas: CREATE_GAS}(game);
        uint256 balance = usdc.balanceOf(deployer);
        if (balance < prize) usdc.mint(deployer, prize - balance);
        if (usdc.allowance(deployer, address(cups)) < prize) usdc.approve(address(cups), prize);
        cups.open{gas: CREATE_GAS}(game, label, ends, prize);
        vm.stopBroadcast();
    }
}
