// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {GBX} from "../../src/token/GBX.sol";

contract GBXTest is Test {
    GBX internal gbx;
    address internal deployer = makeAddr("deployer");
    address internal holder = makeAddr("holder");

    function setUp() public {
        vm.prank(deployer);
        gbx = new GBX();
    }

    function test_metadata() public view {
        assertEq(gbx.name(), "Game Box");
        assertEq(gbx.symbol(), "GBX");
        assertEq(gbx.decimals(), 18);
    }

    function test_wholeSupplyGoesToDeployer() public view {
        assertEq(gbx.totalSupply(), gbx.TOTAL_SUPPLY());
        assertEq(gbx.balanceOf(deployer), gbx.TOTAL_SUPPLY());
    }

    function test_burnLowersSupply() public {
        vm.prank(deployer);
        gbx.transfer(holder, 100 ether);

        vm.prank(holder);
        gbx.burn(40 ether);

        assertEq(gbx.balanceOf(holder), 60 ether);
        assertEq(gbx.totalSupply(), gbx.TOTAL_SUPPLY() - 40 ether);
    }

    function test_burnFromNeedsAllowance() public {
        vm.prank(deployer);
        gbx.transfer(holder, 100 ether);

        address burner = makeAddr("burner");
        vm.prank(burner);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, burner, 0, 1 ether));
        gbx.burnFrom(holder, 1 ether);

        vm.prank(holder);
        gbx.approve(burner, 1 ether);
        vm.prank(burner);
        gbx.burnFrom(holder, 1 ether);
        assertEq(gbx.balanceOf(holder), 99 ether);
    }

    function test_cannotBurnMoreThanBalance() public {
        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, holder, 0, 1));
        gbx.burn(1);
    }

    function testFuzz_burnNeverRaisesSupply(uint256 amount) public {
        amount = bound(amount, 0, gbx.TOTAL_SUPPLY());
        vm.prank(deployer);
        gbx.burn(amount);
        assertEq(gbx.totalSupply(), gbx.TOTAL_SUPPLY() - amount);
    }
}
