// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {IBoxSeats} from "../../src/names/IBoxSeats.sol";
import {IBoxSigned} from "../../src/names/IBoxSigned.sol";
import {IPermissionedRegistry, IPermissionedResolver, ResolverRoles} from "../../src/names/IENSv2.sol";
import {IGameBoxNames} from "../../src/names/IGameBoxNames.sol";
import {NamesFork} from "./NamesFork.sol";

contract SeatsTest is NamesFork {
    string internal constant BOX = "egbt-box";
    address internal badge;

    function setUp() public override {
        super.setUp();
        registerBox(BOX, 1 days);
        badge = account("badge-nova");
    }

    function _seat(string memory label, address who) internal view returns (IBoxSeats.Seat memory) {
        return IBoxSeats.Seat(label, who, BOX, block.timestamp + 10 minutes);
    }

    function _claim(IBoxSeats.Seat memory seat) internal returns (address) {
        (bytes32 r, bytes32 s) = p256Sign(boxKey, seats.seatDigest(seat));
        return seats.claim(seat, r, s);
    }

    function _expectRefused(IBoxSeats.Seat memory seat, bytes memory error) internal {
        (bytes32 r, bytes32 s) = p256Sign(boxKey, seats.seatDigest(seat));
        vm.expectRevert(error);
        seats.claim(seat, r, s);
    }

    function test_aBoxSeatsABadge() public {
        vm.expectEmit(false, true, false, false, address(seats));
        emit IBoxSeats.Seated(BOX, "egbt-nova", badge, address(0));
        address resolver = _claim(_seat("egbt-nova", badge));

        assertEq(names.nameOf(badge), "egbt-nova.gamebox.eth");
        assertEq(registry.getOwner(uint256(keccak256("egbt-nova"))), badge);
        assertEq(registry.getResolver("egbt-nova"), resolver);
        assertEq(resolveAddr("egbt-nova.gamebox.eth"), badge);
        // The same name a badge's own claim gets: it holds every role, PlayerStats only `stats`, and nobody else
        // (neither GameBoxNames nor BoxSeats) holds anything.
        IPermissionedResolver r = IPermissionedResolver(resolver);
        assertTrue(r.hasRootRoles(ResolverRoles.UPGRADE | ResolverRoles.SET_TEXT_ADMIN, badge));
        assertEq(r.roles(0, address(names)), 0);
        assertEq(r.roles(0, address(seats)), 0);
        assertEq(r.roles(ResolverRoles.textResource("stats"), address(stats)), ResolverRoles.SET_TEXT);
        assertTrue(registry.isEmancipated());
    }

    function test_theWrongBoxKey() public {
        IBoxSeats.Seat memory seat = _seat("egbt-nova", badge);
        (bytes32 r, bytes32 s) = p256Sign(p256Key("egb-test-not-the-box"), seats.seatDigest(seat));
        vm.expectRevert(IBoxSigned.InvalidSignature.selector);
        seats.claim(seat, r, s);

        // The signature covers every field.
        (r, s) = p256Sign(boxKey, seats.seatDigest(seat));
        seat.badge = account("badge-other");
        vm.expectRevert(IBoxSigned.InvalidSignature.selector);
        seats.claim(seat, r, s);
    }

    function test_aSuspendedExpiredOrUnknownBox() public {
        vm.prank(admin);
        names.setBoxStatus(BOX, IGameBoxNames.BoxStatus.Suspended);
        _expectRefused(_seat("egbt-nova", badge), abi.encodeWithSelector(IBoxSigned.BoxNotActive.selector, BOX));
        vm.prank(admin);
        names.setBoxStatus(BOX, IGameBoxNames.BoxStatus.Active);

        IBoxSeats.Seat memory seat = _seat("egbt-nova", badge);
        seat.box = "egbt-nobox";
        _expectRefused(seat, abi.encodeWithSelector(IBoxSigned.UnknownBox.selector, "egbt-nobox"));

        vm.warp(block.timestamp + 1 days);
        _expectRefused(_seat("egbt-nova", badge), abi.encodeWithSelector(IBoxSigned.BoxExpired.selector, BOX));
    }

    function test_aSecondNameForTheSameBadge() public {
        _claim(_seat("egbt-nova", badge));
        _expectRefused(
            _seat("egbt-kite", badge), abi.encodeWithSelector(IGameBoxNames.BadgeHasName.selector, badge, "egbt-nova")
        );
        // A replay of the same seat fails the same way.
        _expectRefused(
            _seat("egbt-nova", badge), abi.encodeWithSelector(IGameBoxNames.BadgeHasName.selector, badge, "egbt-nova")
        );
    }

    function test_theClaimRules() public {
        IBoxSeats.Seat memory seat = _seat("egbt-nova", badge);
        seat.deadline = block.timestamp - 1;
        _expectRefused(seat, abi.encodeWithSelector(IBoxSigned.DeadlineExpired.selector, seat.deadline));
        _expectRefused(_seat("Nova", badge), abi.encodeWithSelector(IGameBoxNames.InvalidLabel.selector, "Nova"));
        _expectRefused(_seat(BOX, badge), abi.encodeWithSelector(IGameBoxNames.LabelHeldByBox.selector, BOX));

        _claim(_seat("egbt-nova", badge));
        address other = account("badge-other");
        _expectRefused(
            _seat("egbt-nova", other),
            abi.encodeWithSelector(IPermissionedRegistry.LabelAlreadyRegistered.selector, "egbt-nova")
        );
    }

    function test_onlyTheSeaterClaimsForABadge() public {
        address stranger = account("stranger");
        bytes32 role = names.SEATER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, role)
        );
        vm.prank(stranger);
        names.claimPlayerFor("egbt-nova", badge);
        assertTrue(names.hasRole(role, address(seats)));
    }

    function test_domain() public view {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = seats.eip712Domain();
        assertEq(name, "Game Box Seats");
        assertEq(version, "1");
        assertEq(chainId, 11155111);
        assertEq(verifying, address(seats));
        assertEq(seats.SEAT_TYPEHASH(), keccak256("Seat(string label,address badge,string box,uint256 deadline)"));
    }
}
