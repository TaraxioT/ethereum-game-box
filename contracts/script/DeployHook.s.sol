// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {GameBoxHook} from "../src/hook/GameBoxHook.sol";
import {IGameBoxNames} from "../src/names/IGameBoxNames.sol";
import {Deployments} from "./Deployments.sol";
import {HookMiner} from "./HookMiner.sol";

/// @notice Deploys `GameBoxHook` through the CREATE2 factory, at an address carrying its permission flags, with the
///         deployer as admin, and records the GBX/USDC pool's key as `.pools.GBX_USDC`. Skips the hook if it is already
///         deployed. It doesn't initialize the pool: the launch auction does, at its clearing price.
contract DeployHook is Deployments {
    uint160 internal constant FLAGS = Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG;

    function run() external {
        address gbx = _deployed("GBX");
        address names = _deployed("GameBoxNames");
        address usdc = _deployed("FakeUSDC");
        address poolManager = vm.parseJsonAddress(vm.readFile(PATH), ".external.PoolManager");
        require(
            gbx != address(0) && names != address(0) && usdc != address(0),
            "DeployHook: GBX, GameBoxNames and FakeUSDC first"
        );

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        GameBoxHook hook = GameBoxHook(_deployed("GameBoxHook"));
        if (address(hook) == address(0)) {
            bytes memory args = abi.encode(poolManager, gbx, usdc, names, deployer);
            (address mined, bytes32 salt) =
                HookMiner.find(CREATE2_FACTORY, FLAGS, abi.encodePacked(type(GameBoxHook).creationCode, args));
            hook = new GameBoxHook{salt: salt}(
                IPoolManager(poolManager), IERC20(gbx), IERC20(usdc), IGameBoxNames(names), deployer
            );
            require(address(hook) == mined, "DeployHook: hook address");
        }
        vm.stopBroadcast();

        _save("GameBoxHook", address(hook));
        _savePool(hook.poolKey());
    }

    /// @notice Writes the pool's key and id to `.pools.GBX_USDC`.
    function _savePool(PoolKey memory key) internal {
        string memory entry = "pool-GBX_USDC";
        vm.serializeAddress(entry, "currency0", Currency.unwrap(key.currency0));
        vm.serializeAddress(entry, "currency1", Currency.unwrap(key.currency1));
        vm.serializeUint(entry, "fee", key.fee);
        vm.serializeInt(entry, "tickSpacing", key.tickSpacing);
        vm.serializeAddress(entry, "hooks", address(key.hooks));
        string memory pool = vm.serializeBytes32(entry, "id", keccak256(abi.encode(key)));
        vm.writeJson(vm.serializeString("pools", "GBX_USDC", pool), PATH, ".pools");
    }
}
