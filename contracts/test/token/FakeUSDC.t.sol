// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Test} from "forge-std/Test.sol";

import {FakeUSDC} from "../../src/token/FakeUSDC.sol";
import {IFakeUSDC} from "../../src/token/IFakeUSDC.sol";

contract FakeUSDCTest is Test {
    FakeUSDC internal usdc;
    address internal admin = makeAddr("admin");
    address internal minter = makeAddr("minter");
    address internal player = makeAddr("player");
    address internal pot = makeAddr("pot");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        usdc = new FakeUSDC(admin, minter);
    }

    function test_looksLikeUSDC() public view {
        assertEq(usdc.name(), "USD Coin (Game Box test)");
        assertEq(usdc.symbol(), "USDC");
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.totalSupply(), 0);
        assertTrue(usdc.hasRole(usdc.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(usdc.hasRole(usdc.MINTER_ROLE(), minter));
    }

    function test_onlyTheMinterMints() public {
        vm.prank(minter);
        usdc.mint(player, 100e6);
        assertEq(usdc.balanceOf(player), 100e6);

        bytes32 role = usdc.MINTER_ROLE();
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, admin, role));
        vm.prank(admin);
        usdc.mint(player, 1);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, role)
        );
        vm.prank(stranger);
        usdc.mint(stranger, 1);
    }

    function test_theGameSpenderNeedsNoAllowance() public {
        vm.prank(minter);
        usdc.mint(player, 100e6);
        vm.expectEmit(address(usdc));
        emit IFakeUSDC.GameSpenderSet(pot);
        vm.prank(admin);
        usdc.setGameSpender(pot);
        assertEq(usdc.gameSpender(), pot);

        vm.prank(pot);
        usdc.transferFrom(player, pot, 10e6);
        assertEq(usdc.balanceOf(pot), 10e6);
        assertEq(usdc.allowance(player, pot), 0);

        // Anyone else still needs an allowance.
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, stranger, 0, 1));
        vm.prank(stranger);
        usdc.transferFrom(player, stranger, 1);
        vm.prank(player);
        usdc.approve(stranger, 1);
        vm.prank(stranger);
        usdc.transferFrom(player, stranger, 1);
        assertEq(usdc.balanceOf(stranger), 1);

        // The game spender can't take more than the balance.
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, player, 90e6 - 1, 100e6));
        vm.prank(pot);
        usdc.transferFrom(player, pot, 100e6);
    }

    function test_theGameSpenderIsSetOnceByTheAdmin() public {
        bytes32 role = usdc.DEFAULT_ADMIN_ROLE();
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, minter, role));
        vm.prank(minter);
        usdc.setGameSpender(pot);

        vm.startPrank(admin);
        vm.expectRevert(IFakeUSDC.ZeroAddress.selector);
        usdc.setGameSpender(address(0));
        usdc.setGameSpender(pot);
        vm.expectRevert(abi.encodeWithSelector(IFakeUSDC.GameSpenderAlreadySet.selector, pot));
        usdc.setGameSpender(stranger);
        vm.stopPrank();
    }

    function test_constructorRefusesZero() public {
        vm.expectRevert(IFakeUSDC.ZeroAddress.selector);
        new FakeUSDC(address(0), minter);
        vm.expectRevert(IFakeUSDC.ZeroAddress.selector);
        new FakeUSDC(admin, address(0));
    }
}
