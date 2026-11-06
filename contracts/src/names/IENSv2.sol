// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// The slice of ENSv2 that the Game Box calls, checked against the Sepolia deployment's source:
// github.com/ensdomains/contracts-v2, branch `deploy/mainnet-v2-20261002`, `contracts/src/`, and
// github.com/ensdomains/verifiable-factory at the commit in its `foundry.lock`. Every signature, role bit and
// error below is copied from there; nothing is ours.

/// @notice A root grant passed to a registry's or resolver's `initialize`.
/// @dev `access-control/interfaces/IEACGrantInitializable.sol`.
struct Grant {
    address account;
    uint256 roleBitmap;
}

/// @notice `PermissionedRegistry` role bits (`registry/libraries/RegistryRolesLib.sol`). One nybble per role; each
///         admin role is its role shifted 128 bits up.
library RegistryRoles {
    uint256 internal constant REGISTRAR = 1 << 0;
    uint256 internal constant REGISTRAR_ADMIN = REGISTRAR << 128;
    uint256 internal constant REGISTER_RESERVED = 1 << 4;
    uint256 internal constant REGISTER_RESERVED_ADMIN = REGISTER_RESERVED << 128;
    uint256 internal constant SET_PARENT = 1 << 8;
    uint256 internal constant SET_PARENT_ADMIN = SET_PARENT << 128;
    uint256 internal constant UNREGISTER = 1 << 12;
    uint256 internal constant UNREGISTER_ADMIN = UNREGISTER << 128;
    uint256 internal constant RENEW = 1 << 16;
    uint256 internal constant RENEW_ADMIN = RENEW << 128;
    uint256 internal constant SET_SUBREGISTRY = 1 << 20;
    uint256 internal constant SET_SUBREGISTRY_ADMIN = SET_SUBREGISTRY << 128;
    uint256 internal constant SET_RESOLVER = 1 << 24;
    uint256 internal constant SET_RESOLVER_ADMIN = SET_RESOLVER << 128;
    uint256 internal constant CAN_TRANSFER_ADMIN = (1 << 28) << 128;
    uint256 internal constant SET_URI = 1 << 36;
    uint256 internal constant SET_URI_ADMIN = SET_URI << 128;
    uint256 internal constant CAN_NAME = 1 << 120;
    uint256 internal constant CAN_NAME_ADMIN = CAN_NAME << 128;
    uint256 internal constant UPGRADE = 1 << 124;
    uint256 internal constant UPGRADE_ADMIN = UPGRADE << 128;
}

/// @notice `PermissionedResolver` role bits (`resolver/libraries/PermissionedResolverLib.sol`).
library ResolverRoles {
    uint256 internal constant SET_ADDRESS = 1 << 0;
    uint256 internal constant SET_ADDRESS_ADMIN = SET_ADDRESS << 128;
    uint256 internal constant SET_TEXT = 1 << 4;
    uint256 internal constant SET_TEXT_ADMIN = SET_TEXT << 128;
    uint256 internal constant SET_CONTENTHASH = 1 << 8;
    uint256 internal constant SET_CONTENTHASH_ADMIN = SET_CONTENTHASH << 128;
    uint256 internal constant SET_ABI = 1 << 12;
    uint256 internal constant SET_ABI_ADMIN = SET_ABI << 128;
    uint256 internal constant SET_INTERFACE = 1 << 16;
    uint256 internal constant SET_INTERFACE_ADMIN = SET_INTERFACE << 128;
    uint256 internal constant SET_NAME = 1 << 20;
    uint256 internal constant SET_NAME_ADMIN = SET_NAME << 128;
    uint256 internal constant SET_DATA = 1 << 24;
    uint256 internal constant SET_DATA_ADMIN = SET_DATA << 128;
    uint256 internal constant LINK = 1 << 28;
    uint256 internal constant LINK_ADMIN = LINK << 128;
    uint256 internal constant CAN_NAME = 1 << 120;
    uint256 internal constant CAN_NAME_ADMIN = CAN_NAME << 128;
    uint256 internal constant UPGRADE = 1 << 124;
    uint256 internal constant UPGRADE_ADMIN = UPGRADE << 128;

    /// @notice The resource a text key's roles live on: `uint256(keccak256(bytes(key)))`.
    function textResource(string memory key) internal pure returns (uint256) {
        return uint256(keccak256(bytes(key)));
    }

    /// @notice The resource a coin type's roles live on: `uint256(keccak256(abi.encode(coinType)))`.
    function addressResource(uint256 coinType) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(coinType)));
    }
}

/// @notice `access-control/interfaces/IEnhancedAccessControl.sol`.
interface IEnhancedAccessControl {
    event EACRolesChanged(
        uint256 indexed resource, address indexed account, uint256 oldRoleBitmap, uint256 newRoleBitmap
    );

    error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account);
    error EACCannotGrantRoles(uint256 resource, uint256 roleBitmap, address account);
    error EACCannotRevokeRoles(uint256 resource, uint256 roleBitmap, address account);
    error EACRootResourceNotAllowed();
    error EACMaxAssignees(uint256 resource, uint256 role);
    error EACMinAssignees(uint256 resource, uint256 role);
    error EACInvalidRoleBitmap(uint256 roleBitmap);
    error EACInvalidAccount();

    /// @notice Grants `roleBitmap` on `resource` (never the root) to `account`.
    function grantRoles(uint256 resource, uint256 roleBitmap, address account) external returns (bool);
    /// @notice Grants `roleBitmap` on the root resource to `account`.
    function grantRootRoles(uint256 roleBitmap, address account) external returns (bool);
    /// @notice Revokes `roleBitmap` on `resource` (never the root) from `account`.
    function revokeRoles(uint256 resource, uint256 roleBitmap, address account) external returns (bool);
    /// @notice Revokes `roleBitmap` on the root resource from `account`.
    function revokeRootRoles(uint256 roleBitmap, address account) external returns (bool);
    /// @notice The root resource id (0).
    function ROOT_RESOURCE() external view returns (uint256);
    /// @notice The roles `account` holds on `resource` itself (not counting the root).
    function roles(uint256 resource, address account) external view returns (uint256);
    /// @notice Packed 4-bit assignee counts per role on `resource`.
    function roleCount(uint256 resource) external view returns (uint256);
    /// @notice Whether `account` holds every role in `roleBitmap` on the root resource.
    function hasRootRoles(uint256 roleBitmap, address account) external view returns (bool);
    /// @notice Whether `account` holds every role in `roleBitmap` on `resource` or the root resource.
    function hasRoles(uint256 resource, uint256 roleBitmap, address account) external view returns (bool);
}

/// @notice `registry/interfaces/IRegistry.sol` with `IRegistryEvents.sol`.
interface IRegistry {
    event LabelRegistered(
        uint256 indexed tokenId,
        bytes32 indexed labelHash,
        string label,
        address owner,
        uint64 expiry,
        address indexed sender
    );
    event LabelUnregistered(uint256 indexed tokenId, address indexed sender);
    event ExpiryUpdated(uint256 indexed tokenId, uint64 indexed newExpiry, address indexed sender);
    event SubregistryUpdated(uint256 indexed tokenId, IRegistry indexed subregistry, address indexed sender);
    event ResolverUpdated(uint256 indexed tokenId, address indexed resolver, address indexed sender);
    event TokenRegenerated(uint256 indexed oldTokenId, uint256 indexed newTokenId);
    event ParentUpdated(IRegistry indexed parent, string label, address indexed sender);

    /// @notice The child registry of `label`, or zero once it has expired.
    function getSubregistry(string calldata label) external view returns (IRegistry);
    /// @notice The resolver of `label`, or zero once it has expired.
    function getResolver(string calldata label) external view returns (address);
    /// @notice The canonical parent registry and this registry's label in it.
    function getParent() external view returns (IRegistry parent, string memory label);
}

/// @notice `registry/interfaces/IPermissionedRegistry.sol` with the parts of `IStandardRegistry.sol`,
///         `ITemporalRegistry.sol`, `IOwnedRegistry.sol`, `IERC1155Singleton.sol` and `UserRegistry.sol` we call.
interface IPermissionedRegistry is IRegistry, IEnhancedAccessControl {
    enum Status {
        AVAILABLE,
        RESERVED,
        REGISTERED
    }

    struct State {
        Status status;
        uint64 expiry;
        address latestOwner;
        uint256 tokenId;
        uint256 resource;
    }

    error LabelAlreadyRegistered(string label);
    error LabelAlreadyReserved(string label);
    error LabelExpired(uint256 tokenId);
    error CannotReduceExpiry(uint64 oldExpiry, uint64 newExpiry);
    error CannotSetPastExpiry(uint64 expiry);
    error TransferDisallowed(uint256 tokenId, address from);
    error TransferUnsafeUntilRegistryIsEmancipated();
    error TransferUnsafeWithMultipleAssignees(uint256 tokenId, address from);

    /// @notice Registers `label` to `owner`, granting `roleBitmap` on its token. Needs root `REGISTRAR`.
    function register(
        string calldata label,
        address owner,
        IRegistry registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId);
    /// @notice Moves the expiry of `anyId` later. A lapsed name that nobody registered again is revived by root
    ///         `RENEW`.
    function renew(uint256 anyId, uint64 newExpiry) external;
    /// @notice Burns the token of `anyId` and makes it available. Needs `UNREGISTER`.
    function unregister(uint256 anyId) external;
    /// @notice Points `anyId` at a child registry. Needs `SET_SUBREGISTRY`.
    function setSubregistry(uint256 anyId, IRegistry registry) external;
    /// @notice Points `anyId` at a resolver. Needs `SET_RESOLVER`.
    function setResolver(uint256 anyId, address resolver) external;
    /// @notice Sets this registry's canonical parent and label. Needs root `SET_PARENT`.
    function setParent(IRegistry parent, string calldata label) external;
    /// @notice The expiry of `anyId` (a labelhash, token id or resource).
    function getExpiry(uint256 anyId) external view returns (uint64);
    /// @notice The roles resource of `anyId`.
    function getResource(uint256 anyId) external view returns (uint256);
    /// @notice The current token id of `anyId`.
    function getTokenId(uint256 anyId) external view returns (uint256);
    /// @notice The owner of `anyId`, or zero once it has expired.
    function getOwner(uint256 anyId) external view returns (address);
    /// @notice The status of `anyId`.
    function getStatus(uint256 anyId) external view returns (Status);
    /// @notice The full state of `anyId`.
    function getState(uint256 anyId) external view returns (State memory);
    /// @notice Whether root holds no role that controls a registered token.
    function isEmancipated() external view returns (bool);
    /// @notice The owner of `tokenId`, or zero if it is stale or expired.
    function ownerOf(uint256 tokenId) external view returns (address);
    /// @notice ERC-1155 balance of `account` for token `id` (0 or 1).
    function balanceOf(address account, uint256 id) external view returns (uint256);
    /// @notice A transfer that skips the emancipation check (`IUnsafeTransferable`). Reverts `TransferDisallowed`
    ///         without `CAN_TRANSFER_ADMIN`.
    function unsafeTransfer(address to, uint256 tokenId, bytes calldata data) external;
    /// @notice ERC-1155 transfer. On a registry that isn't emancipated it reverts
    ///         `TransferUnsafeUntilRegistryIsEmancipated`; otherwise `TransferDisallowed` without `CAN_TRANSFER_ADMIN`.
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
}

/// @notice `resolver/interfaces/IPermissionedResolver.sol`, its setters and the ENSIP-1/5/9/10 readers.
///         The Sepolia setters take the DNS-encoded name.
interface IPermissionedResolver is IEnhancedAccessControl {
    event TextUpdated(uint256 indexed recordId, string indexed keyHash, string key, string value);
    event AddressUpdated(uint256 indexed recordId, uint256 coinType, bytes addressBytes);
    event ResourceArgument(uint256 indexed resource, bytes arg);
    event Linked(uint256 indexed recordId, bytes32 indexed node, bytes name);

    error UnsupportedResolverProfile(bytes4 selector);
    error InvalidRecord();

    /// @notice Sets up a new proxy. `calls` run with the role checks skipped; a `grantSetterRoles` in them still
    ///         reverts, because the factory is the caller there.
    function initialize(Grant[] calldata grants, bytes[] calldata calls) external;
    /// @notice Writes text record `key` of the DNS-encoded `name`. Needs `SET_TEXT` on `key` or the root.
    function setText(bytes calldata name, string calldata key, string calldata value) external;
    /// @notice Writes the `coinType` address of the DNS-encoded `name`. Needs `SET_ADDRESS` on it or the root.
    function setAddress(bytes calldata name, uint256 coinType, bytes calldata addressBytes) external;
    /// @notice Makes the DNS-encoded `sourceName` use the record `targetNode` uses now (record aliasing). Needs root
    ///         `LINK`. Reverts `InvalidRecord` if `targetNode` has no record yet.
    function linkToNode(bytes calldata sourceName, bytes32 targetNode) external;
    /// @notice Makes `sourceName` use record `recordId`; 0 unlinks it. Needs root `LINK`.
    function linkToRecord(bytes calldata sourceName, uint256 recordId) external;
    /// @notice The record `node` uses, or 0 if it has none (then it reads the default record, the one the empty name
    ///         `0x00` uses).
    function getRecordId(bytes32 node) external view returns (uint256);
    /// @notice How many records the resolver has created.
    function getRecordCount() external view returns (uint256);
    /// @notice Grants `account` the role for the one argument in `setter` (ABI-encoded setter calldata).
    function grantSetterRoles(bytes calldata setter, address account) external returns (bool);
    /// @notice The argument, resource and role a setter's calldata maps to.
    function decodeSetter(bytes calldata setter)
        external
        pure
        returns (bytes memory arg, uint256 resource, uint256 roleBitmap);
    /// @notice ENSIP-10: the only way to read a record. `data` is a profile call such as `text(node, key)` or
    ///         `addr(node)` (its `node` is ignored; `name` picks the record), and the answer is that call's ABI-encoded
    ///         return value. The profile functions themselves are not callable on this resolver.
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory);
}

/// @notice The ENSIP-1, 5 and 9 profile calls (`ens-contracts/contracts/resolvers/profiles`). A `PermissionedResolver`
///         doesn't implement them directly: they are the `data` its `resolve(name, data)` (and the Universal Resolver's)
///         takes, and they describe how to decode the answer.
interface IResolverProfiles {
    /// @notice ENSIP-5 text record `key` of `node`.
    function text(bytes32 node, string calldata key) external view returns (string memory);
    /// @notice ENSIP-1 address of `node`.
    function addr(bytes32 node) external view returns (address);
    /// @notice ENSIP-9 address of `node` for `coinType`.
    function addr(bytes32 node, uint256 coinType) external view returns (bytes memory);
}

/// @notice `verifiable-factory/src/IVerifiableFactory.sol`.
interface IVerifiableFactory {
    event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation);

    error VerificationFailed(address proxy);

    /// @notice Deploys a proxy of `implementation` at a CREATE2 address from `(msg.sender, salt)` and calls
    ///         `data` on it.
    function deployProxy(address implementation, uint256 salt, bytes memory data) external returns (address);
    /// @notice The proxy address `deployer` gets for `salt`.
    function predictProxyAddress(address deployer, uint256 salt) external view returns (address proxy);
    /// @notice The implementation of a proxy this factory deployed.
    function verifyContract(address proxy) external view returns (address implementation);
}

/// @notice `access-control/interfaces/IEACGrantInitializable.sol`: how a `UserRegistry` proxy is set up.
interface IEACGrantInitializable {
    /// @notice Grants each of `grants` on the root resource. Reverts if nobody ends up with a root role.
    function initialize(Grant[] calldata grants) external;
}

/// @notice `ens-contracts/contracts/universalResolver/IUniversalResolver.sol` (what viem calls).
interface IUniversalResolver {
    error ResolverNotFound(bytes name);
    error ResolverNotContract(bytes name, address resolver);
    error UnsupportedResolverProfile(bytes4 selector);
    error ResolverError(bytes errorData);

    /// @notice Resolves `data` (a resolver call) for the DNS-encoded `name`.
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory result, address resolver);
}
