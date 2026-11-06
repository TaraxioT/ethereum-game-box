// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPermissionedResolver, ResolverRoles} from "../../src/names/IENSv2.sol";
import {IPlayerStats} from "../../src/names/IPlayerStats.sol";
import {NameLib} from "../../src/names/NameLib.sol";
import {NamesFork} from "./NamesFork.sol";

/// @notice A player's totals and streak over every game, and `gamebox.eth`'s `leaderboard`.
contract StatsTest is NamesFork {
    string internal constant BOX = "egbt-box";
    address internal alice;
    address internal bob;
    address internal carol;
    uint256 internal round;

    function setUp() public override {
        super.setUp();
        registerBox(BOX, 30 days);
        (alice,) = claim("egbt-alice");
        (bob,) = claim("egbt-bob");
        (carol,) = claim("egbt-carol");
    }

    function _play(string memory game, address winner, address loser, bool draw) internal {
        submit(result(BOX, game, ++round, winner, loser, draw));
    }

    function test_aStreakRunsAcrossGamesAndALossEndsIt() public {
        _play("stockduel", alice, bob, false);
        _play("quickdraw", alice, carol, false);
        _play("stockduel", alice, bob, false);
        IPlayerStats.Totals memory t = stats.totalsOf(alice);
        assertEq(t.wins, 3);
        assertEq(t.streak, 3);
        assertEq(t.best, 3);

        _play("quickdraw", bob, alice, false);
        t = stats.totalsOf(alice);
        assertEq(t.streak, 0);
        assertEq(t.best, 3);
        assertEq(t.losses, 1);
        assertEq(stats.totalsOf(bob).streak, 1);
        assertEq(
            resolveText("egbt-alice.gamebox.eth", "stats"),
            '{"played":4,"wins":3,"losses":1,"draws":0,"streak":0,"best":3,"games":{"stockduel":{"wins":2,"losses":0,"draws":0},"quickdraw":{"wins":1,"losses":1,"draws":0}}}'
        );
    }

    function test_aDrawEndsBothStreaks() public {
        _play("stockduel", alice, bob, false);
        _play("stockduel", bob, carol, false);
        _play("quickdraw", alice, bob, true);
        assertEq(stats.totalsOf(alice).streak, 0);
        assertEq(stats.totalsOf(alice).best, 1);
        assertEq(stats.totalsOf(bob).streak, 0);
        assertEq(stats.totalsOf(bob).draws, 1);
    }

    function test_theLeaderboardIsARecordOnGameboxEth() public {
        _play("stockduel", alice, bob, false);
        _play("stockduel", carol, bob, false);
        _play("quickdraw", carol, alice, false);
        address[] memory top = stats.leaders();
        assertEq(top.length, 3);
        assertEq(top[0], carol);
        assertEq(top[1], alice);
        assertEq(top[2], bob);
        string memory board = resolveText("gamebox.eth", "leaderboard");
        assertEq(board, stats.leaderboardText());
        assertEq(
            board,
            string.concat(
                '[{"name":"egbt-carol.gamebox.eth","played":2,"wins":2,"losses":0,"draws":0,"streak":2,"best":2},',
                '{"name":"egbt-alice.gamebox.eth","played":2,"wins":1,"losses":1,"draws":0,"streak":0,"best":1},',
                '{"name":"egbt-bob.gamebox.eth","played":2,"wins":0,"losses":2,"draws":0,"streak":0,"best":0}]'
            )
        );
        // A free name still reads the default record: only `gamebox.eth` itself has a record of its own now.
        assertEq(resolveText("egbt-free.gamebox.eth", "description"), "This Game Box name is free.");
    }

    function test_equalWinsRankWhoReachedThemFirst() public {
        _play("stockduel", alice, carol, false);
        _play("stockduel", bob, carol, false);
        assertEq(stats.leaders()[0], alice);
        _play("stockduel", bob, carol, false);
        assertEq(stats.leaders()[0], bob);
    }

    function test_theLeaderboardKeepsTheTopTen() public {
        address[] memory players = new address[](12);
        for (uint256 i; i < 12; ++i) {
            (players[i],) = claim(string.concat("egbt-p", vm.toString(i)));
        }
        // p0..p10 each win once against p11; p11 never wins, so it falls off once ten players have a win.
        for (uint256 i; i < 11; ++i) {
            _play("stockduel", players[i], players[11], false);
        }
        address[] memory top = stats.leaders();
        assertEq(top.length, stats.TOP());
        assertEq(top[0], players[0]);
        for (uint256 i; i < top.length; ++i) {
            assertTrue(top[i] != players[11]);
        }
        // p10 came last with one win and the room was full of one-win players who reached it first.
        assertTrue(top[9] != players[10]);
        _play("quickdraw", players[10], players[11], false);
        assertEq(stats.leaders()[0], players[10]);
    }

    function test_aRefusedLeaderboardWriteNeverBlocksAResult() public {
        vm.prank(ENS_DEPLOYER);
        IPermissionedResolver(gameboxResolver)
            .revokeRoles(ResolverRoles.textResource("leaderboard"), ResolverRoles.SET_TEXT, address(stats));

        vm.expectEmit(address(stats));
        emit IPlayerStats.LeaderboardSkipped();
        _play("stockduel", alice, bob, false);
        assertEq(stats.totalsOf(alice).wins, 1);
        assertEq(resolveAddr("champion.stockduel.gamebox.eth"), alice);
        assertEq(resolveText("gamebox.eth", "leaderboard"), "");
    }

    function test_onlyTheLeaderboardKey() public {
        vm.prank(address(stats));
        vm.expectRevert();
        IPermissionedResolver(gameboxResolver).setText(NameLib.PARENT_DNS, "description", "x");
    }
}
