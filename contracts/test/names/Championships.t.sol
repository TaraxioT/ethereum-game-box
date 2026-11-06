// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import {IBoxResults} from "../../src/names/IBoxResults.sol";
import {IChampionships} from "../../src/names/IChampionships.sol";
import {
    Grant,
    IPermissionedRegistry,
    IPermissionedResolver,
    RegistryRoles,
    ResolverRoles
} from "../../src/names/IENSv2.sol";
import {NameLib} from "../../src/names/NameLib.sol";
import {NamesFork} from "./NamesFork.sol";

contract ChampionshipsTest is NamesFork {
    string internal constant BOX = "egbt-box";
    string internal constant GAME = "stockduel";
    string internal constant CUP = "egbt-cup";
    string internal constant CUP_NAME = "egbt-cup.stockduel.gamebox.eth";
    uint256 internal constant PRIZE = 100e6;
    uint256 internal constant ALL_RESOLVER_ROLES = ResolverRoles.SET_TEXT | ResolverRoles.SET_TEXT_ADMIN
        | ResolverRoles.SET_ADDRESS | ResolverRoles.SET_ADDRESS_ADMIN;

    address[6] internal players;
    uint64 internal ends;
    uint256 internal round;

    function setUp() public override {
        super.setUp();
        registerBox(BOX, 30 days);
        string[6] memory labels = ["egbt-p0", "egbt-p1", "egbt-p2", "egbt-p3", "egbt-p4", "egbt-p5"];
        for (uint256 i; i < 6; ++i) {
            (players[i],) = claim(labels[i]);
        }
        ends = uint64(block.timestamp + 30 minutes);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------------------------------------------------------

    function _open() internal returns (uint256 id) {
        vm.startPrank(admin);
        fakeUsdc.mint(admin, PRIZE);
        fakeUsdc.approve(address(cups), PRIZE);
        id = cups.open(GAME, CUP, ends, PRIZE);
        vm.stopPrank();
    }

    function _titles() internal view returns (IPermissionedRegistry) {
        return IPermissionedRegistry(names.getGame(GAME).titleRegistry);
    }

    function _play(uint256 winner, uint256 loser, bool draw) internal {
        submit(result(BOX, GAME, ++round, players[winner], players[loser], draw));
    }

    function _row(uint256 p, uint256 points, uint256 wins, uint256 draws, uint256 losses)
        internal
        view
        returns (string memory)
    {
        return string.concat(
            '{"name":"egbt-p',
            vm.toString(p),
            '.gamebox.eth","addr":"',
            vm.toString(players[p]),
            '","points":',
            vm.toString(points),
            ',"wins":',
            vm.toString(wins),
            ',"draws":',
            vm.toString(draws),
            ',"losses":',
            vm.toString(losses),
            "}"
        );
    }

    function _assertTop(uint256 id, uint256[] memory order) internal view {
        address[] memory t = cups.top(id);
        assertEq(t.length, order.length, "top length");
        for (uint256 i; i < order.length; ++i) {
            assertEq(t[i], players[order[i]], "rank");
        }
    }

    function _order(uint256 a, uint256 b) internal pure returns (uint256[] memory o) {
        o = new uint256[](2);
        (o[0], o[1]) = (a, b);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Open
    // ----------------------------------------------------------------------------------------------------------------

    function test_openRegistersTheNameWithItsOwnResolver() public {
        vm.startPrank(admin);
        fakeUsdc.mint(admin, PRIZE);
        fakeUsdc.approve(address(cups), PRIZE);
        vm.expectEmit(true, false, false, false, address(cups));
        emit IChampionships.CupOpened(1, GAME, CUP, address(0), ends, PRIZE, admin);
        uint256 id = cups.open(GAME, CUP, ends, PRIZE);
        vm.stopPrank();

        assertEq(id, 1);
        assertEq(cups.openCup(GAME), 1);
        assertEq(cups.cupCount(), 1);
        IChampionships.Cup memory c = cups.getCup(id);
        assertEq(c.game, GAME);
        assertEq(c.label, CUP);
        assertEq(c.opener, admin);
        assertEq(c.ends, ends);
        assertEq(c.prize, PRIZE);
        assertFalse(c.closed);

        IPermissionedRegistry titles = _titles();
        uint256 labelId = NameLib.id(CUP);
        assertEq(titles.getOwner(labelId), address(cups));
        assertEq(titles.getExpiry(labelId), ends + 1 days);
        assertEq(titles.getResolver(CUP), c.resolver);
        assertEq(titles.roles(titles.getResource(labelId), address(cups)), 0, "no token roles");

        assertEq(resolveResolver(CUP_NAME), c.resolver);
        assertEq(resolveText(CUP_NAME, "ends"), vm.toString(ends));
        assertEq(resolveText(CUP_NAME, "prize"), "100000000");
        assertEq(resolveText(CUP_NAME, "standings"), "[]");
        assertEq(resolveText(CUP_NAME, "leader"), "");

        // Only the championships contract holds a role on the resolver, and nobody holds UPGRADE.
        IPermissionedResolver r = IPermissionedResolver(c.resolver);
        assertEq(r.roles(0, address(cups)), ALL_RESOLVER_ROLES);
        assertEq(r.roleCount(0), ALL_RESOLVER_ROLES);
        assertEq(fakeUsdc.balanceOf(address(cups)), PRIZE);
        assertEq(fakeUsdc.balanceOf(admin), 0);
    }

    function test_openRefusals() public {
        address stranger = account("stranger");
        bytes32 role = cups.DEFAULT_ADMIN_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, role)
        );
        vm.prank(stranger);
        cups.open(GAME, CUP, ends, PRIZE);

        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(IChampionships.UnknownGame.selector, "egbt-nogame"));
        cups.open("egbt-nogame", CUP, ends, 0);
        vm.expectRevert(abi.encodeWithSelector(IChampionships.InvalidLabel.selector, "champion"));
        cups.open(GAME, "champion", ends, 0);
        vm.expectRevert(abi.encodeWithSelector(IChampionships.InvalidLabel.selector, "Cup"));
        cups.open(GAME, "Cup", ends, 0);
        vm.expectRevert(abi.encodeWithSelector(IChampionships.EndsInPast.selector, uint64(block.timestamp)));
        cups.open(GAME, CUP, uint64(block.timestamp), 0);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(cups), 0, PRIZE)
        );
        cups.open(GAME, CUP, ends, PRIZE);

        cups.open(GAME, CUP, ends, 0);
        vm.expectRevert(abi.encodeWithSelector(IChampionships.CupAlreadyOpen.selector, GAME, 1));
        cups.open(GAME, "egbt-cup-2", ends, 0);
        // Another game may run its own at the same time, but not on a label its registry holds.
        cups.open("quickdraw", "egbt-cup-q", ends, 0);
        vm.stopPrank();
    }

    function test_aClosedLabelCantBeOpenedAgain() public {
        _open();
        _play(0, 1, false);
        vm.warp(ends);
        cups.close(GAME);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IPermissionedRegistry.LabelAlreadyRegistered.selector, CUP));
        cups.open(GAME, CUP, ends + 1 hours, 0);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Score
    // ----------------------------------------------------------------------------------------------------------------

    function test_scoringWritesStandingsLeaderAndAddr() public {
        uint256 id = _open();
        _play(0, 1, false); // p0 3
        assertEq(
            resolveText(CUP_NAME, "standings"), string.concat("[", _row(0, 3, 1, 0, 0), ",", _row(1, 0, 0, 0, 1), "]")
        );
        assertEq(resolveText(CUP_NAME, "leader"), "egbt-p0.gamebox.eth");
        assertEq(resolveAddr(CUP_NAME), players[0]);

        _play(2, 3, true); // p2 1, p3 1
        _play(2, 0, false); // p2 4
        assertEq(
            resolveText(CUP_NAME, "standings"),
            string.concat(
                "[",
                _row(2, 4, 1, 1, 0),
                ",",
                _row(0, 3, 1, 0, 1),
                ",",
                _row(3, 1, 0, 1, 0),
                ",",
                _row(1, 0, 0, 0, 1),
                "]"
            )
        );
        assertEq(resolveText(CUP_NAME, "leader"), "egbt-p2.gamebox.eth");
        assertEq(resolveAddr(CUP_NAME), players[2]);
        assertEq(cups.standingsText(id), resolveText(CUP_NAME, "standings"));
        IChampionships.Entry memory e = cups.entryOf(id, players[2]);
        assertEq(e.points, 4);
        assertEq(e.wins, 1);
        assertEq(e.draws, 1);
        assertEq(e.losses, 0);
    }

    function test_tiebreakMostPoints() public {
        uint256 id = _open();
        _play(1, 2, false); // p1 3
        _play(0, 3, false); // p0 3
        _play(0, 4, true); // p0 4
        uint256[] memory o = new uint256[](5);
        (o[0], o[1], o[2], o[3], o[4]) = (0, 1, 4, 2, 3);
        _assertTop(id, o);
    }

    function test_tiebreakMostWins() public {
        uint256 id = _open();
        // p0 reaches 3 points first, by three draws; p1 reaches 3 points later, with one win.
        _play(0, 2, true);
        _play(0, 3, true);
        _play(0, 4, true);
        _play(1, 5, false);
        address[] memory t = cups.top(id);
        assertEq(t[0], players[1], "more wins ranks first");
        assertEq(t[1], players[0]);
        assertEq(cups.entryOf(id, players[0]).points, cups.entryOf(id, players[1]).points);
    }

    function test_tiebreakReachedFirst() public {
        uint256 id = _open();
        _play(1, 2, false); // p1 reaches 3 first
        _play(0, 3, false); // p0 reaches 3 second
        assertEq(cups.top(id)[0], players[1]);
        _play(0, 4, false); // p0 6
        _play(1, 5, false); // p1 6, second to get there
        assertEq(cups.top(id)[0], players[0]);
        assertEq(cups.top(id)[1], players[1]);
        assertEq(resolveText(CUP_NAME, "leader"), "egbt-p0.gamebox.eth");
    }

    function test_standingsHoldTheTopFive() public {
        uint256 id = _open();
        _play(0, 1, false);
        _play(2, 3, false);
        _play(4, 1, true);
        // p0 3, p2 3, p4 1, p1 1, p3 0: five rows; p5 isn't listed until it plays and passes the fifth.
        assertEq(cups.top(id).length, 5);
        _play(5, 3, true);
        // p5 1 ties p1 and p4 on points and wins but reached it last: it enters only by passing p3 (0).
        uint256[] memory o = new uint256[](5);
        (o[0], o[1], o[2], o[3], o[4]) = (0, 2, 4, 1, 5);
        _assertTop(id, o);
    }

    function test_scoreDoesNothingWithoutAnOpenChampionship() public {
        _play(0, 1, false);
        uint256 id = _open();
        vm.warp(ends);
        _play(0, 1, false);
        assertEq(cups.top(id).length, 0);
        assertEq(resolveText(CUP_NAME, "standings"), "[]");
    }

    function test_onlyARefereeScores() public {
        _open();
        address stranger = account("stranger");
        vm.expectRevert(abi.encodeWithSelector(IChampionships.NotReferee.selector, stranger));
        vm.prank(stranger);
        cups.score(GAME, stranger, players[0], false);
    }

    function test_aScoringFailureNeverBlocksAResult() public {
        _open();
        vm.mockCallRevert(address(cups), abi.encodeWithSelector(IChampionships.score.selector), "boom");
        vm.expectEmit(address(results));
        emit IBoxResults.ScoreSkipped(BOX, 1);
        _play(0, 1, false);
        assertEq(names.getTitle(GAME).holder, players[0]);
        assertEq(stats.statsOf(players[0], GAME).wins, 1);
    }

    function test_tooLittleGasCantForceASkip() public {
        _open();
        IBoxResults.Result memory r = result(BOX, GAME, 1, players[0], players[1], false);
        (bytes32 sr, bytes32 ss) = p256Sign(boxKey, results.resultDigest(r));
        vm.expectRevert(IBoxResults.InsufficientGas.selector);
        results.submit{gas: 2_800_000}(r, sr, ss);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Close
    // ----------------------------------------------------------------------------------------------------------------

    function test_closeRefusals() public {
        vm.expectRevert(abi.encodeWithSelector(IChampionships.NoOpenCup.selector, GAME));
        cups.close(GAME);
        _open();
        vm.warp(ends - 1);
        vm.expectRevert(abi.encodeWithSelector(IChampionships.NotOver.selector, ends));
        cups.close(GAME);
    }

    function test_closePaysTheWinnerAndGivesThemTheNameForGood() public {
        uint256 id = _open();
        _play(0, 1, false);
        _play(2, 0, false);
        _play(2, 1, false);
        vm.warp(ends);

        address closer = account("closer");
        vm.expectEmit(address(cups));
        emit IChampionships.CupClosed(id, GAME, CUP, players[2], PRIZE);
        vm.prank(closer);
        assertEq(cups.close(GAME), players[2]);

        assertEq(fakeUsdc.balanceOf(players[2]), PRIZE);
        assertEq(fakeUsdc.balanceOf(address(cups)), 0);
        assertEq(cups.openCup(GAME), 0);
        IChampionships.Cup memory c = cups.getCup(id);
        assertTrue(c.closed);
        assertEq(c.winner, players[2]);

        IPermissionedRegistry titles = _titles();
        uint256 labelId = NameLib.id(CUP);
        assertEq(titles.getOwner(labelId), players[2]);
        assertEq(titles.getExpiry(labelId), type(uint64).max);
        assertEq(titles.getResolver(CUP), c.resolver);
        // Token roles 0: the winner can't transfer the name or re-point it.
        uint256 token = titles.getTokenId(labelId);
        assertEq(titles.roles(titles.getResource(labelId), players[2]), 0);
        vm.startPrank(players[2]);
        vm.expectRevert(abi.encodeWithSelector(IPermissionedRegistry.TransferDisallowed.selector, token, players[2]));
        titles.unsafeTransfer(players[0], token, "");
        vm.expectRevert();
        titles.setResolver(labelId, address(1));
        vm.stopPrank();

        // Long after (yet before `gamebox.eth` itself expires): the records are still the final ones.
        vm.warp(ends + 300 days);
        string memory standings =
            string.concat("[", _row(2, 6, 2, 0, 0), ",", _row(0, 3, 1, 0, 1), ",", _row(1, 0, 0, 0, 2), "]");
        assertEq(resolveText(CUP_NAME, "standings"), standings);
        assertEq(resolveText(CUP_NAME, "winner"), "egbt-p2.gamebox.eth");
        assertEq(resolveText(CUP_NAME, "leader"), "egbt-p2.gamebox.eth");
        assertEq(resolveText(CUP_NAME, "ends"), vm.toString(ends));
        assertEq(resolveText(CUP_NAME, "prize"), "100000000");
        assertEq(resolveAddr(CUP_NAME), players[2]);
    }

    /// @dev The proof the site's Try grid shows: after close, nobody holds a role on the championship's resolver, and
    ///      every write to it reverts for every account, the championships contract and the deployer included.
    function test_nobodyCanWriteAClosedChampionship() public {
        uint256 id = _open();
        _play(0, 1, false);
        vm.warp(ends);
        cups.close(GAME);
        IPermissionedResolver r = IPermissionedResolver(cups.getCup(id).resolver);

        // No role on any resource: the root, every key we wrote, and `addr`.
        string[6] memory keys = ["ends", "prize", "standings", "leader", "winner", "url"];
        assertEq(r.roleCount(0), 0, "root");
        for (uint256 k; k < keys.length; ++k) {
            assertEq(r.roleCount(ResolverRoles.textResource(keys[k])), 0, keys[k]);
        }
        assertEq(r.roleCount(ResolverRoles.addressResource(COIN_TYPE_ETH)), 0, "addr");

        address[] memory everyone = _everyone(address(r));
        for (uint256 i; i < everyone.length; ++i) {
            assertEq(r.roles(0, everyone[i]), 0, "root roles");
            assertEq(r.roles(ResolverRoles.textResource("standings"), everyone[i]), 0, "standings roles");
            _assertEveryWriteReverts(r, everyone[i]);
        }
        assertEq(resolveText(CUP_NAME, "winner"), "egbt-p0.gamebox.eth");
    }

    function test_closeWithNoPlayersReturnsThePrize() public {
        uint256 id = _open();
        vm.warp(ends);
        vm.expectEmit(address(cups));
        emit IChampionships.CupClosed(id, GAME, CUP, address(0), PRIZE);
        assertEq(cups.close(GAME), address(0));
        assertEq(fakeUsdc.balanceOf(admin), PRIZE);
        assertEq(uint8(_titles().getStatus(NameLib.id(CUP))), uint8(IPermissionedRegistry.Status.AVAILABLE));
        assertEq(IPermissionedResolver(cups.getCup(id).resolver).roleCount(0), 0);
        assertEq(resolveText(CUP_NAME, "standings"), "");
    }

    function test_closeAfterTheNameLapsed() public {
        _open();
        _play(3, 4, false);
        vm.warp(ends + 2 days);
        assertEq(_titles().getOwner(NameLib.id(CUP)), address(0));
        assertEq(cups.close(GAME), players[3]);
        assertEq(_titles().getOwner(NameLib.id(CUP)), players[3]);
        assertEq(resolveText(CUP_NAME, "winner"), "egbt-p3.gamebox.eth");
    }

    function test_theNextChampionshipLeavesTheLastOneAlone() public {
        uint256 first = _open();
        _play(0, 1, false);
        vm.warp(ends);
        cups.close(GAME);

        ends = uint64(block.timestamp + 30 minutes);
        vm.prank(admin);
        uint256 second = cups.open(GAME, "egbt-cup-2", ends, 0);
        assertEq(second, first + 1);
        _play(1, 0, false);
        assertEq(resolveText("egbt-cup-2.stockduel.gamebox.eth", "leader"), "egbt-p1.gamebox.eth");
        assertEq(resolveText(CUP_NAME, "winner"), "egbt-p0.gamebox.eth");
        assertEq(resolveAddr(CUP_NAME), players[0]);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // The title, alongside
    // ----------------------------------------------------------------------------------------------------------------

    function test_theTitleStillMovesAndItsOldTokenIsGone() public {
        _open();
        uint256 champion = NameLib.id("champion");
        IPermissionedRegistry titles = _titles();
        _play(0, 1, false);
        uint256 first = titles.getTokenId(champion);
        assertEq(titles.ownerOf(first), players[0]);
        _play(1, 0, false);
        uint256 second = titles.getTokenId(champion);
        assertTrue(second != first);
        assertEq(titles.ownerOf(first), address(0));
        assertEq(titles.ownerOf(second), players[1]);
        assertEq(resolveAddr("champion.stockduel.gamebox.eth"), players[1]);
        // Both results scored the championship too.
        assertEq(
            resolveText(CUP_NAME, "standings"), string.concat("[", _row(0, 3, 1, 0, 1), ",", _row(1, 3, 1, 0, 1), "]")
        );
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Frozen-record helpers
    // ----------------------------------------------------------------------------------------------------------------

    function _everyone(address resolver) internal view returns (address[] memory a) {
        a = new address[](16);
        (a[0], a[1], a[2], a[3]) = (address(cups), admin, ENS_DEPLOYER, address(names));
        (a[4], a[5], a[6], a[7]) = (address(results), address(stats), address(pot), address(seats));
        (a[8], a[9], a[10], a[11]) = (address(registry), address(_titles()), address(ensFactory), resolver);
        (a[12], a[13], a[14], a[15]) = (players[0], players[1], operator, address(demoBox));
    }

    function _assertEveryWriteReverts(IPermissionedResolver r, address who) internal {
        bytes memory name = dns(CUP_NAME);
        bytes[] memory writes = new bytes[](14);
        writes[0] = abi.encodeCall(IPermissionedResolver.setText, (name, "winner", "x"));
        writes[1] = abi.encodeCall(IPermissionedResolver.setText, (name, "standings", "[]"));
        writes[2] = abi.encodeCall(IPermissionedResolver.setAddress, (name, COIN_TYPE_ETH, abi.encodePacked(who)));
        writes[3] = abi.encodeWithSignature("setContenthash(bytes,bytes)", name, hex"01");
        writes[4] = abi.encodeWithSignature("setData(bytes,string,bytes)", name, "x", hex"01");
        writes[5] = abi.encodeWithSignature("setABI(bytes,uint256,bytes)", name, 1, hex"01");
        writes[6] = abi.encodeWithSignature("setInterface(bytes,bytes4,address)", name, bytes4(0x01ffc9a7), who);
        writes[7] = abi.encodeWithSignature("setName(bytes,string)", name, "x.eth");
        writes[8] = abi.encodeCall(IPermissionedResolver.linkToNode, (name, NameLib.node("egbt-p1")));
        writes[9] = abi.encodeCall(IPermissionedResolver.linkToRecord, (name, 0));
        writes[10] = abi.encodeWithSignature("grantRootRoles(uint256,address)", ResolverRoles.SET_TEXT, who);
        writes[11] = abi.encodeCall(
            IPermissionedResolver.grantSetterRoles,
            (abi.encodeCall(IPermissionedResolver.setText, (name, "winner", "")), who)
        );
        writes[12] = abi.encodeWithSignature("upgradeToAndCall(address,bytes)", resolverImpl, "");
        writes[13] = abi.encodeCall(IPermissionedResolver.initialize, (new Grant[](0), new bytes[](0)));
        for (uint256 i; i < writes.length; ++i) {
            vm.prank(who);
            (bool ok,) = address(r).call(writes[i]);
            assertFalse(ok, string.concat("write ", vm.toString(i), " by ", vm.toString(who)));
        }
    }
}
