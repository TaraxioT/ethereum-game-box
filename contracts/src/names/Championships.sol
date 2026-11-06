// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {IFakeUSDC} from "../token/IFakeUSDC.sol";
import {IChampionships} from "./IChampionships.sol";
import {
    Grant,
    IPermissionedRegistry,
    IPermissionedResolver,
    IRegistry,
    IVerifiableFactory,
    ResolverRoles
} from "./IENSv2.sol";
import {IGameBoxNames} from "./IGameBoxNames.sol";
import {NameLib} from "./NameLib.sol";

/// @title Championships
/// @notice Time-boxed championships with live standings on their own ENS name, frozen for good at close (see
///         `IChampionships`).
contract Championships is IChampionships, AccessControl, ERC1155Holder {
    using SafeERC20 for IFakeUSDC;
    using Strings for uint256;

    /// @inheritdoc IChampionships
    uint64 public constant GRACE = 1 days;
    /// @inheritdoc IChampionships
    uint256 public constant TOP = 5;

    uint256 internal constant COIN_TYPE_ETH = 60;
    uint64 internal constant FOREVER = type(uint64).max;
    uint32 internal constant WIN_POINTS = 3;
    uint32 internal constant DRAW_POINTS = 1;
    /// @notice Our root roles on a championship's resolver, and the only roles anyone holds there: write text and
    ///         `addr`, and the admins that let us revoke both from ourselves at close. Nobody holds `UPGRADE`.
    uint256 internal constant RESOLVER_ROLES = ResolverRoles.SET_TEXT | ResolverRoles.SET_TEXT_ADMIN
        | ResolverRoles.SET_ADDRESS | ResolverRoles.SET_ADDRESS_ADMIN;

    /// @inheritdoc IChampionships
    IGameBoxNames public immutable NAMES;
    /// @inheritdoc IChampionships
    IFakeUSDC public immutable USDC;

    IVerifiableFactory private immutable FACTORY;
    address private immutable RESOLVER_IMPL;

    /// @inheritdoc IChampionships
    uint256 public cupCount;
    /// @dev Counts score changes, so equal scores rank by who reached them first.
    uint64 private _seq;
    mapping(uint256 gameId => uint256 id) private _open;
    mapping(uint256 id => Cup) private _cups;
    mapping(uint256 id => address[] players) private _top;
    mapping(uint256 id => mapping(address player => Entry)) private _entries;

    /// @param names The registrar; it must grant this contract its game registry roles (`setChampionships`).
    /// @param usdc The prize token.
    /// @param factory ENS's `VerifiableFactory`.
    /// @param resolverImpl ENS's `PermissionedResolver` implementation.
    /// @param admin Gets `DEFAULT_ADMIN_ROLE`: opens championships.
    constructor(IGameBoxNames names, IFakeUSDC usdc, IVerifiableFactory factory, address resolverImpl, address admin) {
        NAMES = names;
        USDC = usdc;
        FACTORY = factory;
        RESOLVER_IMPL = resolverImpl;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @inheritdoc IChampionships
    function open(string calldata game, string calldata label, uint64 ends, uint256 prize)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (uint256 id)
    {
        IPermissionedRegistry registry = _registry(game);
        if (!NameLib.isValidLabel(label) || keccak256(bytes(label)) == keccak256(bytes(NameLib.TITLE_LABEL))) {
            revert InvalidLabel(label);
        }
        uint256 gameId = NameLib.id(game);
        if (_open[gameId] != 0) revert CupAlreadyOpen(game, _open[gameId]);
        if (ends <= block.timestamp) revert EndsInPast(ends);

        id = ++cupCount;
        address resolver = _newResolver(id, NameLib.dnsGameName(label, game), ends, prize);
        // Token roles 0: nobody, us included, can transfer it or re-point its resolver.
        registry.register(label, address(this), IRegistry(address(0)), resolver, 0, ends + GRACE);
        _open[gameId] = id;
        _cups[id] = Cup(game, label, resolver, msg.sender, ends, prize, false, address(0));
        USDC.safeTransferFrom(msg.sender, address(this), prize);
        emit CupOpened(id, game, label, resolver, ends, prize, msg.sender);
    }

    /// @inheritdoc IChampionships
    function score(string calldata game, address winner, address loser, bool draw) external {
        if (!NAMES.hasRole(NAMES.REFEREE_ROLE(), msg.sender)) revert NotReferee(msg.sender);
        uint256 id = _open[NameLib.id(game)];
        if (id == 0 || block.timestamp >= _cups[id].ends) return;

        if (draw) {
            _add(id, winner, DRAW_POINTS, Entry(DRAW_POINTS, 0, 1, 0, 0));
            _add(id, loser, DRAW_POINTS, Entry(DRAW_POINTS, 0, 1, 0, 0));
        } else {
            _add(id, winner, WIN_POINTS, Entry(WIN_POINTS, 1, 0, 0, 0));
            _add(id, loser, 0, Entry(0, 0, 0, 1, 0));
        }
        address leader = _top[id][0];
        _write(id, leader, "leader");
        emit CupScored(id, winner, loser, draw, leader);
    }

    /// @inheritdoc IChampionships
    function close(string calldata game) external returns (address winner) {
        uint256 gameId = NameLib.id(game);
        uint256 id = _open[gameId];
        if (id == 0) revert NoOpenCup(game);
        Cup storage cup = _cups[id];
        if (block.timestamp < cup.ends) revert NotOver(cup.ends);
        delete _open[gameId];
        cup.closed = true;

        address[] storage ranked = _top[id];
        if (ranked.length != 0) winner = ranked[0];
        USDC.safeTransfer(winner == address(0) ? cup.opener : winner, cup.prize);

        IPermissionedRegistry registry = _registry(game);
        uint256 labelId = NameLib.id(cup.label);
        // A name nobody closed within `GRACE` has lapsed: there is nothing to unregister, and it is registered over.
        if (registry.getOwner(labelId) != address(0)) registry.unregister(labelId);
        if (winner != address(0)) {
            cup.winner = winner;
            registry.register(cup.label, winner, IRegistry(address(0)), cup.resolver, 0, FOREVER);
            _write(id, winner, "winner");
        }
        // From here nobody holds a role on the resolver: its records can never change again.
        IPermissionedResolver(cup.resolver).revokeRootRoles(RESOLVER_ROLES, address(this));
        emit CupClosed(id, game, cup.label, winner, cup.prize);
    }

    /// @inheritdoc IChampionships
    function openCup(string calldata game) external view returns (uint256) {
        return _open[NameLib.id(game)];
    }

    /// @inheritdoc IChampionships
    function getCup(uint256 id) external view returns (Cup memory) {
        return _cups[id];
    }

    /// @inheritdoc IChampionships
    function top(uint256 id) external view returns (address[] memory) {
        return _top[id];
    }

    /// @inheritdoc IChampionships
    function entryOf(uint256 id, address player) external view returns (Entry memory) {
        return _entries[id][player];
    }

    /// @inheritdoc IChampionships
    function standingsText(uint256 id) public view returns (string memory text) {
        address[] storage ranked = _top[id];
        text = "[";
        for (uint256 i; i < ranked.length; ++i) {
            text = string.concat(text, i == 0 ? "" : ",", _entryText(ranked[i], _entries[id][ranked[i]]));
        }
        text = string.concat(text, "]");
    }

    /// @notice ERC-165: access control and the ERC-1155 receiver (this contract owns each name while it runs).
    function supportsInterface(bytes4 interfaceId) public view override(AccessControl, ERC1155Holder) returns (bool) {
        return AccessControl.supportsInterface(interfaceId) || ERC1155Holder.supportsInterface(interfaceId);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------------------------

    function _registry(string calldata game) private view returns (IPermissionedRegistry) {
        address registry = NAMES.getGame(game).titleRegistry;
        if (registry == address(0)) revert UnknownGame(game);
        return IPermissionedRegistry(registry);
    }

    /// @dev The name's own resolver, with `ends`, `prize` and `standings` written while it is set up. Only this
    ///      contract holds a role on it (`RESOLVER_ROLES`).
    function _newResolver(uint256 id, bytes memory name, uint64 ends, uint256 prize) private returns (address) {
        bytes[] memory calls = new bytes[](3);
        calls[0] = abi.encodeCall(IPermissionedResolver.setText, (name, "ends", uint256(ends).toString()));
        calls[1] = abi.encodeCall(IPermissionedResolver.setText, (name, "prize", prize.toString()));
        calls[2] = abi.encodeCall(IPermissionedResolver.setText, (name, "standings", "[]"));
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(address(this), RESOLVER_ROLES);
        return FACTORY.deployProxy(RESOLVER_IMPL, id, abi.encodeCall(IPermissionedResolver.initialize, (grants, calls)));
    }

    /// @dev Adds `delta` to `player`'s entry and moves it up the top 5. `reached` moves on a player's first result and
    ///      whenever its points rise, so of two equal scores the one reached first ranks higher.
    function _add(uint256 id, address player, uint32 points, Entry memory delta) private {
        Entry storage e = _entries[id][player];
        if (e.reached == 0 || points != 0) e.reached = ++_seq;
        e.points += delta.points;
        e.wins += delta.wins;
        e.draws += delta.draws;
        e.losses += delta.losses;
        _rank(id, player);
    }

    /// @dev Keeps `_top[id]` the best `TOP` entries in rank order. A score only ever rises, so only `player` can move,
    ///      and only up: it enters at the bottom (if there is room or it beats the last) and bubbles up.
    function _rank(uint256 id, address player) private {
        address[] storage ranked = _top[id];
        uint256 n = ranked.length;
        uint256 i;
        while (i < n && ranked[i] != player) ++i;
        if (i == n) {
            if (n < TOP) {
                ranked.push(player);
            } else if (_above(id, player, ranked[n - 1])) {
                i = n - 1;
                ranked[i] = player;
            } else {
                return;
            }
        }
        while (i > 0 && _above(id, ranked[i], ranked[i - 1])) {
            (ranked[i - 1], ranked[i]) = (ranked[i], ranked[i - 1]);
            --i;
        }
    }

    /// @dev Whether `a` ranks above `b`: more points, then more wins, then reached that score first.
    function _above(uint256 id, address a, address b) private view returns (bool) {
        Entry storage x = _entries[id][a];
        Entry storage y = _entries[id][b];
        if (x.points != y.points) return x.points > y.points;
        if (x.wins != y.wins) return x.wins > y.wins;
        return x.reached < y.reached;
    }

    /// @dev Writes `standings`, the `key` record (`leader` or `winner`: the player's name) and `addr` (the player).
    function _write(uint256 id, address player, string memory key) private {
        Cup storage cup = _cups[id];
        bytes memory name = NameLib.dnsGameName(cup.label, cup.game);
        IPermissionedResolver resolver = IPermissionedResolver(cup.resolver);
        resolver.setText(name, "standings", standingsText(id));
        resolver.setText(name, key, NAMES.nameOf(player));
        resolver.setAddress(name, COIN_TYPE_ETH, abi.encodePacked(player));
    }

    function _entryText(address player, Entry storage e) private view returns (string memory) {
        return string.concat(
            '{"name":"',
            NAMES.nameOf(player),
            '","addr":"',
            Strings.toChecksumHexString(player),
            '","points":',
            uint256(e.points).toString(),
            ',"wins":',
            uint256(e.wins).toString(),
            ',"draws":',
            uint256(e.draws).toString(),
            ',"losses":',
            uint256(e.losses).toString(),
            "}"
        );
    }
}
