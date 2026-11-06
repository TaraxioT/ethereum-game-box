// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IDemoLicences} from "../../src/names/IDemoLicences.sol";
import {IPermissionedRegistry, IPermissionedResolver} from "../../src/names/IENSv2.sol";
import {IGameBoxNames} from "../../src/names/IGameBoxNames.sol";
import {NameLib} from "../../src/names/NameLib.sol";
import {NamesFork} from "./NamesFork.sol";

contract PopupsTest is NamesFork {
    function test_openPopupRegistersForExactly10Minutes() public {
        uint256 opened = block.timestamp;
        vm.expectEmit(address(licences));
        emit IDemoLicences.PopupOpened("popup-egbt", uint64(opened + 10 minutes));
        vm.prank(account("visitor"));
        string memory label = licences.openPopup("egbt");
        assertEq(label, "popup-egbt");

        IGameBoxNames.Box memory box = names.getBox(label);
        assertEq(box.expiry, opened + 600);
        assertEq(box.operator, operator);
        assertEq(box.account, address(demoBox));
        (bytes32 qx, bytes32 qy) = demoBox.publicKey();
        assertEq(box.qx, qx);
        assertEq(box.qy, qy);
        assertEq(registry.getOwner(NameLib.id(label)), operator);

        vm.warp(opened + 600 - 1);
        assertEq(resolveAddr("popup-egbt.gamebox.eth"), address(demoBox));
        assertEq(resolveText("popup-egbt.gamebox.eth", "status"), "active");
        vm.warp(opened + 600);
        assertEq(resolveAddr("popup-egbt.gamebox.eth"), address(0));
    }

    function test_aLivePopupLabelIsRefused() public {
        licences.openPopup("egbt");
        vm.warp(block.timestamp + 10 minutes - 1);
        vm.expectRevert(abi.encodeWithSelector(IPermissionedRegistry.LabelAlreadyRegistered.selector, "popup-egbt"));
        licences.openPopup("egbt");
    }

    function test_aLapsedPopupLabelWorksAgain() public {
        licences.openPopup("egbt");
        address first = names.getBox("popup-egbt").resolver;
        vm.prank(operator);
        IPermissionedResolver(first).setText(NameLib.dnsName("popup-egbt"), "location", "Stage A");

        vm.warp(block.timestamp + 10 minutes);
        licences.openPopup("egbt");
        address second = names.getBox("popup-egbt").resolver;
        assertTrue(second != first);
        assertEq(names.getBox("popup-egbt").expiry, block.timestamp + 10 minutes);
        assertEq(resolveAddr("popup-egbt.gamebox.eth"), address(demoBox));
        // A fresh resolver: nothing carries over from the last licence.
        assertEq(resolveText("popup-egbt.gamebox.eth", "location"), "");
    }

    function test_popupLabelRule() public {
        string[5] memory bad = ["", "-egbt", "Egbt", "egbt.x", "abcdefghijklmnopqrstuvwxyz0"];
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(IDemoLicences.InvalidLabel.selector, bad[i]));
            licences.openPopup(bad[i]);
        }
        // 26 characters is the longest: popup- plus 26 is 32.
        licences.openPopup("abcdefghijklmnopqrstuvwxyz");
        // One character works, since the rule applies to the full label.
        licences.openPopup("x");
    }

    function test_popupsNeedTheLicensorRole() public {
        vm.startPrank(admin);
        names.revokeRole(names.LICENSOR_ROLE(), address(licences));
        vm.stopPrank();
        vm.expectRevert();
        licences.openPopup("egbt");
    }
}
