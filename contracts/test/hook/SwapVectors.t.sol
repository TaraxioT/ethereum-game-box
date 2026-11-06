// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {GameBoxHook} from "../../src/hook/GameBoxHook.sol";
import {IGameBoxHook} from "../../src/hook/IGameBoxHook.sol";
import {P256Keys} from "../box/P256Keys.sol";

/// @notice Writes `packages/shared/src/swap/vectors.json`: a `TapSwap` digest for fixed inputs as `GameBoxHook` computes
///         it, the Box's P-256 signature of it (raw digest, low `s`) and the hook data that carries it.
///         `tapSwap.test.ts` checks `tapSwap.ts` against it byte for byte.
contract SwapVectorsTest is Test, P256Keys {
    string internal constant PATH = "../packages/shared/src/swap/vectors.json";

    /// @dev A fixed address whose low 14 bits are the hook's flags (`afterInitialize`, `beforeSwap`), so the vectors
    ///      don't move when the hook's bytecode does.
    address internal constant HOOK = 0x4444444444444444444444444444444444441080;
    address internal constant BADGE = 0x2222222222222222222222222222222222222222;
    address internal constant ROUTER = 0x3333333333333333333333333333333333333333;
    uint256 internal constant DEADLINE = 1_800_000_000;

    function test_writeVectors() public {
        vm.chainId(11_155_111);
        deployCodeTo(
            "GameBoxHook.sol:GameBoxHook", abi.encode(address(1), address(2), address(3), address(4), address(5)), HOOK
        );
        uint256 key = p256Key("egb-vector-box");
        IGameBoxHook.TapSwap memory swap = IGameBoxHook.TapSwap({
            box: "mumbai-01",
            badge: BADGE,
            sender: ROUTER,
            zeroForOne: true,
            amountSpecified: -25e6,
            nonce: 7,
            deadline: DEADLINE
        });
        bytes32 digest = GameBoxHook(HOOK).tapSwapDigest(swap);
        (bytes32 r, bytes32 s) = p256Sign(key, digest);
        bytes memory hookData = abi.encode(
            IGameBoxHook.TapSwapData({box: swap.box, badge: BADGE, nonce: swap.nonce, deadline: DEADLINE, r: r, s: s})
        );

        string memory o = "tapSwap";
        vm.serializeString(o, "chainId", vm.toString(block.chainid));
        vm.serializeAddress(o, "hook", HOOK);
        vm.serializeString(o, "box", swap.box);
        vm.serializeAddress(o, "badge", BADGE);
        vm.serializeAddress(o, "sender", ROUTER);
        vm.serializeBool(o, "zeroForOne", swap.zeroForOne);
        vm.serializeString(o, "amountSpecified", vm.toString(swap.amountSpecified));
        vm.serializeString(o, "nonce", vm.toString(swap.nonce));
        vm.serializeString(o, "deadline", vm.toString(DEADLINE));
        vm.serializeBytes32(o, "digest", digest);
        vm.serializeBytes32(o, "r", r);
        vm.serializeBytes32(o, "s", s);
        vm.writeJson(vm.serializeBytes(o, "hookData", hookData), PATH);
    }
}
