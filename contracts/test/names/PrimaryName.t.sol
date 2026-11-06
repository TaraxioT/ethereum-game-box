// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {NamesFork} from "./NamesFork.sol";

/// @notice ENS's `default.reverse` registrar on Sepolia (`ens-contracts/contracts/reverseRegistrar`).
interface IDefaultReverseRegistrar {
    error InvalidSignature();
    error SignatureExpired();
    error SignatureExpiryTooHigh();

    function setNameForAddrWithSignature(
        address addr,
        uint256 signatureExpiry,
        string calldata name,
        bytes calldata sig
    ) external;
}

/// @notice ENS's `addr.reverse` registrar on Sepolia.
interface IReverseRegistrar {
    function setName(string calldata name) external returns (bytes32);
}

/// @notice The Universal Resolver's reverse lookup: what viem's `getEnsName` calls.
interface IReverseResolution {
    function reverse(bytes calldata lookupAddress, uint256 coinType)
        external
        view
        returns (string memory primary, address resolver, address reverseResolver);
}

/// @notice A badge sets `<player>.gamebox.eth` as its primary name, so `getEnsName(badge)` returns it. After the claim,
///         the badge signs ENS's `default.reverse` message and anyone (the relayer) submits it: no ETH needed. A badge
///         with ETH can instead call the `addr.reverse` registrar itself.
contract PrimaryNameTest is NamesFork {
    IDefaultReverseRegistrar internal defaultReverse;
    IReverseRegistrar internal addrReverse;

    function setUp() public override {
        super.setUp();
        string memory json = vm.readFile("../deployments/sepolia.json");
        defaultReverse = IDefaultReverseRegistrar(vm.parseJsonAddress(json, ".ens.DefaultReverseRegistrar.address"));
        addrReverse = IReverseRegistrar(vm.parseJsonAddress(json, ".ens.ReverseRegistrar.address"));
    }

    function _primaryNameSignature(uint256 key, address badge, uint256 expiry, string memory name)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(
                abi.encodePacked(
                    address(defaultReverse),
                    IDefaultReverseRegistrar.setNameForAddrWithSignature.selector,
                    badge,
                    expiry,
                    name
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _getEnsName(address a) internal view returns (string memory) {
        (bool ok, bytes memory ret) =
            address(universalResolver).staticcall(abi.encodeCall(IReverseResolution.reverse, (abi.encodePacked(a), 60)));
        if (!ok) return "";
        (string memory name,,) = abi.decode(ret, (string, address, address));
        return name;
    }

    function test_badgeSignsItsPrimaryNameAndAnyoneSubmitsIt() public {
        (address badge, uint256 key) = claim("egbt-alice");
        assertEq(_getEnsName(badge), "");
        uint256 expiry = block.timestamp + 30 minutes;
        bytes memory signature = _primaryNameSignature(key, badge, expiry, "egbt-alice.gamebox.eth");
        vm.prank(account("relayer"));
        defaultReverse.setNameForAddrWithSignature(badge, expiry, "egbt-alice.gamebox.eth", signature);
        assertEq(_getEnsName(badge), "egbt-alice.gamebox.eth");
    }

    function test_aBadgeWithEthSetsItItself() public {
        (address badge,) = claim("egbt-alice");
        vm.prank(badge);
        addrReverse.setName("egbt-alice.gamebox.eth");
        assertEq(_getEnsName(badge), "egbt-alice.gamebox.eth");
    }

    function test_theSignatureIsTheBadgesAndShortLived() public {
        (address badge, uint256 key) = claim("egbt-alice");
        (, uint256 otherKey) = accountWithKey("not-the-badge");
        uint256 expiry = block.timestamp + 30 minutes;
        bytes memory wrong = _primaryNameSignature(otherKey, badge, expiry, "egbt-alice.gamebox.eth");
        vm.expectRevert(IDefaultReverseRegistrar.InvalidSignature.selector);
        defaultReverse.setNameForAddrWithSignature(badge, expiry, "egbt-alice.gamebox.eth", wrong);

        uint256 far = block.timestamp + 2 hours;
        bytes memory tooLong = _primaryNameSignature(key, badge, far, "egbt-alice.gamebox.eth");
        vm.expectRevert(IDefaultReverseRegistrar.SignatureExpiryTooHigh.selector);
        defaultReverse.setNameForAddrWithSignature(badge, far, "egbt-alice.gamebox.eth", tooLong);
    }

    /// @dev A primary name only shows if the name resolves back to the badge, so nobody can claim another's.
    function test_aNameThatIsntYoursDoesntShow() public {
        claim("egbt-alice");
        (address mallory, uint256 key) = accountWithKey("mallory");
        uint256 expiry = block.timestamp + 30 minutes;
        bytes memory signature = _primaryNameSignature(key, mallory, expiry, "egbt-alice.gamebox.eth");
        defaultReverse.setNameForAddrWithSignature(mallory, expiry, "egbt-alice.gamebox.eth", signature);
        assertEq(_getEnsName(mallory), "");
    }
}
