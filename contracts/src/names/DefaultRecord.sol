// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Grant, IPermissionedResolver, ResolverRoles} from "./IENSv2.sol";

/// @title DefaultRecord
/// @notice `gamebox.eth`'s own `PermissionedResolver` and the default record it holds. The Universal Resolver keeps the
///         deepest resolver it finds on the way down, so a `*.gamebox.eth` name that is unregistered or has expired
///         (no resolver of its own) is resolved here, with its full name (ENSIP-10 wildcard). That name has no record,
///         so it reads the default record: the one the empty name `0x00` uses. It has a `url` (where to claim a name)
///         and a `description`, and no `addr`.
library DefaultRecord {
    /// @notice Where a free name can be claimed.
    string internal constant URL = "https://gamebox-names.pages.dev/#/players";
    /// @notice What a free name says about itself.
    string internal constant DESCRIPTION = "This Game Box name is free.";
    /// @notice The empty name, DNS-encoded: its record is the default.
    bytes internal constant ROOT_NAME = hex"00";
    /// @notice The resolver's owner holds `SET_TEXT` and its admin on the root, and nothing else: it can rewrite the
    ///         default record and hand that on, and nobody can upgrade the resolver.
    uint256 internal constant OWNER_ROLES = ResolverRoles.SET_TEXT | ResolverRoles.SET_TEXT_ADMIN;

    /// @notice The `initialize` calldata of the resolver: `owner`'s roles, and the default record written.
    /// @param owner Who holds `OWNER_ROLES` (the owner of `gamebox.eth`).
    function initData(address owner) internal pure returns (bytes memory) {
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(owner, OWNER_ROLES);
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(IPermissionedResolver.setText, (ROOT_NAME, "url", URL));
        calls[1] = abi.encodeCall(IPermissionedResolver.setText, (ROOT_NAME, "description", DESCRIPTION));
        return abi.encodeCall(IPermissionedResolver.initialize, (grants, calls));
    }
}
