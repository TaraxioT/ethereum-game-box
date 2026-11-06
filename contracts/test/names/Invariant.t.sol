// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {BoxResults} from "../../src/names/BoxResults.sol";
import {GameBoxNames} from "../../src/names/GameBoxNames.sol";
import {IBoxResults} from "../../src/names/IBoxResults.sol";
import {IPermissionedResolver, ResolverRoles} from "../../src/names/IENSv2.sol";
import {P256Keys} from "../box/P256Keys.sol";
import {NamesFork} from "./NamesFork.sol";

/// @notice Random claims, results and revocations.
contract NamesHandler is Test, P256Keys {
    GameBoxNames internal immutable NAMES;
    BoxResults internal immutable RESULTS;
    address internal immutable STATS;
    uint256 internal immutable BOX_KEY;

    address[] public players;
    address[] public resolvers;
    uint256 internal round;

    constructor(GameBoxNames names, BoxResults results, address stats, uint256 boxKey) {
        NAMES = names;
        RESULTS = results;
        STATS = stats;
        BOX_KEY = boxKey;
    }

    function resolverCount() external view returns (uint256) {
        return resolvers.length;
    }

    function claim() external {
        string memory label = string.concat("egbt-p", vm.toString(players.length));
        (address badge, uint256 key) = makeAddrAndKey(string.concat("egb-test-invariant-", label));
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, NAMES.claimDigest(label, badge, deadline));
        resolvers.push(NAMES.claimPlayer(label, badge, deadline, abi.encodePacked(r, s, v)));
        players.push(badge);
    }

    function play(uint256 a, uint256 b, bool draw, bool quick) external {
        if (players.length < 2) return;
        a = bound(a, 0, players.length - 1);
        b = bound(b, 0, players.length - 2);
        if (b >= a) ++b;
        IBoxResults.Result memory res = IBoxResults.Result(
            "egbt-box",
            quick ? "quickdraw" : "stockduel",
            ++round,
            players[a],
            players[b],
            draw,
            block.timestamp + 1 hours
        );
        (bytes32 r, bytes32 s) = p256Sign(BOX_KEY, RESULTS.resultDigest(res));
        RESULTS.submit(res, r, s);
    }

    function revoke(uint256 a) external {
        if (players.length == 0) return;
        a = bound(a, 0, players.length - 1);
        vm.prank(players[a]);
        IPermissionedResolver(resolvers[a])
            .revokeRoles(ResolverRoles.textResource("stats"), ResolverRoles.SET_TEXT, STATS);
    }

    function wait(uint16 minutes_) external {
        vm.warp(block.timestamp + uint256(minutes_ % 30) * 1 minutes);
    }
}

contract InvariantTest is NamesFork {
    NamesHandler internal handler;

    function setUp() public override {
        super.setUp();
        registerBox("egbt-box", 365 days);
        handler = new NamesHandler(names, results, address(stats), boxKey);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 12
    /// forge-config: default.invariant.depth = 16
    function invariant_gameBoxNamesHoldsNoRoleOnAPlayerResolver() public view {
        uint256[3] memory resources =
            [0, ResolverRoles.textResource("stats"), ResolverRoles.addressResource(COIN_TYPE_ETH)];
        for (uint256 i; i < handler.resolverCount(); ++i) {
            IPermissionedResolver resolver = IPermissionedResolver(handler.resolvers(i));
            for (uint256 j; j < resources.length; ++j) {
                assertEq(resolver.roles(resources[j], address(names)), 0);
            }
            // And PlayerStats never holds more than SET_TEXT on `stats`.
            assertEq(resolver.roles(0, address(stats)), 0);
            assertEq(resolver.roles(resources[1], address(stats)) & ~ResolverRoles.SET_TEXT, 0);
        }
    }
}
