// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IUniversalResolver} from "../../src/names/IENSv2.sol";
import {NamesFork} from "./NamesFork.sol";

/// @notice The whole flow on the Sepolia fork, every read through the Universal Resolver: set up `gamebox.eth`, claim
///         two players, register a Box, play a signed result, crown, move the title, expire a pop-up.
contract EndToEndTest is NamesFork {
    function test_wholeFlow() public {
        // gamebox.eth is ours: the games resolve.
        assertEq(resolveText("quickdraw.gamebox.eth", "title"), "champion.quickdraw.gamebox.eth");
        assertEq(resolveText("quickdraw.gamebox.eth", "titleTerm"), "900");

        // Two players.
        (address alice,) = claim("egbt-alice");
        (address bob,) = claim("egbt-bob");
        assertEq(resolveAddr("egbt-alice.gamebox.eth"), alice);
        assertEq(resolveAddr("egbt-bob.gamebox.eth"), bob);

        // A Box.
        registerBox("egbt-mumbai", 30 days);
        assertEq(resolveAddr("egbt-mumbai.gamebox.eth"), address(demoBox));
        assertEq(resolveText("egbt-mumbai.gamebox.eth", "status"), "active");

        // A signed result crowns Alice and writes both players' stats.
        submit(result("egbt-mumbai", "quickdraw", 1, alice, bob, false));
        assertEq(resolveAddr("champion.quickdraw.gamebox.eth"), alice);
        assertEq(resolveText("champion.quickdraw.gamebox.eth", "holder"), "egbt-alice.gamebox.eth");
        assertEq(resolveText("champion.quickdraw.gamebox.eth", "streak"), "1");
        assertEq(resolveText("egbt-alice.gamebox.eth", "stats"), '{"quickdraw":{"wins":1,"losses":0,"draws":0}}');
        assertEq(resolveText("egbt-bob.gamebox.eth", "stats"), '{"quickdraw":{"wins":0,"losses":1,"draws":0}}');

        // Bob wins: the title moves.
        submit(result("egbt-mumbai", "quickdraw", 2, bob, alice, false));
        assertEq(resolveAddr("champion.quickdraw.gamebox.eth"), bob);
        assertEq(resolveText("champion.quickdraw.gamebox.eth", "holder"), "egbt-bob.gamebox.eth");
        assertEq(resolveText("champion.quickdraw.gamebox.eth", "round"), "2");

        // A pop-up resolves for 10 minutes, then doesn't.
        licences.openPopup("egbt");
        assertEq(resolveAddr("popup-egbt.gamebox.eth"), address(demoBox));
        vm.warp(block.timestamp + 10 minutes);
        assertEq(resolveAddr("popup-egbt.gamebox.eth"), address(0));
        assertEq(
            resolveError("popup-egbt.gamebox.eth"),
            abi.encodeWithSelector(IUniversalResolver.ResolverNotFound.selector, dns("popup-egbt.gamebox.eth"))
        );

        // So has the Quick Draw title (15 minutes after Bob's win, which was also 10 minutes ago): 5 more minutes.
        assertEq(resolveAddr("champion.quickdraw.gamebox.eth"), bob);
        vm.warp(block.timestamp + 5 minutes);
        assertEq(resolveAddr("champion.quickdraw.gamebox.eth"), address(0));
        assertEq(resolveText("champion.quickdraw.gamebox.eth", "holder"), "");
    }
}
