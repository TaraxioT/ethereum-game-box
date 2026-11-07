// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {console} from "forge-std/console.sol";

import {IGameBoxHook} from "../src/hook/IGameBoxHook.sol";
import {IFakeUSDC} from "../src/token/IFakeUSDC.sol";
import {Deployments} from "./Deployments.sol";
import {GbxPool} from "./uniswap/GbxPool.sol";
import {IPermit2} from "./uniswap/IPermit2.sol";
import {IPositionManager} from "./uniswap/IPositionManager.sol";
import {PoolSeed} from "./uniswap/PoolSeed.sol";

/// @notice Opens the GBX/USDC pool at 0.10 USDC per GBX and deposits its first, full-range liquidity, owned by the
///         deployer as a `PositionManager` position. The deployer pays the GBX and mints the USDC (it is
///         `FakeUSDC`'s minter). Safe to run again: it skips what is already done.
contract SeedPool is Deployments {
    function run() external {
        address gbx = _deployed("GBX");
        address usdc = _deployed("FakeUSDC");
        address hook = _deployed("GameBoxHook");
        require(gbx != address(0) && usdc != address(0) && hook != address(0), "SeedPool: GBX, FakeUSDC and hook first");
        string memory json = vm.readFile(PATH);
        PoolKey memory key = IGameBoxHook(hook).poolKey();
        bool gbxIsToken0 = Currency.unwrap(key.currency0) == gbx;

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        uint256 usdcHeld = IERC20(usdc).balanceOf(deployer);
        if (usdcHeld < GbxPool.SEED_USDC) IFakeUSDC(usdc).mint(deployer, GbxPool.SEED_USDC - usdcHeld);
        uint256 tokenId = PoolSeed.seed(
            PoolSeed.Seed({
                manager: IPoolManager(vm.parseJsonAddress(json, ".external.PoolManager")),
                positions: IPositionManager(vm.parseJsonAddress(json, ".external.PositionManager")),
                permit2: IPermit2(vm.parseJsonAddress(json, ".external.Permit2")),
                key: key,
                sqrtPriceX96: GbxPool.sqrtPriceX96(gbxIsToken0),
                tickRange: GbxPool.FULL_RANGE_TICK,
                amount0: gbxIsToken0 ? GbxPool.SEED_GBX : GbxPool.SEED_USDC,
                amount1: gbxIsToken0 ? GbxPool.SEED_USDC : GbxPool.SEED_GBX,
                owner: deployer
            })
        );
        vm.stopBroadcast();

        if (tokenId == 0) console.log("SeedPool: the pool already has liquidity");
        else console.log("SeedPool: opened the pool, position", tokenId);
    }
}
