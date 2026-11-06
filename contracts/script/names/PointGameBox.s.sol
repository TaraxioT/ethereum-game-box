// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DefaultRecord} from "../../src/names/DefaultRecord.sol";
import {IPermissionedRegistry, IRegistry, IVerifiableFactory} from "../../src/names/IENSv2.sol";
import {NamesScript} from "./NamesScript.sol";

/// @notice Points `gamebox.eth` at our names: its subregistry at the registry `GameBoxNames` created, and its resolver
///         at its own `PermissionedResolver` holding the default record (`DefaultRecord`), deployed here through ENS's
///         `VerifiableFactory` with the deployer as its only root holder. Only the `.eth` owner of `gamebox.eth`
///         (holding `SET_SUBREGISTRY` and `SET_RESOLVER` on it) can run it. It grants and revokes nothing on
///         `gamebox.eth` itself. Skips what is done.
contract PointGameBox is NamesScript {
    uint256 internal constant GAMEBOX = uint256(keccak256("gamebox"));
    /// @notice The `VerifiableFactory` salt of `gamebox.eth`'s resolver (the factory salts by sender too).
    uint256 internal constant RESOLVER_SALT = uint256(keccak256("gamebox.eth resolver"));

    function run() external {
        IPermissionedRegistry eth = IPermissionedRegistry(_ens("ETHRegistry"));
        IVerifiableFactory factory = IVerifiableFactory(_ens("VerifiableFactory"));
        IRegistry registry = IRegistry(address(_names().REGISTRY()));
        vm.startBroadcast();
        (, address sender,) = vm.readCallers();
        require(
            eth.getOwner(GAMEBOX) == sender,
            "PointGameBox: the deployer doesn't own gamebox.eth; move it to the deployer first"
        );
        if (address(eth.getSubregistry("gamebox")) != address(registry)) eth.setSubregistry(GAMEBOX, registry);

        address resolver = factory.predictProxyAddress(sender, RESOLVER_SALT);
        if (resolver.code.length == 0) {
            factory.deployProxy{gas: CREATE_GAS}(
                _ens("PermissionedResolverImpl"), RESOLVER_SALT, DefaultRecord.initData(sender)
            );
        }
        if (eth.getResolver("gamebox") != resolver) eth.setResolver(GAMEBOX, resolver);
        vm.stopBroadcast();
        _saveAddress(".names.gameboxResolver", resolver);
    }
}
