// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Test} from "forge-std/Test.sol";

import {DeployStorePot} from "../../script/game/DeployStorePot.s.sol";
import {StorePot} from "../../src/game/StorePot.sol";
import {IGameBoxNames} from "../../src/names/IGameBoxNames.sol";
import {FakeUSDC} from "../../src/token/FakeUSDC.sol";

/// @dev `DeployStorePot` with its deployments in memory, so no test writes `deployments/sepolia.json`.
contract InMemoryDeployStorePot is DeployStorePot {
    mapping(string name => address) public recorded;

    function record(string memory name, address addr) external {
        recorded[name] = addr;
    }

    function _deployed(string memory name) internal view override returns (address) {
        return recorded[name];
    }

    function _save(string memory name, address addr, string memory) internal override {
        recorded[name] = addr;
    }
}

/// @notice What `DeployStorePot` leaves behind. No match runs here, so it needs no fork: the pot only stores the
///         registry's address.
contract DeployStorePotTest is Test {
    /// @dev Who a broadcast sends from in a test, standing in for the deployer, which is the relayer's key.
    address internal constant DEPLOYER = DEFAULT_SENDER;
    string internal constant NOT_ITS_OWN = "DeployStorePot: STORE_ADMIN must be its own account";

    InMemoryDeployStorePot internal script;
    address internal verifier = makeAddr("verifier");
    address internal admin = makeAddr("admin");
    IGameBoxNames internal names = IGameBoxNames(makeAddr("names"));

    function setUp() public {
        script = new InMemoryDeployStorePot();
        script.record("GameBoxNames", address(names));
    }

    function _deploy() internal returns (StorePot pot, FakeUSDC usdc) {
        script.deploy(verifier, admin);
        return (StorePot(script.recorded("StorePot")), FakeUSDC(script.recorded("StoreUSDC")));
    }

    function test_theDeployerEndsWithNoPowerOverTheVerifiers() public {
        (StorePot pot,) = _deploy();
        bytes32 adminRole = pot.DEFAULT_ADMIN_ROLE();
        assertTrue(pot.hasRole(adminRole, admin));
        assertFalse(pot.hasRole(adminRole, DEPLOYER));

        // The relayer's key can't make itself a verifier, so a leak of it can't rewrite an open pot's split.
        bytes32 verifierRole = pot.VERIFIER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, DEPLOYER, adminRole)
        );
        vm.prank(DEPLOYER);
        pot.grantRole(verifierRole, DEPLOYER);
    }

    function test_everyRoleLandsWhereTheRelayerAndTheVerifierNeedIt() public {
        (StorePot pot, FakeUSDC usdc) = _deploy();
        assertTrue(pot.hasRole(pot.VERIFIER_ROLE(), verifier));
        assertTrue(pot.hasRole(pot.LISTER_ROLE(), DEPLOYER));
        assertFalse(pot.hasRole(pot.VERIFIER_ROLE(), DEPLOYER));
        assertTrue(usdc.hasRole(usdc.MINTER_ROLE(), DEPLOYER));
        assertEq(usdc.gameSpender(), address(pot));
        assertEq(address(pot.USDC()), address(usdc));
        assertEq(address(pot.NAMES()), address(names));
    }

    function test_theAdminStillRotatesTheVerifier() public {
        (StorePot pot,) = _deploy();
        address next = makeAddr("next-verifier");
        bytes32 role = pot.VERIFIER_ROLE();
        vm.startPrank(admin);
        pot.grantRole(role, next);
        pot.revokeRole(role, verifier);
        vm.stopPrank();
        assertTrue(pot.hasRole(role, next));
        assertFalse(pot.hasRole(role, verifier));
    }

    /// @dev `store:deploy-pot` runs the script again to record each block and transaction.
    function test_aSecondRunChangesNothing() public {
        (StorePot pot, FakeUSDC usdc) = _deploy();
        (StorePot samePot, FakeUSDC sameUsdc) = _deploy();
        assertEq(address(samePot), address(pot));
        assertEq(address(sameUsdc), address(usdc));
        assertTrue(pot.hasRole(pot.DEFAULT_ADMIN_ROLE(), admin));
        assertFalse(pot.hasRole(pot.DEFAULT_ADMIN_ROLE(), DEPLOYER));
    }

    function test_aRunFinishesAHandOverThatStopped() public {
        FakeUSDC usdc = new FakeUSDC(DEPLOYER, DEPLOYER);
        StorePot pot = new StorePot(names, usdc, DEPLOYER);
        bytes32 adminRole = pot.DEFAULT_ADMIN_ROLE();
        vm.startPrank(DEPLOYER);
        usdc.setGameSpender(address(pot));
        pot.grantRole(adminRole, admin);
        vm.stopPrank();
        script.record("StoreUSDC", address(usdc));
        script.record("StorePot", address(pot));

        _deploy();
        assertTrue(pot.hasRole(adminRole, admin));
        assertFalse(pot.hasRole(adminRole, DEPLOYER));
    }

    function test_onlyTheAdminAddsAVerifierAfterTheHandOver() public {
        (StorePot pot,) = _deploy();
        bytes memory refused = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, DEPLOYER, pot.DEFAULT_ADMIN_ROLE()
        );
        vm.expectRevert(refused);
        script.deploy(makeAddr("next-verifier"), admin);
    }

    function test_onlyTheAdminMovesTheAdminRoleAfterTheHandOver() public {
        (StorePot pot,) = _deploy();
        bytes memory refused = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, DEPLOYER, pot.DEFAULT_ADMIN_ROLE()
        );
        vm.expectRevert(refused);
        script.deploy(verifier, makeAddr("next-admin"));
    }

    function test_theAdminCantBeTheDeployer() public {
        vm.expectRevert(bytes(NOT_ITS_OWN));
        script.deploy(verifier, DEPLOYER);
    }

    function test_theAdminCantBeTheVerifier() public {
        vm.expectRevert(bytes(NOT_ITS_OWN));
        script.deploy(verifier, verifier);
    }

    function test_theAdminCantBeNobody() public {
        vm.expectRevert(bytes(NOT_ITS_OWN));
        script.deploy(verifier, address(0));
    }
}
