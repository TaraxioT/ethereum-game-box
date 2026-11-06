// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {IGameBoxNames} from "./IGameBoxNames.sol";
import {
    Grant,
    IEACGrantInitializable,
    IPermissionedRegistry,
    IPermissionedResolver,
    IRegistry,
    IVerifiableFactory,
    RegistryRoles,
    ResolverRoles
} from "./IENSv2.sol";
import {NameLib} from "./NameLib.sol";

/// @title GameBoxNames
/// @notice The registrar of `gamebox.eth`: Box licences, player names, games and their champion titles, each name with
///         its own resolver and its own role table (see `IGameBoxNames`).
contract GameBoxNames is IGameBoxNames, AccessControl, ERC1155Holder, EIP712 {
    using Strings for uint256;

    /// @inheritdoc IGameBoxNames
    bytes32 public constant LICENSOR_ROLE = keccak256("LICENSOR_ROLE");
    /// @inheritdoc IGameBoxNames
    bytes32 public constant REFEREE_ROLE = keccak256("REFEREE_ROLE");
    /// @inheritdoc IGameBoxNames
    bytes32 public constant CLAIM_TYPEHASH = keccak256("ClaimName(string label,address badge,uint256 deadline)");

    /// @notice The ENSIP-9 coin type of `addr` (Ethereum).
    uint256 internal constant COIN_TYPE_ETH = 60;
    /// @notice Player and game names never expire (they last as long as `gamebox.eth`).
    uint64 internal constant FOREVER = type(uint64).max;

    /// @inheritdoc IGameBoxNames
    string public constant POPUP_PREFIX = "popup-";

    /// @notice Our root roles on `gamebox.eth`'s registry. None controls a registered name, so it is emancipated. The
    ///         admins are there so `handOverRegistrar` can grant them on.
    uint256 internal constant PARENT_REGISTRY_ROLES =
        RegistryRoles.REGISTRAR | RegistryRoles.REGISTRAR_ADMIN | RegistryRoles.RENEW | RegistryRoles.RENEW_ADMIN;
    /// @notice Our root roles on a title registry. `UNREGISTER` moves a title, so title registries are not
    ///         emancipated.
    uint256 internal constant TITLE_REGISTRY_ROLES =
        PARENT_REGISTRY_ROLES | RegistryRoles.UNREGISTER | RegistryRoles.UNREGISTER_ADMIN;
    /// @notice Held only while a new registry's canonical parent is set, then revoked: nobody can move it after.
    uint256 internal constant PARENT_LOCK_ROLES = RegistryRoles.SET_PARENT | RegistryRoles.SET_PARENT_ADMIN;
    /// @notice A player's roles on its name's token: everything a token role can be, transfer included.
    uint256 internal constant PLAYER_TOKEN_ROLES = RegistryRoles.UNREGISTER | RegistryRoles.UNREGISTER_ADMIN
        | RegistryRoles.RENEW | RegistryRoles.RENEW_ADMIN | RegistryRoles.SET_SUBREGISTRY
        | RegistryRoles.SET_SUBREGISTRY_ADMIN | RegistryRoles.SET_RESOLVER | RegistryRoles.SET_RESOLVER_ADMIN
        | RegistryRoles.CAN_TRANSFER_ADMIN;
    /// @notice Every `PermissionedResolver` role.
    uint256 internal constant RESOLVER_ALL_ROLES = ResolverRoles.SET_ADDRESS | ResolverRoles.SET_TEXT
        | ResolverRoles.SET_CONTENTHASH | ResolverRoles.SET_ABI | ResolverRoles.SET_INTERFACE | ResolverRoles.SET_NAME
        | ResolverRoles.SET_DATA | ResolverRoles.LINK | ResolverRoles.CAN_NAME | ResolverRoles.UPGRADE;
    /// @notice A badge's roles on its own resolver: every role and every admin role.
    uint256 internal constant PLAYER_RESOLVER_ROLES = RESOLVER_ALL_ROLES | (RESOLVER_ALL_ROLES << 128);
    /// @notice Our root roles on a Box resolver: grant and revoke text keys and rewrite `addr` when the Box moves, and
    ///         link pop-ups to the Box's record.
    uint256 internal constant BOX_RESOLVER_ROLES =
        ResolverRoles.SET_TEXT_ADMIN | ResolverRoles.SET_ADDRESS | ResolverRoles.LINK;
    /// @notice Our root roles on the shared title and game resolvers: we are their only writer.
    uint256 internal constant SHARED_RESOLVER_ROLES = ResolverRoles.SET_TEXT | ResolverRoles.SET_ADDRESS;

    /// @inheritdoc IGameBoxNames
    IPermissionedRegistry public immutable REGISTRY;
    /// @inheritdoc IGameBoxNames
    address public immutable TITLE_RESOLVER;
    /// @inheritdoc IGameBoxNames
    address public immutable GAME_RESOLVER;

    IVerifiableFactory private immutable FACTORY;
    address private immutable REGISTRY_IMPL;
    address private immutable RESOLVER_IMPL;

    struct BoxData {
        address operator;
        address account;
        bytes32 qx;
        bytes32 qy;
        BoxStatus status;
        address resolver;
    }

    struct TitleData {
        address holder;
        uint64 start;
        uint64 streak;
        uint256 round;
    }

    /// @inheritdoc IGameBoxNames
    address public statsWriter;
    uint256 private _proxyCount;
    mapping(uint256 labelId => BoxData) private _boxes;
    mapping(uint256 labelId => Game) private _games;
    mapping(uint256 labelId => TitleData) private _titles;
    mapping(address badge => string label) private _labels;
    mapping(uint256 labelId => string ofBox) private _popups;
    address[] private _titleRegistries;

    /// @param factory ENS's `VerifiableFactory`.
    /// @param registryImpl ENS's `UserRegistry` implementation.
    /// @param resolverImpl ENS's `PermissionedResolver` implementation.
    /// @param ethRegistry The `.eth` registry, `gamebox.eth`'s canonical parent.
    /// @param admin Gets `DEFAULT_ADMIN_ROLE`.
    constructor(
        IVerifiableFactory factory,
        address registryImpl,
        address resolverImpl,
        IRegistry ethRegistry,
        address admin
    ) EIP712("Game Box Names", "1") {
        if (admin == address(0)) revert ZeroValue();
        FACTORY = factory;
        REGISTRY_IMPL = registryImpl;
        RESOLVER_IMPL = resolverImpl;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        REGISTRY = _newRegistry(PARENT_REGISTRY_ROLES, ethRegistry, "gamebox");
        TITLE_RESOLVER = _newResolver(_grant(address(this), SHARED_RESOLVER_ROLES), new bytes[](0));
        GAME_RESOLVER = _newResolver(_grant(address(this), SHARED_RESOLVER_ROLES), new bytes[](0));
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Boxes
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IGameBoxNames
    function registerBox(
        string calldata label,
        address operator,
        address account,
        bytes32 qx,
        bytes32 qy,
        uint64 expiry
    ) external onlyRole(LICENSOR_ROLE) returns (address resolver) {
        if (!NameLib.isValidLabel(label)) revert InvalidLabel(label);
        if (operator == address(0) || account == address(0) || qx == 0 || qy == 0) revert ZeroValue();
        resolver = _newBoxResolver(NameLib.dnsName(label), operator, account, _boxKeyText(qx, qy));
        // Token roles 0: the operator owns the name but can't transfer it or re-point its resolver or subregistry.
        REGISTRY.register(label, operator, IRegistry(address(0)), resolver, 0, expiry);
        _boxes[NameLib.id(label)] = BoxData(operator, account, qx, qy, BoxStatus.Active, resolver);
        emit BoxRegistered(label, operator, account, resolver, qx, qy, expiry);
    }

    /// @inheritdoc IGameBoxNames
    function renewBox(string calldata label, uint64 expiry) external onlyRole(LICENSOR_ROLE) {
        _box(label);
        REGISTRY.renew(NameLib.id(label), expiry);
        emit BoxRenewed(label, expiry);
    }

    /// @inheritdoc IGameBoxNames
    function setBoxStatus(string calldata label, BoxStatus status) external onlyRole(LICENSOR_ROLE) {
        if (status == BoxStatus.None) revert InvalidStatus();
        BoxData storage box = _box(label);
        box.status = status;
        IPermissionedResolver(box.resolver).setText(NameLib.dnsName(label), "status", _statusText(status));
        emit BoxStatusChanged(label, status);
    }

    /// @inheritdoc IGameBoxNames
    function setBoxKey(string calldata label, bytes32 qx, bytes32 qy, address account)
        external
        onlyRole(LICENSOR_ROLE)
    {
        if (account == address(0) || qx == 0 || qy == 0) revert ZeroValue();
        BoxData storage box = _box(label);
        IPermissionedResolver r = IPermissionedResolver(box.resolver);
        bytes memory name = NameLib.dnsName(label);
        r.setAddress(name, COIN_TYPE_ETH, abi.encodePacked(account));
        r.setText(name, "boxKey", _boxKeyText(qx, qy));
        r.revokeRoles(ResolverRoles.textResource("lastSeen"), ResolverRoles.SET_TEXT, box.account);
        r.revokeRoles(ResolverRoles.textResource("game"), ResolverRoles.SET_TEXT, box.account);
        _grantText(r, name, "lastSeen", account);
        _grantText(r, name, "game", account);
        (box.account, box.qx, box.qy) = (account, qx, qy);
        emit BoxKeyChanged(label, account, qx, qy);
    }

    /// @inheritdoc IGameBoxNames
    function registerPopup(string calldata label, string calldata ofBox, uint64 expiry)
        external
        onlyRole(LICENSOR_ROLE)
        returns (string memory popupLabel)
    {
        popupLabel = string.concat(POPUP_PREFIX, label);
        if (bytes(label).length == 0 || bytes(label)[0] == "-" || !NameLib.isValidLabel(popupLabel)) {
            revert InvalidLabel(label);
        }
        BoxData storage box = _box(ofBox);
        if (REGISTRY.getExpiry(NameLib.id(ofBox)) <= block.timestamp) revert BoxNotLive(ofBox);
        REGISTRY.register(popupLabel, box.operator, IRegistry(address(0)), box.resolver, 0, expiry);
        IPermissionedResolver(box.resolver).linkToNode(NameLib.dnsName(popupLabel), NameLib.node(ofBox));
        _popups[NameLib.id(popupLabel)] = ofBox;
        emit PopupRegistered(popupLabel, ofBox, box.operator, expiry);
    }

    /// @inheritdoc IGameBoxNames
    function getPopup(string calldata popupLabel) external view returns (Popup memory) {
        uint256 id = NameLib.id(popupLabel);
        string memory ofBox = _popups[id];
        return Popup(ofBox, bytes(ofBox).length == 0 ? 0 : REGISTRY.getExpiry(id));
    }

    /// @inheritdoc IGameBoxNames
    function boxKey(string calldata label) external view returns (bytes32 qx, bytes32 qy) {
        BoxData storage box = _box(label);
        return (box.qx, box.qy);
    }

    /// @inheritdoc IGameBoxNames
    function getBox(string calldata label) external view returns (Box memory) {
        uint256 id = NameLib.id(label);
        BoxData storage box = _boxes[id];
        uint64 expiry = box.status == BoxStatus.None ? 0 : REGISTRY.getExpiry(id);
        return Box(box.operator, box.account, box.qx, box.qy, box.status, box.resolver, expiry);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Players
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IGameBoxNames
    function claimPlayer(string calldata label, address badge, uint256 deadline, bytes calldata signature)
        external
        returns (address resolver)
    {
        if (!NameLib.isValidLabel(label)) revert InvalidLabel(label);
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);
        address stats = statsWriter;
        if (stats == address(0)) revert StatsWriterNotSet();
        string memory held = labelOf(badge);
        if (bytes(held).length != 0) revert BadgeHasName(badge, held);
        uint256 id = NameLib.id(label);
        if (_boxes[id].status != BoxStatus.None || bytes(_popups[id]).length != 0) revert LabelHeldByBox(label);
        if (!SignatureChecker.isValidSignatureNow(badge, claimDigest(label, badge, deadline), signature)) {
            revert InvalidClaimSignature();
        }

        bytes memory name = NameLib.dnsName(label);
        Grant[] memory grants = new Grant[](2);
        grants[0] = Grant(badge, PLAYER_RESOLVER_ROLES);
        grants[1] = Grant(address(this), ResolverRoles.SET_TEXT_ADMIN);
        bytes[] memory calls = new bytes[](1);
        calls[0] = _setAddrCall(name, badge);
        resolver = _newResolver(grants, calls);

        // Hold SET_TEXT_ADMIN only long enough to grant `stats` to PlayerStats, then drop it: from here on we hold no
        // role on this resolver.
        IPermissionedResolver r = IPermissionedResolver(resolver);
        _grantText(r, name, "stats", stats);
        r.revokeRootRoles(ResolverRoles.SET_TEXT_ADMIN, address(this));

        REGISTRY.register(label, badge, IRegistry(address(0)), resolver, PLAYER_TOKEN_ROLES, FOREVER);
        _labels[badge] = label;
        emit PlayerClaimed(label, badge, resolver);
    }

    /// @inheritdoc IGameBoxNames
    function claimDigest(string calldata label, address badge, uint256 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, keccak256(bytes(label)), badge, deadline)));
    }

    /// @inheritdoc IGameBoxNames
    function labelOf(address badge) public view returns (string memory) {
        string memory label = _labels[badge];
        if (bytes(label).length == 0 || REGISTRY.getOwner(NameLib.id(label)) != badge) return "";
        return label;
    }

    /// @inheritdoc IGameBoxNames
    function nameOf(address badge) public view returns (string memory) {
        string memory label = labelOf(badge);
        return bytes(label).length == 0 ? "" : NameLib.fullName(label);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Games and titles
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc IGameBoxNames
    function addGame(string calldata label, uint64 titleTerm)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (address titleRegistry)
    {
        if (!NameLib.isValidLabel(label)) revert InvalidLabel(label);
        if (titleTerm == 0) revert ZeroValue();
        uint256 id = NameLib.id(label);
        if (_games[id].titleRegistry != address(0)) revert GameExists(label);

        IPermissionedRegistry registry = _newRegistry(TITLE_REGISTRY_ROLES, REGISTRY, label);
        titleRegistry = address(registry);
        _titleRegistries.push(titleRegistry);
        _games[id] = Game(titleRegistry, titleTerm);

        REGISTRY.register(label, address(this), registry, GAME_RESOLVER, 0, FOREVER);
        bytes memory name = NameLib.dnsName(label);
        IPermissionedResolver(GAME_RESOLVER).setText(name, "title", string.concat("champion.", NameLib.fullName(label)));
        IPermissionedResolver(GAME_RESOLVER).setText(name, "titleTerm", uint256(titleTerm).toString());
        emit GameAdded(label, titleRegistry, titleTerm);
    }

    /// @inheritdoc IGameBoxNames
    function getGame(string calldata label) external view returns (Game memory) {
        return _games[NameLib.id(label)];
    }

    /// @inheritdoc IGameBoxNames
    function crown(string calldata game, address winner, uint256 round) external onlyRole(REFEREE_ROLE) {
        uint256 gameId = NameLib.id(game);
        Game storage g = _games[gameId];
        if (g.titleRegistry == address(0)) revert UnknownGame(game);
        string memory holderName = nameOf(winner);
        if (bytes(holderName).length == 0) revert NotAPlayer(winner);

        IPermissionedRegistry registry = IPermissionedRegistry(g.titleRegistry);
        TitleData storage title = _titles[gameId];
        bytes memory name = NameLib.dnsTitleName(game);
        uint64 expiry = uint64(block.timestamp) + g.titleTerm;
        address previous = registry.getOwner(NameLib.id(NameLib.TITLE_LABEL));

        if (previous == winner) {
            registry.renew(NameLib.id(NameLib.TITLE_LABEL), expiry);
            ++title.streak;
        } else {
            _moveTitle(registry, name, previous, winner, holderName, expiry);
            (title.holder, title.start, title.streak) = (winner, uint64(block.timestamp), 1);
        }
        title.round = round;
        IPermissionedResolver(TITLE_RESOLVER).setText(name, "streak", uint256(title.streak).toString());
        IPermissionedResolver(TITLE_RESOLVER).setText(name, "round", round.toString());
        emit Crowned(game, winner, previous, round, title.streak, expiry);
    }

    /// @inheritdoc IGameBoxNames
    function getTitle(string calldata game) external view returns (Title memory) {
        uint256 gameId = NameLib.id(game);
        TitleData storage title = _titles[gameId];
        address registry = _games[gameId].titleRegistry;
        uint64 expiry =
            registry == address(0) ? 0 : IPermissionedRegistry(registry).getExpiry(NameLib.id(NameLib.TITLE_LABEL));
        return Title(title.holder, title.start, title.streak, title.round, expiry);
    }

    /// @inheritdoc IGameBoxNames
    function handOverRegistrar(address next) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (next == address(0)) revert ZeroValue();
        _handOver(REGISTRY, PARENT_REGISTRY_ROLES, next);
        for (uint256 i; i < _titleRegistries.length; ++i) {
            _handOver(IPermissionedRegistry(_titleRegistries[i]), TITLE_REGISTRY_ROLES, next);
        }
        emit RegistrarHandedOver(next);
    }

    /// @inheritdoc IGameBoxNames
    function setStatsWriter(address stats) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (stats == address(0)) revert ZeroValue();
        statsWriter = stats;
        emit StatsWriterSet(stats);
    }

    /// @notice ERC-165: access control and the ERC-1155 receiver (this contract owns the game names).
    function supportsInterface(bytes4 interfaceId) public view override(AccessControl, ERC1155Holder) returns (bool) {
        return AccessControl.supportsInterface(interfaceId) || ERC1155Holder.supportsInterface(interfaceId);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------------------------

    function _box(string calldata label) private view returns (BoxData storage box) {
        box = _boxes[NameLib.id(label)];
        if (box.status == BoxStatus.None) revert UnknownBox(label);
    }

    /// @dev A new `UserRegistry` with `roles` for us and its canonical parent locked: we take `SET_PARENT` and its
    ///      admin only to call `setParent`, then revoke both, so nobody holds them.
    function _newRegistry(uint256 roles, IRegistry parent, string memory label)
        private
        returns (IPermissionedRegistry registry)
    {
        bytes memory init = abi.encodeCall(
            IEACGrantInitializable.initialize, (_grant(address(this), roles | PARENT_LOCK_ROLES))
        );
        registry = IPermissionedRegistry(FACTORY.deployProxy(REGISTRY_IMPL, _proxyCount++, init));
        registry.setParent(parent, label);
        registry.revokeRootRoles(PARENT_LOCK_ROLES, address(this));
    }

    function _handOver(IPermissionedRegistry registry, uint256 roles, address next) private {
        registry.grantRootRoles(roles, next);
        registry.revokeRootRoles(roles, address(this));
    }

    function _newResolver(Grant[] memory grants, bytes[] memory calls) private returns (address) {
        bytes memory init = abi.encodeCall(IPermissionedResolver.initialize, (grants, calls));
        return FACTORY.deployProxy(RESOLVER_IMPL, _proxyCount++, init);
    }

    /// @dev Gives the title to `winner`. A live title held by someone else is unregistered first (its token burns); a
    ///      lapsed one is registered over. Token roles 0, so the title can't be transferred.
    function _moveTitle(
        IPermissionedRegistry registry,
        bytes memory name,
        address previous,
        address winner,
        string memory holderName,
        uint64 expiry
    ) private {
        if (previous != address(0)) registry.unregister(NameLib.id(NameLib.TITLE_LABEL));
        registry.register(NameLib.TITLE_LABEL, winner, IRegistry(address(0)), TITLE_RESOLVER, 0, expiry);
        IPermissionedResolver resolver = IPermissionedResolver(TITLE_RESOLVER);
        resolver.setAddress(name, COIN_TYPE_ETH, abi.encodePacked(winner));
        resolver.setText(name, "holder", holderName);
        resolver.setText(name, "start", block.timestamp.toString());
    }

    /// @dev A Box resolver: we write `addr`, `boxKey` and `status` while it is set up, then grant the eight Box keys
    ///      (two to us, four to the operator, two to the Box). We keep `SET_TEXT_ADMIN` and `SET_ADDRESS` to move the
    ///      Box to a new account later, and `LINK` for its pop-ups.
    function _newBoxResolver(bytes memory name, address operator, address account, string memory key)
        private
        returns (address resolver)
    {
        bytes[] memory calls = new bytes[](3);
        calls[0] = _setAddrCall(name, account);
        calls[1] = abi.encodeCall(IPermissionedResolver.setText, (name, "boxKey", key));
        calls[2] = abi.encodeCall(IPermissionedResolver.setText, (name, "status", "active"));
        resolver = _newResolver(_grant(address(this), BOX_RESOLVER_ROLES), calls);

        IPermissionedResolver r = IPermissionedResolver(resolver);
        _grantText(r, name, "boxKey", address(this));
        _grantText(r, name, "status", address(this));
        _grantText(r, name, "commission", operator);
        _grantText(r, name, "location", operator);
        _grantText(r, name, "description", operator);
        _grantText(r, name, "games", operator);
        _grantText(r, name, "lastSeen", account);
        _grantText(r, name, "game", account);
    }

    function _grant(address account, uint256 roles) private pure returns (Grant[] memory grants) {
        grants = new Grant[](1);
        grants[0] = Grant(account, roles);
    }

    /// @dev Grants `SET_TEXT` on one key. The setter's name and value don't matter: only the key is decoded.
    function _grantText(IPermissionedResolver resolver, bytes memory name, string memory key, address account) private {
        resolver.grantSetterRoles(abi.encodeCall(IPermissionedResolver.setText, (name, key, "")), account);
    }

    function _setAddrCall(bytes memory name, address account) private pure returns (bytes memory) {
        return abi.encodeCall(IPermissionedResolver.setAddress, (name, COIN_TYPE_ETH, abi.encodePacked(account)));
    }

    /// @dev `0x04` + x + y: the uncompressed P-256 point, as hex.
    function _boxKeyText(bytes32 qx, bytes32 qy) private pure returns (string memory) {
        return Strings.toHexString(abi.encodePacked(bytes1(0x04), qx, qy));
    }

    function _statusText(BoxStatus status) private pure returns (string memory) {
        if (status == BoxStatus.Active) return "active";
        if (status == BoxStatus.Suspended) return "suspended";
        return "revoked";
    }
}
