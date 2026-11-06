// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {stdError} from "forge-std/StdError.sol";

import {IStorePot} from "../../src/game/IStorePot.sol";
import {StorePot} from "../../src/game/StorePot.sol";
import {IBoxSigned} from "../../src/names/IBoxSigned.sol";
import {IGameBoxNames} from "../../src/names/IGameBoxNames.sol";
import {FakeUSDC} from "../../src/token/FakeUSDC.sol";
import {NamesFork} from "../names/NamesFork.sol";

/// @notice `StorePot` on the names fork, against the real `GameBoxNames` and a second `FakeUSDC`, wired the way
///         `DeployStorePot` wires them.
contract StorePotTest is NamesFork {
    string internal constant BOX = "egbt-box";
    string internal constant OTHER_BOX = "egbt-other";
    /// @dev Stand-ins for two bundles' sha256. Not `sha256(...)`: that calls a precompile, which uses up a `vm.prank`.
    bytes32 internal constant BUNDLE = keccak256("a bundle");
    bytes32 internal constant OTHER_BUNDLE = keccak256("another bundle");
    bytes32 internal constant RECORD = keccak256("an audit record's JSON text");
    uint256 internal constant STAKE = 10e6;
    uint256 internal constant START = 100e6;
    /// @dev The order of secp256k1.
    uint256 internal constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    StorePot internal store;
    FakeUSDC internal usdc;
    address[5] internal seat;
    address internal lister = account("lister");
    address internal verifier;
    uint256 internal verifierKey;

    function setUp() public override {
        super.setUp();
        registerBox(BOX, 1 days);
        registerBox(OTHER_BOX, 1 days);
        (verifier, verifierKey) = accountWithKey("verifier");
        vm.startPrank(admin);
        usdc = new FakeUSDC(admin, admin);
        store = new StorePot(names, usdc, admin);
        usdc.setGameSpender(address(store));
        store.grantRole(store.LISTER_ROLE(), lister);
        store.grantRole(store.VERIFIER_ROLE(), verifier);
        for (uint256 i; i < seat.length; ++i) {
            seat[i] = account(string.concat("player-", vm.toString(i)));
            usdc.mint(seat[i], START);
        }
        vm.stopPrank();
        vm.prank(lister);
        store.list(BUNDLE);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------------------------------------------------------

    function _players(uint256 count) internal view returns (address[] memory players) {
        players = new address[](count);
        for (uint256 i; i < count; ++i) {
            players[i] = seat[i];
        }
    }

    function _stake(uint256 round, uint256 count) internal view returns (IStorePot.Stake memory) {
        return IStorePot.Stake(BOX, BUNDLE, round, _players(count), STAKE, block.timestamp + 1 hours);
    }

    function _open(IStorePot.Stake memory s) internal {
        (bytes32 r, bytes32 ss) = p256Sign(boxKey, store.stakeDigest(s));
        store.open(s, r, ss);
    }

    function _expectRefused(IStorePot.Stake memory s, bytes memory error) internal {
        (bytes32 r, bytes32 ss) = p256Sign(boxKey, store.stakeDigest(s));
        vm.expectRevert(error);
        store.open(s, r, ss);
    }

    function _verdict(uint256 round, uint256[] memory payouts) internal view returns (IStorePot.Verdict memory) {
        return IStorePot.Verdict(BOX, round, payouts, RECORD, block.timestamp + 1 hours);
    }

    function _void(uint256 round) internal view returns (IStorePot.Void memory) {
        return IStorePot.Void(BOX, round, RECORD, block.timestamp + 1 hours);
    }

    /// @dev A 65-byte signature, `r ‖ s ‖ v`.
    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _settle(IStorePot.Verdict memory v) internal {
        store.settle(v, _sign(verifierKey, store.verdictDigest(v)));
    }

    function _voidPot(IStorePot.Void memory v) internal {
        store.voidPot(v, _sign(verifierKey, store.voidDigest(v)));
    }

    function _expectRefused(IStorePot.Verdict memory v, bytes memory error) internal {
        bytes memory signature = _sign(verifierKey, store.verdictDigest(v));
        vm.expectRevert(error);
        store.settle(v, signature);
    }

    function _notOpen(uint256 round) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IStorePot.PotNotOpen.selector, BOX, round);
    }

    function _state(uint256 round) internal view returns (uint8) {
        return uint8(store.getPot(BOX, round).state);
    }

    function _wholePotTo(uint256 winner, uint256 count) internal pure returns (uint256[] memory payouts) {
        payouts = new uint256[](count);
        payouts[winner] = STAKE * count;
    }

    function _two(uint256 a, uint256 b) internal pure returns (uint256[] memory payouts) {
        payouts = new uint256[](2);
        (payouts[0], payouts[1]) = (a, b);
    }

    function _three(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory payouts) {
        payouts = new uint256[](3);
        (payouts[0], payouts[1], payouts[2]) = (a, b, c);
    }

    function _four(uint256 a, uint256 b, uint256 c, uint256 d) internal pure returns (uint256[] memory payouts) {
        payouts = new uint256[](4);
        (payouts[0], payouts[1], payouts[2], payouts[3]) = (a, b, c, d);
    }

    /// @dev Each player is back to `START`, and the pot holds nothing.
    function _assertEveryoneWhole(uint256 count) internal view {
        for (uint256 i; i < count; ++i) {
            assertEq(usdc.balanceOf(seat[i]), START);
        }
        assertEq(usdc.balanceOf(address(store)), 0);
    }

    /// @dev Opens a pot of `payouts.length` players, settles it, and checks each player got exactly their payout.
    function _assertPays(uint256 round, uint256[] memory payouts) internal {
        uint256 count = payouts.length;
        _open(_stake(round, count));
        uint256[] memory before = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            before[i] = usdc.balanceOf(seat[i]);
        }
        _settle(_verdict(round, payouts));
        for (uint256 i; i < count; ++i) {
            assertEq(usdc.balanceOf(seat[i]), before[i] + payouts[i]);
        }
        assertEq(usdc.balanceOf(address(store)), 0);
        assertEq(_state(round), uint8(IStorePot.State.Settled));
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Listing
    // ----------------------------------------------------------------------------------------------------------------

    function test_aListerLists() public {
        assertFalse(store.listed(OTHER_BUNDLE));
        vm.expectEmit(address(store));
        emit IStorePot.BundleListed(OTHER_BUNDLE);
        vm.prank(lister);
        store.list(OTHER_BUNDLE);
        assertTrue(store.listed(OTHER_BUNDLE));
    }

    function test_onlyAListerLists() public {
        address stranger = account("stranger");
        bytes32 role = store.LISTER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, role)
        );
        vm.prank(stranger);
        store.list(OTHER_BUNDLE);

        // Not even the admin, without the role.
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, admin, role));
        vm.prank(admin);
        store.list(OTHER_BUNDLE);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Opening
    // ----------------------------------------------------------------------------------------------------------------

    function test_openPullsEveryStake() public {
        IStorePot.Stake memory s = _stake(1, 4);
        vm.expectEmit(address(store));
        emit IStorePot.PotOpened(BOX, BUNDLE, 1, s.players, STAKE);
        _open(s);
        assertEq(usdc.balanceOf(address(store)), 4 * STAKE);
        for (uint256 i; i < 4; ++i) {
            assertEq(usdc.balanceOf(seat[i]), START - STAKE);
        }

        IStorePot.Pot memory p = store.getPot(BOX, 1);
        assertEq(p.players, s.players);
        assertEq(p.amount, STAKE);
        assertEq(p.opened, block.timestamp);
        assertEq(uint8(p.state), uint8(IStorePot.State.Open));
        assertEq(p.bundle, BUNDLE);
        assertEq(p.record, bytes32(0));
        assertEq(_state(2), uint8(IStorePot.State.None));
    }

    function test_openTakesTwoToFourPlayers() public {
        _open(_stake(2, 2));
        _open(_stake(3, 3));
        _open(_stake(4, 4));
        assertEq(usdc.balanceOf(address(store)), 9 * STAKE);
    }

    function test_openStopsAtTheDeadline() public {
        IStorePot.Stake memory s = _stake(1, 2);
        s.deadline = block.timestamp;
        _open(s);

        s = _stake(2, 2);
        s.deadline = block.timestamp - 1;
        _expectRefused(s, abi.encodeWithSelector(IBoxSigned.DeadlineExpired.selector, s.deadline));
    }

    function test_anUnlistedBundleIsRefused() public {
        IStorePot.Stake memory s = _stake(1, 2);
        s.bundle = OTHER_BUNDLE;
        _expectRefused(s, abi.encodeWithSelector(IStorePot.NotListed.selector, s.bundle));
    }

    function test_oneOrFivePlayersAreRefused() public {
        _expectRefused(_stake(1, 0), abi.encodeWithSelector(IStorePot.PlayerCount.selector, 0));
        _expectRefused(_stake(1, 1), abi.encodeWithSelector(IStorePot.PlayerCount.selector, 1));
        _expectRefused(_stake(1, 5), abi.encodeWithSelector(IStorePot.PlayerCount.selector, 5));
    }

    function test_aRepeatedPlayerIsRefused() public {
        IStorePot.Stake memory s = _stake(1, 2);
        s.players[1] = s.players[0];
        _expectRefused(s, abi.encodeWithSelector(IStorePot.RepeatedPlayer.selector, s.players[0]));

        // In every pair of seats.
        for (uint256 i; i < 4; ++i) {
            for (uint256 j = i + 1; j < 4; ++j) {
                s = _stake(1, 4);
                s.players[j] = s.players[i];
                _expectRefused(s, abi.encodeWithSelector(IStorePot.RepeatedPlayer.selector, s.players[i]));
            }
        }
    }

    function test_thePotCantBeAPlayer() public {
        IStorePot.Stake memory s = _stake(1, 2);
        s.players[1] = address(store);
        _expectRefused(s, abi.encodeWithSelector(IStorePot.PotIsPlayer.selector));
    }

    function test_aZeroStakeIsRefused() public {
        IStorePot.Stake memory s = _stake(1, 2);
        s.amount = 0;
        _expectRefused(s, abi.encodeWithSelector(IStorePot.ZeroAmount.selector));
    }

    function test_aPlayerWithoutTheBalanceOpensNothing() public {
        vm.prank(seat[2]);
        usdc.transfer(seat[4], START - 1);
        _expectRefused(
            _stake(1, 3), abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, seat[2], 1, STAKE)
        );
        assertEq(usdc.balanceOf(seat[0]), START);
        assertEq(usdc.balanceOf(address(store)), 0);
        assertEq(_state(1), uint8(IStorePot.State.None));
    }

    function test_aPotExists() public {
        bytes memory exists = abi.encodeWithSelector(IStorePot.PotExists.selector, BOX, 1);
        IStorePot.Stake memory s = _stake(1, 2);
        (bytes32 r, bytes32 ss) = p256Sign(boxKey, store.stakeDigest(s));
        store.open(s, r, ss);

        // The same signature, and a new one for other players.
        vm.expectRevert(exists);
        store.open(s, r, ss);
        _expectRefused(_stake(1, 3), exists);

        // Not even once it is closed.
        _settle(_verdict(1, _two(2 * STAKE, 0)));
        vm.expectRevert(exists);
        store.open(s, r, ss);

        // The round is per Box.
        s.box = OTHER_BOX;
        _open(s);
        assertEq(uint8(store.getPot(OTHER_BOX, 1).state), uint8(IStorePot.State.Open));
    }

    function test_noClosedPotReopens() public {
        _open(_stake(1, 2));
        _voidPot(_void(1));
        _expectRefused(_stake(1, 2), abi.encodeWithSelector(IStorePot.PotExists.selector, BOX, 1));

        _open(_stake(2, 2));
        vm.warp(block.timestamp + 1 hours);
        store.refund(BOX, 2);
        _expectRefused(_stake(2, 2), abi.encodeWithSelector(IStorePot.PotExists.selector, BOX, 2));
    }

    function test_theWrongBoxKey() public {
        IStorePot.Stake memory s = _stake(1, 2);
        (bytes32 r, bytes32 ss) = p256Sign(p256Key("egb-test-not-the-box"), store.stakeDigest(s));
        vm.expectRevert(IBoxSigned.InvalidSignature.selector);
        store.open(s, r, ss);

        (r, ss) = p256Sign(boxKey, store.stakeDigest(s));
        vm.expectRevert(IBoxSigned.InvalidSignature.selector);
        store.open(s, r, bytes32(P256_N - uint256(ss)));
    }

    function test_theBoxSignsEveryFieldOfAStake() public {
        IStorePot.Stake memory s = _stake(1, 3);
        (bytes32 r, bytes32 ss) = p256Sign(boxKey, store.stakeDigest(s));

        IStorePot.Stake memory t = _stake(1, 3);
        t.box = OTHER_BOX; // the same key signs both Boxes here
        vm.expectRevert(IBoxSigned.InvalidSignature.selector);
        store.open(t, r, ss);

        t = _stake(2, 3);
        vm.expectRevert(IBoxSigned.InvalidSignature.selector);
        store.open(t, r, ss);

        t = _stake(1, 3);
        vm.prank(lister);
        store.list(OTHER_BUNDLE);
        t.bundle = OTHER_BUNDLE;
        vm.expectRevert(IBoxSigned.InvalidSignature.selector);
        store.open(t, r, ss);

        t = _stake(1, 2);
        vm.expectRevert(IBoxSigned.InvalidSignature.selector);
        store.open(t, r, ss);

        t = _stake(1, 3);
        (t.players[0], t.players[1]) = (t.players[1], t.players[0]);
        vm.expectRevert(IBoxSigned.InvalidSignature.selector);
        store.open(t, r, ss);

        t = _stake(1, 3);
        t.amount = STAKE + 1;
        vm.expectRevert(IBoxSigned.InvalidSignature.selector);
        store.open(t, r, ss);

        t = _stake(1, 3);
        t.deadline += 1;
        vm.expectRevert(IBoxSigned.InvalidSignature.selector);
        store.open(t, r, ss);

        store.open(s, r, ss);
    }

    function test_aSuspendedExpiredOrUnknownBox() public {
        vm.prank(admin);
        names.setBoxStatus(BOX, IGameBoxNames.BoxStatus.Suspended);
        _expectRefused(_stake(1, 2), abi.encodeWithSelector(IBoxSigned.BoxNotActive.selector, BOX));
        vm.prank(admin);
        names.setBoxStatus(BOX, IGameBoxNames.BoxStatus.Active);

        vm.warp(block.timestamp + 1 days);
        _expectRefused(_stake(1, 2), abi.encodeWithSelector(IBoxSigned.BoxExpired.selector, BOX));

        IStorePot.Stake memory s = _stake(1, 2);
        s.box = "egbt-nobox";
        _expectRefused(s, abi.encodeWithSelector(IBoxSigned.UnknownBox.selector, "egbt-nobox"));
    }

    /// @dev Anyone can open a pop-up, so it mustn't count as a Box: it would hold the power the next test shows.
    function test_aPopupCantOpenAPot() public {
        registerBox(licences.BOX(), 1 days);
        licences.openPopup("egbt");
        IStorePot.Stake memory s = _stake(1, 2);
        s.box = "popup-egbt";
        _expectRefused(s, abi.encodeWithSelector(IBoxSigned.UnknownBox.selector, "popup-egbt"));
    }

    /// @dev A limit, not a goal: the game store plan's section 3 states it. A badge signs nothing, so `open` takes the
    ///      Box's word for who is playing, and a licensed Box can empty a badge that never tapped into a pot it then
    ///      wins. Only a licensor makes a Box, and Store USDC has no value.
    function test_theBoxAloneNamesThePlayers() public {
        address stranger = account("stranger");
        vm.prank(admin);
        usdc.mint(stranger, 25e6);

        address[] memory players = new address[](2);
        (players[0], players[1]) = (seat[0], stranger);
        _open(IStorePot.Stake(BOX, BUNDLE, 1, players, 25e6, block.timestamp + 1 hours));
        assertEq(usdc.balanceOf(stranger), 0);

        _settle(_verdict(1, _two(50e6, 0)));
        assertEq(usdc.balanceOf(seat[0]), START + 25e6);
        assertEq(usdc.balanceOf(stranger), 0);
    }

    function test_aPotThatIsntTheGameSpenderTakesNothing() public {
        vm.prank(admin);
        StorePot unwired = new StorePot(names, usdc, admin);
        vm.startPrank(admin);
        unwired.grantRole(unwired.LISTER_ROLE(), admin);
        unwired.list(BUNDLE);
        vm.stopPrank();

        IStorePot.Stake memory s = _stake(1, 2);
        (bytes32 r, bytes32 ss) = p256Sign(boxKey, unwired.stakeDigest(s));
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(unwired), 0, STAKE)
        );
        unwired.open(s, r, ss);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Settling: every payout shape
    // ----------------------------------------------------------------------------------------------------------------

    function test_settleRecordsTheVerdict() public {
        _open(_stake(1, 3));
        IStorePot.Verdict memory v = _verdict(1, _three(15e6, 15e6, 0));
        vm.expectEmit(address(store));
        emit IStorePot.PotSettled(BOX, 1, v.payouts, RECORD);
        _settle(v);
        IStorePot.Pot memory p = store.getPot(BOX, 1);
        assertEq(uint8(p.state), uint8(IStorePot.State.Settled));
        assertEq(p.record, RECORD);
    }

    function test_twoPlayerShapes() public {
        _assertPays(1, _two(20e6, 0));
        _assertPays(2, _two(0, 20e6));
        _assertPays(3, _two(10e6, 10e6));
        _assertPays(4, _two(13e6, 7e6));
        _assertPays(5, _two(1, 20e6 - 1));
    }

    function test_threePlayerShapes() public {
        _assertPays(1, _three(30e6, 0, 0));
        _assertPays(2, _three(0, 30e6, 0));
        _assertPays(3, _three(0, 0, 30e6));
        _assertPays(4, _three(10e6, 10e6, 10e6));
        _assertPays(5, _three(15e6, 15e6, 0));
        _assertPays(6, _three(15e6, 0, 15e6));
        _assertPays(7, _three(0, 15e6, 15e6));
        _assertPays(8, _three(20e6, 9e6, 1e6));
    }

    function test_fourPlayerShapes() public {
        _assertPays(1, _four(40e6, 0, 0, 0));
        _assertPays(2, _four(0, 40e6, 0, 0));
        _assertPays(3, _four(0, 0, 40e6, 0));
        _assertPays(4, _four(0, 0, 0, 40e6));
        _assertPays(5, _four(10e6, 10e6, 10e6, 10e6));
        _assertPays(6, _four(20e6, 20e6, 0, 0));
        _assertPays(7, _four(20e6, 0, 0, 20e6));
        _assertPays(8, _four(0, 20e6, 20e6, 0));
        _assertPays(9, _four(0, 13e6, 13e6, 14e6));
        _assertPays(10, _four(25e6, 10e6, 4e6, 1e6));
    }

    function test_aRefundShapedVerdictLeavesEveryoneWhole() public {
        _open(_stake(1, 4));
        _settle(_verdict(1, _four(STAKE, STAKE, STAKE, STAKE)));
        _assertEveryoneWhole(4);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Settling: refusals
    // ----------------------------------------------------------------------------------------------------------------

    function test_theWrongNumberOfPayoutsIsRefused() public {
        _open(_stake(1, 3));
        _expectRefused(_verdict(1, _two(15e6, 15e6)), abi.encodeWithSelector(IStorePot.PayoutCount.selector, 3, 2));
        _expectRefused(_verdict(1, _four(30e6, 0, 0, 0)), abi.encodeWithSelector(IStorePot.PayoutCount.selector, 3, 4));
        _expectRefused(_verdict(1, new uint256[](0)), abi.encodeWithSelector(IStorePot.PayoutCount.selector, 3, 0));
    }

    function test_theWrongSumIsRefused() public {
        _open(_stake(1, 3));
        bytes memory low = abi.encodeWithSelector(IStorePot.PayoutSum.selector, 30e6, 30e6 - 1);
        bytes memory high = abi.encodeWithSelector(IStorePot.PayoutSum.selector, 30e6, 30e6 + 1);
        _expectRefused(_verdict(1, _three(10e6, 10e6, 10e6 - 1)), low);
        _expectRefused(_verdict(1, _three(10e6, 10e6, 10e6 + 1)), high);
        _expectRefused(_verdict(1, _three(0, 0, 0)), abi.encodeWithSelector(IStorePot.PayoutSum.selector, 30e6, 0));
        // A sum that wraps past 2^256 to exactly the pot.
        _expectRefused(_verdict(1, _three(type(uint256).max, 30e6 + 1, 0)), stdError.arithmeticError);
    }

    function test_aPotThatIsntOpenIsntPaid() public {
        // Never opened.
        _expectRefused(_verdict(1, _two(2 * STAKE, 0)), _notOpen(1));

        // Settled, voided and refunded.
        _open(_stake(1, 2));
        _settle(_verdict(1, _two(2 * STAKE, 0)));
        _expectRefused(_verdict(1, _two(0, 2 * STAKE)), _notOpen(1));

        _open(_stake(2, 2));
        _voidPot(_void(2));
        _expectRefused(_verdict(2, _two(2 * STAKE, 0)), _notOpen(2));

        _open(_stake(3, 2));
        vm.warp(block.timestamp + 1 hours);
        store.refund(BOX, 3);
        _expectRefused(_verdict(3, _two(2 * STAKE, 0)), _notOpen(3));
    }

    function test_settleStopsAtTheDeadline() public {
        _open(_stake(1, 2));
        IStorePot.Verdict memory v = _verdict(1, _two(2 * STAKE, 0));
        v.deadline = block.timestamp + 1;
        bytes memory signature = _sign(verifierKey, store.verdictDigest(v));

        vm.warp(v.deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(IBoxSigned.DeadlineExpired.selector, v.deadline));
        store.settle(v, signature);

        vm.warp(v.deadline);
        store.settle(v, signature);
        assertEq(_state(1), uint8(IStorePot.State.Settled));
    }

    function test_onlyAVerifierSettles() public {
        _open(_stake(1, 2));
        IStorePot.Verdict memory v = _verdict(1, _two(2 * STAKE, 0));
        bytes32 digest = store.verdictDigest(v);

        (address stranger, uint256 strangerKey) = accountWithKey("stranger");
        vm.expectRevert(abi.encodeWithSelector(IStorePot.NotVerifier.selector, stranger));
        store.settle(v, _sign(strangerKey, digest));

        // The admin and the lister hold no verifier role.
        (address boss, uint256 bossKey) = accountWithKey("boss");
        (address listing, uint256 listingKey) = accountWithKey("listing");
        bytes32 adminRole = store.DEFAULT_ADMIN_ROLE();
        bytes32 listerRole = store.LISTER_ROLE();
        vm.startPrank(admin);
        store.grantRole(adminRole, boss);
        store.grantRole(listerRole, listing);
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(IStorePot.NotVerifier.selector, boss));
        store.settle(v, _sign(bossKey, digest));
        vm.expectRevert(abi.encodeWithSelector(IStorePot.NotVerifier.selector, listing));
        store.settle(v, _sign(listingKey, digest));

        // Sending it isn't signing it.
        vm.prank(verifier);
        vm.expectRevert(abi.encodeWithSelector(IStorePot.NotVerifier.selector, stranger));
        store.settle(v, _sign(strangerKey, digest));
    }

    function test_theVerifierSignsEveryFieldOfAVerdict() public {
        _open(_stake(1, 2));
        _open(_stake(2, 2));
        IStorePot.Stake memory s = _stake(1, 2);
        s.box = OTHER_BOX;
        _open(s);
        IStorePot.Verdict memory v = _verdict(1, _two(2 * STAKE, 0));
        bytes memory signature = _sign(verifierKey, store.verdictDigest(v));

        // Another Box's pot of the same round.
        IStorePot.Verdict memory t = _verdict(1, _two(2 * STAKE, 0));
        t.box = OTHER_BOX;
        _expectForged(t, signature);

        // Another round.
        _expectForged(_verdict(2, _two(2 * STAKE, 0)), signature);

        // Another split.
        _expectForged(_verdict(1, _two(0, 2 * STAKE)), signature);

        // Another record.
        t = _verdict(1, _two(2 * STAKE, 0));
        t.record = keccak256("a different record");
        _expectForged(t, signature);

        // Another deadline.
        t = _verdict(1, _two(2 * STAKE, 0));
        t.deadline += 1;
        _expectForged(t, signature);

        store.settle(v, signature);
    }

    /// @dev `signature` recovers to some other key once a field has changed, and that key isn't a verifier.
    function _expectForged(IStorePot.Verdict memory v, bytes memory signature) internal {
        address signer = ECDSA.recover(store.verdictDigest(v), signature);
        assertNotEq(signer, verifier);
        vm.expectRevert(abi.encodeWithSelector(IStorePot.NotVerifier.selector, signer));
        store.settle(v, signature);
    }

    function test_aVerdictReplays() public {
        _open(_stake(1, 2));
        IStorePot.Verdict memory v = _verdict(1, _two(2 * STAKE, 0));
        bytes memory signature = _sign(verifierKey, store.verdictDigest(v));
        store.settle(v, signature);

        vm.expectRevert(_notOpen(1));
        store.settle(v, signature);
        assertEq(usdc.balanceOf(seat[0]), START + STAKE);
    }

    function test_aVerdictIsBoundToThisPotContract() public {
        vm.startPrank(admin);
        StorePot other = new StorePot(names, usdc, admin);
        other.grantRole(other.VERIFIER_ROLE(), verifier);
        vm.stopPrank();
        IStorePot.Verdict memory v = _verdict(1, _two(2 * STAKE, 0));
        bytes memory signature = _sign(verifierKey, other.verdictDigest(v));
        _open(_stake(1, 2));

        address signer = ECDSA.recover(store.verdictDigest(v), signature);
        assertNotEq(signer, verifier);
        vm.expectRevert(abi.encodeWithSelector(IStorePot.NotVerifier.selector, signer));
        store.settle(v, signature);
    }

    function test_aVoidSignatureIsntAVerdict() public {
        _open(_stake(1, 2));
        IStorePot.Void memory voiding = _void(1);
        bytes memory signature = _sign(verifierKey, store.voidDigest(voiding));
        IStorePot.Verdict memory v = _verdict(1, _two(2 * STAKE, 0));
        v.deadline = voiding.deadline;
        _expectForged(v, signature);
    }

    function test_aMalformedSignatureIsRefused() public {
        _open(_stake(1, 2));
        IStorePot.Verdict memory v = _verdict(1, _two(2 * STAKE, 0));
        (uint8 w, bytes32 r, bytes32 s) = vm.sign(verifierKey, store.verdictDigest(v));

        // The same signature with a high `s`: valid to `ecrecover`, and refused here.
        bytes32 highS = bytes32(SECP256K1_N - uint256(s));
        uint8 flipped = w == 27 ? 28 : 27;
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureS.selector, highS));
        store.settle(v, abi.encodePacked(r, highS, flipped));

        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, 64));
        store.settle(v, abi.encodePacked(r, s));

        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, 66));
        store.settle(v, abi.encodePacked(r, s, w, uint8(0)));

        vm.expectRevert(ECDSA.ECDSAInvalidSignature.selector);
        store.settle(v, abi.encodePacked(r, s, uint8(0)));

        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, 0));
        store.settle(v, "");

        store.settle(v, abi.encodePacked(r, s, w));
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Voiding
    // ----------------------------------------------------------------------------------------------------------------

    function test_voidSendsEachStakeBackAtOnce() public {
        _open(_stake(1, 4));
        vm.expectEmit(address(store));
        emit IStorePot.PotVoided(BOX, 1, STAKE, RECORD);
        _voidPot(_void(1));
        _assertEveryoneWhole(4);
        IStorePot.Pot memory p = store.getPot(BOX, 1);
        assertEq(uint8(p.state), uint8(IStorePot.State.Voided));
        assertEq(p.record, RECORD);
    }

    function test_aPotThatIsntOpenIsntVoided() public {
        IStorePot.Void memory v = _void(1);
        bytes memory signature = _sign(verifierKey, store.voidDigest(v));
        vm.expectRevert(_notOpen(1));
        store.voidPot(v, signature);

        _open(_stake(1, 2));
        store.voidPot(v, signature);
        vm.expectRevert(_notOpen(1));
        store.voidPot(v, signature);
        _assertEveryoneWhole(2);
    }

    function test_voidStopsAtTheDeadline() public {
        _open(_stake(1, 2));
        IStorePot.Void memory v = _void(1);
        v.deadline = block.timestamp + 1;
        bytes memory signature = _sign(verifierKey, store.voidDigest(v));

        vm.warp(v.deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(IBoxSigned.DeadlineExpired.selector, v.deadline));
        store.voidPot(v, signature);

        vm.warp(v.deadline);
        store.voidPot(v, signature);
        _assertEveryoneWhole(2);
    }

    function test_onlyAVerifierVoids() public {
        _open(_stake(1, 2));
        IStorePot.Void memory v = _void(1);
        (address stranger, uint256 strangerKey) = accountWithKey("stranger");
        bytes memory signature = _sign(strangerKey, store.voidDigest(v));
        vm.expectRevert(abi.encodeWithSelector(IStorePot.NotVerifier.selector, stranger));
        store.voidPot(v, signature);
    }

    function test_theVerifierSignsEveryFieldOfAVoid() public {
        _open(_stake(1, 2));
        _open(_stake(2, 2));
        IStorePot.Stake memory s = _stake(1, 2);
        s.box = OTHER_BOX;
        _open(s);
        IStorePot.Void memory v = _void(1);
        bytes memory signature = _sign(verifierKey, store.voidDigest(v));

        IStorePot.Void memory t = _void(1);
        t.box = OTHER_BOX;
        _expectForged(t, signature);
        _expectForged(_void(2), signature);
        t = _void(1);
        t.record = keccak256("a different record");
        _expectForged(t, signature);
        t = _void(1);
        t.deadline += 1;
        _expectForged(t, signature);

        store.voidPot(v, signature);
    }

    function _expectForged(IStorePot.Void memory v, bytes memory signature) internal {
        address signer = ECDSA.recover(store.voidDigest(v), signature);
        assertNotEq(signer, verifier);
        vm.expectRevert(abi.encodeWithSelector(IStorePot.NotVerifier.selector, signer));
        store.voidPot(v, signature);
    }

    function test_aVoidTakesOnlyALowSSignature() public {
        _open(_stake(1, 2));
        IStorePot.Void memory v = _void(1);
        (uint8 w, bytes32 r, bytes32 s) = vm.sign(verifierKey, store.voidDigest(v));
        bytes32 highS = bytes32(SECP256K1_N - uint256(s));
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureS.selector, highS));
        store.voidPot(v, abi.encodePacked(r, highS, w == 27 ? uint8(28) : uint8(27)));
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Refunds
    // ----------------------------------------------------------------------------------------------------------------

    function test_refundOnlyAfterTheDelay() public {
        _open(_stake(1, 3));
        uint256 at = block.timestamp + 1 hours;
        vm.expectRevert(abi.encodeWithSelector(IStorePot.TooEarly.selector, at));
        store.refund(BOX, 1);

        vm.warp(at - 1);
        vm.expectRevert(abi.encodeWithSelector(IStorePot.TooEarly.selector, at));
        store.refund(BOX, 1);

        vm.warp(at);
        vm.expectEmit(address(store));
        emit IStorePot.PotRefunded(BOX, 1, STAKE);
        vm.prank(account("anyone"));
        store.refund(BOX, 1);
        _assertEveryoneWhole(3);
        assertEq(_state(1), uint8(IStorePot.State.Refunded));
        assertEq(store.getPot(BOX, 1).record, bytes32(0));

        vm.expectRevert(_notOpen(1));
        store.refund(BOX, 1);
        vm.expectRevert(_notOpen(2));
        store.refund(BOX, 2);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Races: whichever ending lands first closes the pot
    // ----------------------------------------------------------------------------------------------------------------

    function test_aVerdictStillPaysAfterTheDelayUntilARefund() public {
        _open(_stake(1, 2));
        vm.warp(block.timestamp + 2 hours);
        _settle(_verdict(1, _two(2 * STAKE, 0)));
        assertEq(usdc.balanceOf(seat[0]), START + STAKE);
        vm.expectRevert(_notOpen(1));
        store.refund(BOX, 1);
        assertEq(usdc.balanceOf(seat[0]), START + STAKE);
    }

    function test_aRefundBeatsALateVerdict() public {
        _open(_stake(1, 2));
        IStorePot.Verdict memory v = _verdict(1, _two(2 * STAKE, 0));
        v.deadline = block.timestamp + 2 hours;
        bytes memory signature = _sign(verifierKey, store.verdictDigest(v));
        vm.warp(block.timestamp + 1 hours);
        store.refund(BOX, 1);
        vm.expectRevert(_notOpen(1));
        store.settle(v, signature);
        _assertEveryoneWhole(2);
    }

    function test_aVoidBeatsARefund() public {
        _open(_stake(1, 2));
        IStorePot.Void memory v = _void(1);
        v.deadline = block.timestamp + 2 hours;
        vm.warp(block.timestamp + 1 hours);
        _voidPot(v);
        vm.expectRevert(_notOpen(1));
        store.refund(BOX, 1);
        _assertEveryoneWhole(2);
    }

    function test_aRefundBeatsALateVoid() public {
        _open(_stake(1, 2));
        IStorePot.Void memory v = _void(1);
        v.deadline = block.timestamp + 2 hours;
        bytes memory signature = _sign(verifierKey, store.voidDigest(v));
        vm.warp(block.timestamp + 1 hours);
        store.refund(BOX, 1);
        vm.expectRevert(_notOpen(1));
        store.voidPot(v, signature);
        _assertEveryoneWhole(2);
    }

    function test_aVerdictBeatsAVoid() public {
        _open(_stake(1, 2));
        IStorePot.Void memory voiding = _void(1);
        bytes memory signature = _sign(verifierKey, store.voidDigest(voiding));
        _settle(_verdict(1, _two(2 * STAKE, 0)));
        vm.expectRevert(_notOpen(1));
        store.voidPot(voiding, signature);
        assertEq(usdc.balanceOf(seat[0]), START + STAKE);
    }

    function test_aVoidBeatsAVerdict() public {
        _open(_stake(1, 2));
        IStorePot.Verdict memory v = _verdict(1, _two(2 * STAKE, 0));
        bytes memory signature = _sign(verifierKey, store.verdictDigest(v));
        _voidPot(_void(1));
        vm.expectRevert(_notOpen(1));
        store.settle(v, signature);
        _assertEveryoneWhole(2);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // A Box that stops being live doesn't trap the money
    // ----------------------------------------------------------------------------------------------------------------

    function test_aPotOutlivesItsBox() public {
        _open(_stake(1, 2));
        _open(_stake(2, 2));
        _open(_stake(3, 2));
        vm.prank(admin);
        names.setBoxStatus(BOX, IGameBoxNames.BoxStatus.Suspended);
        vm.warp(block.timestamp + 2 days);

        _settle(_verdict(1, _two(STAKE, STAKE)));
        _voidPot(_void(2));
        store.refund(BOX, 3);
        _assertEveryoneWhole(2);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Role rotation
    // ----------------------------------------------------------------------------------------------------------------

    function test_rotatingTheVerifierKey() public {
        _open(_stake(1, 2));
        _open(_stake(2, 2));
        (address next, uint256 nextKey) = accountWithKey("next-verifier");
        IStorePot.Verdict memory v = _verdict(1, _two(2 * STAKE, 0));
        bytes memory oldSignature = _sign(verifierKey, store.verdictDigest(v));
        IStorePot.Void memory voiding = _void(2);
        bytes memory oldVoid = _sign(verifierKey, store.voidDigest(voiding));

        bytes32 role = store.VERIFIER_ROLE();
        vm.startPrank(admin);
        store.grantRole(role, next);
        store.revokeRole(role, verifier);
        vm.stopPrank();

        // A key is checked when its signature lands, so what the old key signed before now fails.
        vm.expectRevert(abi.encodeWithSelector(IStorePot.NotVerifier.selector, verifier));
        store.settle(v, oldSignature);
        vm.expectRevert(abi.encodeWithSelector(IStorePot.NotVerifier.selector, verifier));
        store.voidPot(voiding, oldVoid);

        // And the new key closes pots that opened before it.
        store.settle(v, _sign(nextKey, store.verdictDigest(v)));
        store.voidPot(voiding, _sign(nextKey, store.voidDigest(voiding)));
        assertEq(usdc.balanceOf(address(store)), 0);
    }

    function test_twoVerifiersCanOverlapDuringARotation() public {
        (address next, uint256 nextKey) = accountWithKey("next-verifier");
        bytes32 role = store.VERIFIER_ROLE();
        vm.prank(admin);
        store.grantRole(role, next);

        _open(_stake(1, 2));
        _open(_stake(2, 2));
        _settle(_verdict(1, _two(STAKE, STAKE)));
        IStorePot.Verdict memory v = _verdict(2, _two(STAKE, STAKE));
        store.settle(v, _sign(nextKey, store.verdictDigest(v)));
        _assertEveryoneWhole(2);
    }

    function test_onlyTheAdminRotates() public {
        bytes32 role = store.VERIFIER_ROLE();
        bytes32 adminRole = store.DEFAULT_ADMIN_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, verifier, adminRole)
        );
        vm.prank(verifier);
        store.grantRole(role, verifier);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, lister, adminRole)
        );
        vm.prank(lister);
        store.revokeRole(role, verifier);
    }

    function test_rotatingTheLister() public {
        address next = account("next-lister");
        bytes32 role = store.LISTER_ROLE();
        vm.startPrank(admin);
        store.grantRole(role, next);
        store.revokeRole(role, lister);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, lister, role));
        vm.prank(lister);
        store.list(OTHER_BUNDLE);
        vm.prank(next);
        store.list(OTHER_BUNDLE);

        // What was listed stays listed.
        _open(_stake(1, 2));
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Money in, money out
    // ----------------------------------------------------------------------------------------------------------------

    /// @dev `count` payouts that add up to exactly `total`, cut at the fuzzer's points.
    function _split(uint256 total, uint256 count, uint256[3] memory cuts)
        internal
        pure
        returns (uint256[] memory payouts)
    {
        payouts = new uint256[](count);
        uint256 left = total;
        for (uint256 i; i + 1 < count; ++i) {
            payouts[i] = cuts[i] % (left + 1);
            left -= payouts[i];
        }
        payouts[count - 1] = left;
    }

    /// @dev A pot sits next to another open pot, so a payout of a unit too much would come out of the other's money
    ///      rather than revert for want of a balance.
    function testFuzz_aPotPaysOutExactlyWhatItTook(uint256 count, uint256 amount, uint256[3] memory cuts, uint8 ending)
        public
    {
        count = bound(count, 2, 4);
        amount = bound(amount, 1, START);
        IStorePot.Stake memory s = _stake(1, count);
        s.amount = amount;
        _open(s);
        _bystanders();
        uint256 held = usdc.balanceOf(address(store));
        uint256 supply = usdc.totalSupply();
        uint256[] memory before = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            before[i] = usdc.balanceOf(seat[i]);
        }

        uint256[] memory paid;
        if (ending % 3 == 0) {
            paid = _split(amount * count, count, cuts);
            _settle(_verdict(1, paid));
        } else {
            paid = new uint256[](count);
            for (uint256 i; i < count; ++i) {
                paid[i] = amount;
            }
            if (ending % 3 == 1) {
                _voidPot(_void(1));
            } else {
                vm.warp(block.timestamp + 1 hours);
                store.refund(BOX, 1);
            }
        }

        uint256 out;
        for (uint256 i; i < count; ++i) {
            assertEq(usdc.balanceOf(seat[i]), before[i] + paid[i]);
            out += paid[i];
        }
        assertEq(out, amount * count);
        assertEq(usdc.balanceOf(address(store)), held - out);
        assertEq(usdc.totalSupply(), supply);
    }

    /// @dev Another Box's pot held open beside the one under test, staked by a pair who aren't in it.
    function _bystanders() internal {
        address[] memory players = new address[](2);
        players[0] = account("bystander-0");
        players[1] = account("bystander-1");
        vm.startPrank(admin);
        usdc.mint(players[0], 1_000e6);
        usdc.mint(players[1], 1_000e6);
        vm.stopPrank();
        _open(IStorePot.Stake(OTHER_BOX, BUNDLE, 1, players, 1_000e6, block.timestamp + 1 hours));
    }

    function testFuzz_anyOtherSumIsRefused(uint256 count, uint256[3] memory cuts, uint256 extra, bool over) public {
        count = bound(count, 2, 4);
        _open(_stake(1, count));
        _bystanders();
        uint256 total = STAKE * count;
        uint256[] memory payouts = _split(total, count, cuts);

        // Move the last seat's payout by at least a unit, up or down, so the sum misses the pot.
        uint256 last = payouts[count - 1];
        uint256 sum;
        if (over || last == 0) {
            extra = bound(extra, 1, type(uint128).max);
            payouts[count - 1] = last + extra;
            sum = total + extra;
        } else {
            extra = bound(extra, 1, last);
            payouts[count - 1] = last - extra;
            sum = total - extra;
        }
        _expectRefused(_verdict(1, payouts), abi.encodeWithSelector(IStorePot.PayoutSum.selector, total, sum));
    }

    /// @dev A random run over many pots of one Box: at every step the contract holds exactly what its open pots took.
    function testFuzz_thePotContractHoldsExactlyItsOpenPots(uint256 seed) public {
        uint256 rounds = 6;
        uint256 held;
        for (uint256 round = 1; round <= rounds; ++round) {
            uint256 count = 2 + uint256(keccak256(abi.encode(seed, round, "count"))) % 3;
            _open(_stake(round, count));
            held += STAKE * count;
            assertEq(usdc.balanceOf(address(store)), held);
        }
        vm.warp(block.timestamp + 1 hours);
        for (uint256 round = 1; round <= rounds; ++round) {
            uint256 count = store.getPot(BOX, round).players.length;
            uint256 pick = uint256(keccak256(abi.encode(seed, round, "ending")));
            if (pick % 3 == 0) {
                uint256[3] memory cuts = [pick >> 8, pick >> 72, pick >> 136];
                _settle(_verdict(round, _split(STAKE * count, count, cuts)));
            } else if (pick % 3 == 1) {
                _voidPot(_void(round));
            } else {
                store.refund(BOX, round);
            }
            held -= STAKE * count;
            assertEq(usdc.balanceOf(address(store)), held);
        }
        assertEq(held, 0);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // The domain
    // ----------------------------------------------------------------------------------------------------------------

    function test_domain() public view {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = store.eip712Domain();
        assertEq(name, "Game Box Store Pots");
        assertEq(version, "1");
        assertEq(chainId, 11155111);
        assertEq(verifying, address(store));
        assertEq(
            store.STAKE_TYPEHASH(),
            keccak256(
                "Stake(string box,bytes32 bundle,uint256 round,address[] players,uint256 amount,uint256 deadline)"
            )
        );
        assertEq(
            store.VERDICT_TYPEHASH(),
            keccak256("Verdict(string box,uint256 round,uint256[] payouts,bytes32 record,uint256 deadline)")
        );
        assertEq(store.VOID_TYPEHASH(), keccak256("Void(string box,uint256 round,bytes32 record,uint256 deadline)"));
    }

    function test_constants() public view {
        assertEq(store.LISTER_ROLE(), keccak256("LISTER_ROLE"));
        assertEq(store.VERIFIER_ROLE(), keccak256("VERIFIER_ROLE"));
        assertEq(store.MIN_PLAYERS(), 2);
        assertEq(store.MAX_PLAYERS(), 4);
        assertEq(uint256(store.REFUND_DELAY()), 1 hours);
        assertEq(address(store.NAMES()), address(names));
        assertEq(address(store.USDC()), address(usdc));
    }
}
