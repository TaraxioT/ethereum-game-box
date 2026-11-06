// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {IDemoLicences} from "../../src/names/IDemoLicences.sol";
import {IPermissionedRegistry, IPermissionedResolver} from "../../src/names/IENSv2.sol";
import {IGameBoxNames} from "../../src/names/IGameBoxNames.sol";
import {NameLib} from "../../src/names/NameLib.sol";
import {NamesFork} from "./NamesFork.sol";

/// @notice Pop-up Boxes: record aliasing through `linkToNode`, and expiry.
contract PopupsTest is NamesFork {
    string internal constant BOX = "mumbai-01";
    string internal constant BOX_NAME = "mumbai-01.gamebox.eth";
    string internal constant POPUP = "popup-egbt";
    string internal constant POPUP_NAME = "popup-egbt.gamebox.eth";

    string[8] internal keys =
        ["boxKey", "status", "commission", "location", "description", "games", "lastSeen", "game"];

    address internal boxResolver;

    function setUp() public override {
        super.setUp();
        boxResolver = registerBox(BOX, 30 days);
        bytes memory name = NameLib.dnsName(BOX);
        vm.startPrank(operator);
        IPermissionedResolver(boxResolver).setText(name, "commission", "500");
        IPermissionedResolver(boxResolver).setText(name, "location", "Mumbai");
        IPermissionedResolver(boxResolver).setText(name, "description", "The demo Box");
        IPermissionedResolver(boxResolver).setText(name, "games", "stockduel,quickdraw");
        vm.stopPrank();
        vm.startPrank(address(demoBox));
        IPermissionedResolver(boxResolver).setText(name, "lastSeen", "1762400000");
        IPermissionedResolver(boxResolver).setText(name, "game", "quickdraw");
        vm.stopPrank();
    }

    function test_openPopupRegistersForExactly10MinutesWithTheBoxsResolver() public {
        uint256 opened = block.timestamp;
        uint256 records = IPermissionedResolver(boxResolver).getRecordCount();
        vm.expectEmit(address(names));
        emit IGameBoxNames.PopupRegistered(POPUP, BOX, operator, uint64(opened + 10 minutes));
        vm.expectEmit(address(licences));
        emit IDemoLicences.PopupOpened(POPUP, uint64(opened + 10 minutes));
        vm.prank(account("visitor"));
        assertEq(licences.openPopup("egbt"), POPUP);

        IGameBoxNames.Popup memory popup = names.getPopup(POPUP);
        assertEq(popup.ofBox, BOX);
        assertEq(popup.expiry, opened + 600);
        assertEq(registry.getOwner(NameLib.id(POPUP)), operator);
        assertEq(registry.getExpiry(NameLib.id(POPUP)), opened + 600);
        // No new resolver, and no new record: the pop-up uses mumbai-01's.
        assertEq(registry.getResolver(POPUP), boxResolver);
        assertEq(IPermissionedResolver(boxResolver).getRecordCount(), records);
        assertEq(
            IPermissionedResolver(boxResolver).getRecordId(namehash(POPUP_NAME)),
            IPermissionedResolver(boxResolver).getRecordId(namehash(BOX_NAME))
        );
        // A pop-up is not a Box of its own.
        assertEq(uint8(names.getBox(POPUP).status), uint8(IGameBoxNames.BoxStatus.None));

        vm.warp(opened + 600 - 1);
        assertEq(resolveAddr(POPUP_NAME), address(demoBox));
        vm.warp(opened + 600);
        assertEq(resolveAddr(POPUP_NAME), address(0));
    }

    /// @dev Through the Universal Resolver the pop-up answers exactly as mumbai-01, and an operator's change shows on
    ///      both at once.
    function test_aPopupServesTheBoxsRecords() public {
        licences.openPopup("egbt");
        assertEq(resolveAddr(POPUP_NAME), address(demoBox));
        for (uint256 i; i < keys.length; ++i) {
            assertEq(resolveText(POPUP_NAME, keys[i]), resolveText(BOX_NAME, keys[i]), keys[i]);
            assertTrue(bytes(resolveText(POPUP_NAME, keys[i])).length != 0, keys[i]);
        }
        vm.prank(operator);
        IPermissionedResolver(boxResolver).setText(NameLib.dnsName(BOX), "location", "Stage B");
        assertEq(resolveText(POPUP_NAME, "location"), "Stage B");
        assertEq(resolveText(BOX_NAME, "location"), "Stage B");
    }

    /// @dev After the pop-up lapses it resolves through `gamebox.eth`'s default record; mumbai-01 is unaffected.
    function test_aLapsedPopupFallsBackToTheDefault() public {
        licences.openPopup("egbt");
        vm.warp(block.timestamp + 10 minutes);
        assertEq(resolveAddr(POPUP_NAME), address(0));
        assertEq(resolveText(POPUP_NAME, "description"), "This Game Box name is free.");
        assertEq(resolveText(POPUP_NAME, "url"), "https://gamebox-names.pages.dev/#/players");
        assertEq(resolveText(POPUP_NAME, "location"), "");
        assertEq(resolveResolver(POPUP_NAME), gameboxResolver);
        assertEq(resolveAddr(BOX_NAME), address(demoBox));
        assertEq(resolveText(BOX_NAME, "location"), "Mumbai");
    }

    function test_aLivePopupLabelIsRefused() public {
        licences.openPopup("egbt");
        vm.warp(block.timestamp + 10 minutes - 1);
        vm.expectRevert(abi.encodeWithSelector(IPermissionedRegistry.LabelAlreadyRegistered.selector, POPUP));
        licences.openPopup("egbt");
    }

    function test_aLapsedPopupLabelWorksAgain() public {
        licences.openPopup("egbt");
        vm.warp(block.timestamp + 10 minutes);
        licences.openPopup("egbt");
        assertEq(names.getPopup(POPUP).expiry, block.timestamp + 10 minutes);
        assertEq(registry.getResolver(POPUP), boxResolver);
        assertEq(resolveAddr(POPUP_NAME), address(demoBox));
        assertEq(resolveText(POPUP_NAME, "location"), "Mumbai");
    }

    function test_popupLabelRule() public {
        string[5] memory bad = ["", "-egbt", "Egbt", "egbt.x", "abcdefghijklmnopqrstuvwxyz0"];
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(IGameBoxNames.InvalidLabel.selector, bad[i]));
            licences.openPopup(bad[i]);
        }
        // 26 characters is the longest: popup- plus 26 is 32.
        licences.openPopup("abcdefghijklmnopqrstuvwxyz");
        // One character works, since the rule applies to the full label.
        licences.openPopup("x");
    }

    function test_registerPopupRefusals() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        address stranger = account("stranger");
        bytes32 licensor = names.LICENSOR_ROLE();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, licensor)
        );
        names.registerPopup("egbt", BOX, expiry);

        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(IGameBoxNames.UnknownBox.selector, "egbt-none"));
        names.registerPopup("egbt", "egbt-none", expiry);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(abi.encodeWithSelector(IGameBoxNames.BoxNotLive.selector, BOX));
        names.registerPopup("egbt", BOX, uint64(block.timestamp + 1 hours));
        vm.stopPrank();
    }

    function test_popupsNeedTheLicensorRole() public {
        vm.startPrank(admin);
        names.revokeRole(names.LICENSOR_ROLE(), address(licences));
        vm.stopPrank();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, address(licences), names.LICENSOR_ROLE()
            )
        );
        licences.openPopup("egbt");
    }

    function test_aPopupLabelCantBeClaimedByAPlayer() public {
        licences.openPopup("egbt");
        vm.warp(block.timestamp + 10 minutes);
        (address badge, uint256 key) = accountWithKey("badge-popup");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = claimSignature(POPUP, badge, key, deadline);
        vm.expectRevert(abi.encodeWithSelector(IGameBoxNames.LabelHeldByBox.selector, POPUP));
        names.claimPlayer(POPUP, badge, deadline, sig);
    }

    /// @dev The operator owns the pop-up's token but can't move it or re-point it.
    function test_theOperatorCantMoveAPopup() public {
        licences.openPopup("egbt");
        uint256 tokenId = registry.getTokenId(NameLib.id(POPUP));
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IPermissionedRegistry.TransferDisallowed.selector, tokenId, operator));
        registry.safeTransferFrom(operator, admin, tokenId, 1, "");
        vm.prank(operator);
        vm.expectRevert();
        registry.setResolver(NameLib.id(POPUP), operator);
    }
}
