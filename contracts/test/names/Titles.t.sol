// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {IPermissionedRegistry} from "../../src/names/IENSv2.sol";
import {IGameBoxNames} from "../../src/names/IGameBoxNames.sol";
import {NameLib} from "../../src/names/NameLib.sol";
import {NamesFork} from "./NamesFork.sol";

contract TitlesTest is NamesFork {
    string internal constant BOX = "egbt-box";
    string internal constant STOCK_TITLE = "champion.stockduel.gamebox.eth";
    string internal constant QUICK_TITLE = "champion.quickdraw.gamebox.eth";
    uint256 internal constant CHAMPION = uint256(keccak256("champion"));

    address internal alice;
    address internal bob;

    function setUp() public override {
        super.setUp();
        registerBox(BOX, 30 days);
        (alice,) = claim("egbt-alice");
        (bob,) = claim("egbt-bob");
    }

    function _titleRegistry(string memory game) internal view returns (IPermissionedRegistry) {
        return IPermissionedRegistry(names.getGame(game).titleRegistry);
    }

    function test_gamesHaveTheirOwnTitleRegistries() public view {
        IPermissionedRegistry stock = _titleRegistry("stockduel");
        assertEq(address(registry.getSubregistry("stockduel")), address(stock));
        assertEq(registry.getResolver("stockduel"), names.GAME_RESOLVER());
        assertEq(registry.getOwner(NameLib.id("stockduel")), address(names));
        assertEq(names.getGame("stockduel").titleTerm, 7 days);
        assertEq(names.getGame("quickdraw").titleTerm, 15 minutes);
        assertEq(resolveText("stockduel.gamebox.eth", "title"), STOCK_TITLE);
        assertEq(resolveText("stockduel.gamebox.eth", "titleTerm"), "604800");
        // A title registry holds UNREGISTER, to move titles, so it is not emancipated.
        assertFalse(stock.isEmancipated());
    }

    function test_crownMoveAndRepeat() public {
        IPermissionedRegistry titles = _titleRegistry("stockduel");
        uint256 start = block.timestamp;

        // Crowned.
        vm.expectEmit(address(names));
        emit IGameBoxNames.Crowned("stockduel", alice, address(0), 1, 1, uint64(start + 7 days));
        submit(result(BOX, "stockduel", 1, alice, bob, false));
        uint256 aliceToken = titles.getTokenId(CHAMPION);
        assertEq(titles.ownerOf(aliceToken), alice);
        assertEq(resolveAddr(STOCK_TITLE), alice);
        assertEq(resolveText(STOCK_TITLE, "holder"), "egbt-alice.gamebox.eth");
        assertEq(resolveText(STOCK_TITLE, "start"), vm.toString(start));

        // Moved to Bob: Alice's token is gone.
        vm.warp(start + 1 days);
        vm.expectEmit(address(names));
        emit IGameBoxNames.Crowned("stockduel", bob, alice, 2, 1, uint64(start + 8 days));
        submit(result(BOX, "stockduel", 2, bob, alice, false));
        uint256 bobToken = titles.getTokenId(CHAMPION);
        assertTrue(bobToken != aliceToken);
        assertEq(titles.ownerOf(aliceToken), address(0));
        assertEq(titles.balanceOf(alice, aliceToken), 0);
        assertEq(titles.ownerOf(bobToken), bob);
        assertEq(resolveAddr(STOCK_TITLE), bob);
        assertEq(resolveText(STOCK_TITLE, "holder"), "egbt-bob.gamebox.eth");
        assertEq(resolveText(STOCK_TITLE, "streak"), "1");

        // Bob wins again: streak and term extend, the token stays.
        vm.warp(start + 2 days);
        submit(result(BOX, "stockduel", 3, bob, alice, false));
        assertEq(titles.getTokenId(CHAMPION), bobToken);
        assertEq(titles.getExpiry(CHAMPION), start + 9 days);
        assertEq(resolveText(STOCK_TITLE, "streak"), "2");
        assertEq(resolveText(STOCK_TITLE, "round"), "3");
        assertEq(resolveText(STOCK_TITLE, "start"), vm.toString(start + 1 days));
        IGameBoxNames.Title memory t = names.getTitle("stockduel");
        assertEq(t.holder, bob);
        assertEq(t.streak, 2);
        assertEq(t.round, 3);
        assertEq(t.start, start + 1 days);
        assertEq(t.expiry, start + 9 days);
    }

    function test_titlesAreNonTransferable() public {
        submit(result(BOX, "stockduel", 1, alice, bob, false));
        IPermissionedRegistry titles = _titleRegistry("stockduel");
        uint256 token = titles.getTokenId(CHAMPION);
        assertEq(titles.roles(CHAMPION, alice), 0);

        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(IPermissionedRegistry.TransferDisallowed.selector, token, alice));
        titles.unsafeTransfer(bob, token, "");
        // The safe transfer stops one check earlier, since the title registry isn't emancipated.
        vm.expectRevert(IPermissionedRegistry.TransferUnsafeUntilRegistryIsEmancipated.selector);
        titles.safeTransferFrom(alice, bob, token, 1, "");
        vm.stopPrank();
        assertEq(titles.ownerOf(token), alice);
    }

    function test_theNextWinnerTakesALapsedTitle() public {
        submit(result(BOX, "stockduel", 1, alice, bob, false));
        vm.warp(block.timestamp + 7 days);
        assertEq(resolveAddr(STOCK_TITLE), address(0));

        // Alice wins again after the lapse: a fresh streak, not a renewal.
        vm.expectEmit(address(names));
        emit IGameBoxNames.Crowned("stockduel", alice, address(0), 2, 1, uint64(block.timestamp + 7 days));
        submit(result(BOX, "stockduel", 2, alice, bob, false));
        assertEq(resolveAddr(STOCK_TITLE), alice);
        assertEq(resolveText(STOCK_TITLE, "streak"), "1");

        // And after the next lapse, Bob takes it.
        vm.warp(block.timestamp + 7 days);
        submit(result(BOX, "stockduel", 3, bob, alice, false));
        assertEq(resolveAddr(STOCK_TITLE), bob);
        assertEq(resolveText(STOCK_TITLE, "holder"), "egbt-bob.gamebox.eth");
    }

    function test_quickDrawTitleExpiresAfter15Minutes() public {
        uint256 crowned = block.timestamp;
        submit(result(BOX, "quickdraw", 1, alice, bob, false));
        assertEq(_titleRegistry("quickdraw").getExpiry(CHAMPION), crowned + 15 minutes);
        vm.warp(crowned + 15 minutes - 1);
        assertEq(resolveAddr(QUICK_TITLE), alice);
        vm.warp(crowned + 15 minutes);
        assertEq(resolveAddr(QUICK_TITLE), address(0));
        assertEq(resolveText(QUICK_TITLE, "holder"), "");
        // The Stock Duel title is untouched: it was never won.
        assertEq(resolveAddr(STOCK_TITLE), address(0));
    }

    function test_crownRefusals() public {
        address stranger = account("stranger");
        bytes32 referee = names.REFEREE_ROLE();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, referee)
        );
        names.crown("stockduel", alice, 1);

        vm.startPrank(address(results));
        vm.expectRevert(abi.encodeWithSelector(IGameBoxNames.UnknownGame.selector, "egbt-nogame"));
        names.crown("egbt-nogame", alice, 1);
        vm.expectRevert(abi.encodeWithSelector(IGameBoxNames.NotAPlayer.selector, stranger));
        names.crown("stockduel", stranger, 1);
        vm.stopPrank();
    }

    function test_addGameRefusals() public {
        address stranger = account("stranger");
        bytes32 adminRole = names.DEFAULT_ADMIN_ROLE();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, adminRole)
        );
        names.addGame("egbt-game", 1 days);

        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(IGameBoxNames.GameExists.selector, "stockduel"));
        names.addGame("stockduel", 1 days);
        vm.expectRevert(IGameBoxNames.ZeroValue.selector);
        names.addGame("egbt-game", 0);
        vm.expectRevert(abi.encodeWithSelector(IGameBoxNames.InvalidLabel.selector, "x"));
        names.addGame("x", 1 days);
        vm.stopPrank();
    }
}
