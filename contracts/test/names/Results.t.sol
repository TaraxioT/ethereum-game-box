// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IBoxResults} from "../../src/names/IBoxResults.sol";
import {NamesFork} from "./NamesFork.sol";

contract ResultsTest is NamesFork {
    string internal constant BOX = "egbt-box";
    address internal alice;
    address internal bob;

    function setUp() public override {
        super.setUp();
        registerBox(BOX, 1 days);
        (alice,) = claim("egbt-alice");
        (bob,) = claim("egbt-bob");
    }

    function _expectRefused(IBoxResults.Result memory r, bytes memory error) internal {
        (bytes32 sr, bytes32 ss) = p256Sign(boxKey, results.resultDigest(r));
        vm.expectRevert(error);
        results.submit(r, sr, ss);
    }

    function test_submitSettles() public {
        IBoxResults.Result memory r = result(BOX, "stockduel", 7, alice, bob, false);
        vm.expectEmit(address(results));
        emit IBoxResults.ResultSubmitted(BOX, "stockduel", 7, alice, bob, false);
        submit(r);
        assertTrue(results.roundUsed(BOX, 7));
        assertFalse(results.roundUsed(BOX, 8));
        assertEq(stats.statsOf(alice, "stockduel").wins, 1);
        assertEq(names.getTitle("stockduel").holder, alice);
    }

    function test_unknownBox() public {
        _expectRefused(
            result("egbt-nobox", "stockduel", 1, alice, bob, false),
            abi.encodeWithSelector(IBoxResults.UnknownBox.selector, "egbt-nobox")
        );
    }

    function test_expiredBox() public {
        vm.warp(block.timestamp + 1 days);
        _expectRefused(
            result(BOX, "stockduel", 1, alice, bob, false), abi.encodeWithSelector(IBoxResults.BoxExpired.selector, BOX)
        );
    }

    function test_usedRound() public {
        submit(result(BOX, "stockduel", 1, alice, bob, false));
        _expectRefused(
            result(BOX, "stockduel", 1, bob, alice, false),
            abi.encodeWithSelector(IBoxResults.RoundUsed.selector, BOX, 1)
        );
    }

    function test_expiredDeadline() public {
        IBoxResults.Result memory r = result(BOX, "stockduel", 1, alice, bob, false);
        r.deadline = block.timestamp - 1;
        _expectRefused(r, abi.encodeWithSelector(IBoxResults.DeadlineExpired.selector, r.deadline));
    }

    function test_playersNeedNames() public {
        address stranger = account("stranger");
        _expectRefused(
            result(BOX, "stockduel", 1, stranger, bob, false),
            abi.encodeWithSelector(IBoxResults.NotAPlayer.selector, stranger)
        );
        _expectRefused(
            result(BOX, "stockduel", 1, alice, stranger, true),
            abi.encodeWithSelector(IBoxResults.NotAPlayer.selector, stranger)
        );
    }

    function test_winnerIsNotTheLoser() public {
        _expectRefused(
            result(BOX, "stockduel", 1, alice, alice, false),
            abi.encodeWithSelector(IBoxResults.SamePlayer.selector, alice)
        );
    }

    function test_badSignatures() public {
        IBoxResults.Result memory r = result(BOX, "stockduel", 1, alice, bob, false);
        (bytes32 sr, bytes32 ss) = p256Sign(p256Key("egb-test-not-the-box"), results.resultDigest(r));
        vm.expectRevert(IBoxResults.InvalidSignature.selector);
        results.submit(r, sr, ss);

        (sr, ss) = p256Sign(boxKey, results.resultDigest(r));
        vm.expectRevert(IBoxResults.InvalidSignature.selector);
        results.submit(r, sr, bytes32(P256_N - uint256(ss)));

        // The signature covers every field: a changed winner fails.
        r.winner = bob;
        r.loser = alice;
        vm.expectRevert(IBoxResults.InvalidSignature.selector);
        results.submit(r, sr, ss);
    }

    function test_domain() public view {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = results.eip712Domain();
        assertEq(name, "Game Box Results");
        assertEq(version, "1");
        assertEq(chainId, 11155111);
        assertEq(verifying, address(results));
    }
}
