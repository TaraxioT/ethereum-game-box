// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {P256} from "../../src/box/P256.sol";
import {IStorePot} from "../../src/game/IStorePot.sol";
import {StorePot} from "../../src/game/StorePot.sol";
import {FakeUSDC} from "../../src/token/FakeUSDC.sol";
import {NamesFork} from "../names/NamesFork.sol";

/// @notice Writes `packages/shared/src/store/vectors.json`: the `Stake`, `Verdict`, `Void` and `Judge` digests for fixed
///         inputs, with their signatures. `StorePot` computes the first three and runs each signature. It never sees
///         `Judge`, which the verifier checks off chain, so this test computes that digest from the EIP-712 spec and
///         checks its P-256 signature itself. `messages.test.ts` checks `messages.ts` against it byte for byte.
contract StoreVectorsTest is NamesFork {
    string internal constant PATH = "../packages/shared/src/store/vectors.json";
    string internal constant BOX = "mumbai-01";

    /// @dev A fixed address, so the vectors don't move when the contract's bytecode does.
    address internal constant POT = 0x5555555555555555555555555555555555555555;
    /// @dev anvil's second well-known test key: a throwaway, never a real one.
    uint256 internal constant VERIFIER_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 internal constant DEADLINE = 1_800_000_000;
    uint256 internal constant ROUND = 3;
    uint256 internal constant AMOUNT = 10_000_000;
    bytes32 internal constant EIP712_DOMAIN =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant JUDGE_TYPEHASH =
        keccak256("Judge(string box,uint256 round,bytes32 log,uint256 deadline)");

    StorePot internal store;
    uint256 internal key = p256Key("egb-vector-box");
    bytes32 internal bundle = sha256("the zip of a vector bundle");
    /// @dev Not ASCII, so the hash is pinned to the text's UTF-8 bytes.
    string internal logText = unicode'{"header":{"box":"mumbai-01","round":"3"},"entries":[{"name":"señal"}]}';
    string internal recordText = unicode'{"v":1,"verdict":{"kind":"split","why":"el más rápido"}}';

    function setUp() public override {
        super.setUp();
        (bytes32 qx, bytes32 qy) = p256Public(key);
        vm.startPrank(admin);
        names.registerBox(BOX, operator, address(demoBox), qx, qy, uint64(DEADLINE));
        FakeUSDC usdc = new FakeUSDC(admin, admin);
        deployCodeTo("StorePot.sol:StorePot", abi.encode(names, usdc, admin), POT);
        store = StorePot(POT);
        usdc.setGameSpender(POT);
        store.grantRole(store.LISTER_ROLE(), admin);
        store.grantRole(store.VERIFIER_ROLE(), vm.addr(VERIFIER_KEY));
        store.list(bundle);
        for (uint256 i; i < 4; ++i) {
            usdc.mint(_players()[i], 2 * AMOUNT);
        }
        vm.stopPrank();
    }

    function test_writeVectors() public {
        string memory json = "vectors";
        vm.serializeString(json, "chainId", vm.toString(block.chainid));
        vm.serializeAddress(json, "storePot", POT);
        vm.serializeString(json, "verifierKey", vm.toString(bytes32(VERIFIER_KEY)));
        vm.serializeAddress(json, "verifier", vm.addr(VERIFIER_KEY));
        vm.serializeString(json, "stake", _stake());
        vm.serializeString(json, "verdict", _verdict());
        vm.serializeString(json, "void", _void());
        vm.writeJson(vm.serializeString(json, "judge", _judge()), PATH);
    }

    function _players() internal pure returns (address[] memory players) {
        players = new address[](4);
        players[0] = 0x1111111111111111111111111111111111111111;
        players[1] = 0x2222222222222222222222222222222222222222;
        players[2] = 0x3333333333333333333333333333333333333333;
        players[3] = 0x4444444444444444444444444444444444444444;
    }

    function _stake() internal returns (string memory) {
        IStorePot.Stake memory stake = IStorePot.Stake(BOX, bundle, ROUND, _players(), AMOUNT, DEADLINE);
        bytes32 digest = store.stakeDigest(stake);
        (bytes32 r, bytes32 s) = p256Sign(key, digest);
        store.open(stake, r, s);
        string memory o = "stake";
        vm.serializeString(o, "box", stake.box);
        vm.serializeBytes32(o, "bundle", stake.bundle);
        vm.serializeString(o, "round", vm.toString(stake.round));
        vm.serializeAddress(o, "players", stake.players);
        vm.serializeString(o, "amount", vm.toString(stake.amount));
        vm.serializeString(o, "deadline", vm.toString(stake.deadline));
        vm.serializeBytes32(o, "digest", digest);
        vm.serializeBytes32(o, "r", r);
        return vm.serializeBytes32(o, "s", s);
    }

    /// @dev Pays the pot `_stake` opened: an uneven split with a zero share.
    function _verdict() internal returns (string memory) {
        uint256[] memory payouts = new uint256[](4);
        (payouts[0], payouts[1], payouts[2], payouts[3]) = (25_000_000, 0, 14_000_000, 1_000_000);
        string[] memory shown = new string[](4);
        for (uint256 i; i < 4; ++i) {
            shown[i] = vm.toString(payouts[i]);
        }
        IStorePot.Verdict memory verdict = IStorePot.Verdict(BOX, ROUND, payouts, _recordHash(), DEADLINE);
        bytes32 digest = store.verdictDigest(verdict);
        bytes memory signature = _sign(digest);
        store.settle(verdict, signature);
        string memory o = "verdict";
        vm.serializeString(o, "box", verdict.box);
        vm.serializeString(o, "round", vm.toString(verdict.round));
        vm.serializeString(o, "payouts", shown);
        vm.serializeBytes32(o, "record", verdict.record);
        // As hex: forge would parse the JSON text into an object.
        vm.serializeBytes(o, "recordText", bytes(recordText));
        vm.serializeString(o, "deadline", vm.toString(verdict.deadline));
        vm.serializeBytes32(o, "digest", digest);
        return vm.serializeBytes(o, "signature", signature);
    }

    /// @dev Opens a pot of its own to void, a round after `_stake`'s.
    function _void() internal returns (string memory) {
        IStorePot.Stake memory stake = IStorePot.Stake(BOX, bundle, ROUND + 1, _players(), AMOUNT, DEADLINE);
        (bytes32 r, bytes32 s) = p256Sign(key, store.stakeDigest(stake));
        store.open(stake, r, s);

        IStorePot.Void memory voiding = IStorePot.Void(BOX, ROUND + 1, _recordHash(), DEADLINE);
        bytes32 digest = store.voidDigest(voiding);
        bytes memory signature = _sign(digest);
        store.voidPot(voiding, signature);
        string memory o = "void";
        vm.serializeString(o, "box", voiding.box);
        vm.serializeString(o, "round", vm.toString(voiding.round));
        vm.serializeBytes32(o, "record", voiding.record);
        vm.serializeString(o, "deadline", vm.toString(voiding.deadline));
        vm.serializeBytes32(o, "digest", digest);
        return vm.serializeBytes(o, "signature", signature);
    }

    function _judge() internal returns (string memory) {
        bytes32 log = keccak256(bytes(logText));
        bytes32 domain =
            keccak256(abi.encode(EIP712_DOMAIN, keccak256("Game Box Verifier"), keccak256("1"), block.chainid, POT));
        bytes32 digest = MessageHashUtils.toTypedDataHash(
            domain, keccak256(abi.encode(JUDGE_TYPEHASH, keccak256(bytes(BOX)), ROUND, log, DEADLINE))
        );
        (bytes32 r, bytes32 s) = p256Sign(key, digest);
        (bytes32 qx, bytes32 qy) = p256Public(key);
        assertTrue(P256.verify(digest, r, s, qx, qy));
        string memory o = "judge";
        vm.serializeString(o, "box", BOX);
        vm.serializeString(o, "round", vm.toString(ROUND));
        vm.serializeBytes32(o, "log", log);
        // As hex: forge would parse the JSON text into an object.
        vm.serializeBytes(o, "logText", bytes(logText));
        vm.serializeString(o, "deadline", vm.toString(DEADLINE));
        vm.serializeBytes32(o, "digest", digest);
        vm.serializeBytes32(o, "r", r);
        return vm.serializeBytes32(o, "s", s);
    }

    function _recordHash() internal view returns (bytes32) {
        return keccak256(bytes(recordText));
    }

    function _sign(bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VERIFIER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }
}
