// `pnpm names:check`: reads the live deployment and fails on any mismatch with the design.
//
// - Every address in `deployments/sepolia.json` has code.
// - Every contract is verified on Etherscan; each proxy shows its source and points at a verified implementation.
// - The roles are exactly as designed: `gamebox.eth`'s registry is emancipated and `GameBoxNames` holds only
//   `REGISTRAR | RENEW` and their admins there (nobody holds `SET_PARENT`); each title registry and shared resolver;
//   `gamebox.eth`'s own resolver, written only by `gamebox.eth`'s owner; each Box resolver's role table; each player
//   resolver, where the badge holds every role and `GameBoxNames` none; each championship's resolver, where only
//   `Championships` holds a role while it is open and nobody holds any once it is closed. `Championships` holds only
//   `REGISTRAR | RENEW | UNREGISTER` on each title registry.
// - Every name resolves through the Universal Resolver with stock viem (`getEnsAddress`, `getEnsText`): players, Boxes,
//   live pop-ups (as their Box), games and titles, and a free label (`gamebox.eth`'s default record, with no address).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type Address, type PublicClient, getAddress, isAddressEqual, labelhash, zeroAddress } from 'viem';

import {
  championshipsAbi,
  gameBoxNamesAbi,
  permissionedRegistryAbi,
  permissionedResolverAbi,
  verifiableFactoryAbi,
} from '../../src/names/abis.ts';
import { contractAddress, ensAddress, namesProxies } from '../../src/names/deployments.ts';
import {
  BOX_DEVICE_KEYS,
  BOX_OPERATOR_KEYS,
  BOX_REGISTRAR_KEYS,
  CUP_KEYS,
  DEFAULT_KEYS,
  GAME_KEYS,
  parseStandings,
} from '../../src/names/keys.ts';
import { championshipName, fullName, titleName } from '../../src/names/labels.ts';
import { REGISTRY_ROLES as R, RESOLVER_ROLES as S, ROOT_RESOURCE, textResource } from '../../src/names/roles.ts';
import { currentBoxes, currentPopups, discover } from './discover.ts';
import { run, sepoliaClient } from './env.ts';
import { sourceInfo } from './etherscan.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

let failures = 0;
function expect(ok: boolean, what: string, detail = ''): void {
  if (!ok) ++failures;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `: ${detail}` : ''}`);
}

const PLAYER_ROLES = (() => {
  const regular =
    S.SET_ADDRESS | S.SET_TEXT | S.SET_CONTENTHASH | S.SET_ABI | S.SET_INTERFACE | S.SET_NAME | S.SET_DATA | S.LINK |
    S.CAN_NAME | S.UPGRADE;
  return regular | (regular << 128n);
})();

function allAddresses(): { name: string; address: Address }[] {
  const file = JSON.parse(readFileSync(`${root}deployments/sepolia.json`, 'utf8')) as Record<string, unknown>;
  const out: { name: string; address: Address }[] = [];
  const walk = (value: unknown, path: string) => {
    if (typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)) out.push({ name: path, address: getAddress(value) });
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(file, '');
  return out.filter((a) => !a.name.endsWith('.txHash'));
}

async function checkCode(client: PublicClient) {
  for (const { name, address } of allAddresses()) {
    const code = await client.getCode({ address });
    expect(code !== undefined && code !== '0x', `code at ${name}`, address);
  }
}

async function checkVerified(client: PublicClient, proxies: { address: Address; what: string }[]) {
  for (const { name, address } of allAddresses()) {
    if (name.startsWith('names.') || name.startsWith('external.')) continue;
    const info = await sourceInfo(address);
    expect(info.ContractName !== '', `verified ${name}`, info.ContractName || 'unverified');
  }
  const factory = ensAddress('VerifiableFactory');
  for (const { address, what } of proxies) {
    const info = await sourceInfo(address);
    const implementation = await client.readContract({
      address: factory,
      abi: verifiableFactoryAbi,
      functionName: 'verifyContract',
      args: [address],
    });
    const impl = await sourceInfo(implementation);
    expect(
      info.ContractName !== '' && info.Proxy !== '0' && impl.ContractName !== '',
      `verified proxy ${what}`,
      `${address} shows ${info.ContractName || 'nothing'} (Proxy=${info.Proxy}), implementation ${implementation} is ${impl.ContractName || 'unverified'}`,
    );
  }
}

async function roles(client: PublicClient, contract: Address, resource: bigint, account: Address) {
  return client.readContract({ address: contract, abi: permissionedResolverAbi, functionName: 'roles', args: [resource, account] });
}

async function roleCount(client: PublicClient, contract: Address, resource: bigint) {
  return client.readContract({ address: contract, abi: permissionedResolverAbi, functionName: 'roleCount', args: [resource] });
}

/** `account` holds exactly `bitmap` on `resource`, and nobody else holds any of it there. */
async function soleHolder(client: PublicClient, contract: Address, resource: bigint, account: Address, bitmap: bigint, what: string) {
  const held = await roles(client, contract, resource, account);
  const count = await roleCount(client, contract, resource);
  expect(held === bitmap && count === bitmap, what, `holds 0x${held.toString(16)}, assignee counts 0x${count.toString(16)}`);
}

async function checkRoles(client: PublicClient, found: Awaited<ReturnType<typeof discover>>) {
  const names = contractAddress('GameBoxNames');
  const stats = contractAddress('PlayerStats');
  const proxies = namesProxies();

  const emancipated = await client.readContract({ address: proxies.registry, abi: permissionedRegistryAbi, functionName: 'isEmancipated' });
  expect(emancipated, "gamebox.eth's registry is emancipated");
  const registrar = R.REGISTRAR | R.REGISTRAR_ADMIN | R.RENEW | R.RENEW_ADMIN;
  await soleHolder(client, proxies.registry, ROOT_RESOURCE, names, registrar, "GameBoxNames is the only root on gamebox.eth's registry, with REGISTRAR | RENEW and their admins");
  const subregistry = await client.readContract({ address: ensAddress('ETHRegistry'), abi: permissionedRegistryAbi, functionName: 'getSubregistry', args: ['gamebox'] });
  expect(isAddressEqual(subregistry, proxies.registry), "gamebox.eth's subregistry is GameBoxNames' registry", subregistry);

  const cups = contractAddress('Championships');
  const cupRegistryRoles = R.REGISTRAR | R.RENEW | R.UNREGISTER;
  for (const [game, registry] of Object.entries(proxies.titles)) {
    const titleRoles = registrar | R.UNREGISTER | R.UNREGISTER_ADMIN;
    const ours = await roles(client, registry, ROOT_RESOURCE, names);
    const theirs = await roles(client, registry, ROOT_RESOURCE, cups);
    const count = await roleCount(client, registry, ROOT_RESOURCE);
    // Assignee counts: one nybble per role, so a role two accounts hold counts 2.
    expect(
      ours === titleRoles && theirs === cupRegistryRoles && count === titleRoles + cupRegistryRoles,
      `${game} title registry roots: GameBoxNames and Championships only`,
      `0x${ours.toString(16)}, 0x${theirs.toString(16)}, counts 0x${count.toString(16)}`,
    );
  }
  const cupResolverRoles = S.SET_TEXT | S.SET_TEXT_ADMIN | S.SET_ADDRESS | S.SET_ADDRESS_ADMIN;
  for (const cup of found.cups) {
    const info = await client.readContract({ address: cups, abi: championshipsAbi, functionName: 'getCup', args: [cup.id] });
    const what = championshipName(cup.label, cup.game);
    if (info.closed) {
      expect((await roleCount(client, cup.resolver, ROOT_RESOURCE)) === 0n, `${what} (closed): nobody holds a root role`);
      for (const key of Object.values(CUP_KEYS)) {
        expect((await roleCount(client, cup.resolver, textResource(key))) === 0n, `${what} (closed): nobody holds ${key}`);
      }
    } else {
      await soleHolder(client, cup.resolver, ROOT_RESOURCE, cups, cupResolverRoles, `${what} (open): Championships is the only writer`);
    }
  }
  await soleHolder(client, proxies.titleResolver, ROOT_RESOURCE, names, S.SET_TEXT | S.SET_ADDRESS, 'title resolver: GameBoxNames is the only writer');
  await soleHolder(client, proxies.gameResolver, ROOT_RESOURCE, names, S.SET_TEXT | S.SET_ADDRESS, 'game resolver: GameBoxNames is the only writer');
  const ethRegistry = ensAddress('ETHRegistry');
  const owner = await client.readContract({ address: ethRegistry, abi: permissionedRegistryAbi, functionName: 'getOwner', args: [BigInt(labelhash('gamebox'))] });
  await soleHolder(client, proxies.gameboxResolver, ROOT_RESOURCE, owner, S.SET_TEXT | S.SET_TEXT_ADMIN, "gamebox.eth's resolver: its owner is the only writer");
  await soleHolder(client, proxies.gameboxResolver, textResource('leaderboard'), stats, S.SET_TEXT, "gamebox.eth's resolver: leaderboard is PlayerStats'");
  const resolver = await client.readContract({ address: ethRegistry, abi: permissionedRegistryAbi, functionName: 'getResolver', args: ['gamebox'] });
  expect(isAddressEqual(resolver, proxies.gameboxResolver), "gamebox.eth's resolver is its own default-record resolver", resolver);

  for (const box of currentBoxes(found.boxes)) {
    const info = await client.readContract({ address: names, abi: gameBoxNamesAbi, functionName: 'getBox', args: [box.label] });
    const r = info.resolver;
    await soleHolder(client, r, ROOT_RESOURCE, names, S.SET_TEXT_ADMIN | S.SET_ADDRESS | S.LINK, `${box.label}: GameBoxNames' root roles`);
    for (const key of BOX_REGISTRAR_KEYS) await soleHolder(client, r, textResource(key), names, S.SET_TEXT, `${box.label}: ${key} is GameBoxNames'`);
    for (const key of BOX_OPERATOR_KEYS) await soleHolder(client, r, textResource(key), info.operator, S.SET_TEXT, `${box.label}: ${key} is the operator's`);
    for (const key of BOX_DEVICE_KEYS) await soleHolder(client, r, textResource(key), info.account, S.SET_TEXT, `${box.label}: ${key} is the Box's`);
    const tokenRoles = await client.readContract({ address: proxies.registry, abi: permissionedRegistryAbi, functionName: 'roles', args: [BigInt(labelhash(box.label)), info.operator] });
    expect(tokenRoles === 0n, `${box.label}: the operator holds no token role (can't transfer or re-point)`);
  }

  for (const player of found.players) {
    const r = player.resolver;
    const badgeRoles = await roles(client, r, ROOT_RESOURCE, player.badge);
    expect(badgeRoles === PLAYER_ROLES, `${player.label}: the badge holds every resolver role`);
    expect((await roles(client, r, ROOT_RESOURCE, names)) === 0n && (await roles(client, r, textResource('stats'), names)) === 0n, `${player.label}: GameBoxNames holds no role`);
    const statsRoles = await roles(client, r, textResource('stats'), stats);
    expect((await roles(client, r, ROOT_RESOURCE, stats)) === 0n && (statsRoles === S.SET_TEXT || statsRoles === 0n), `${player.label}: PlayerStats holds at most SET_TEXT on stats`, statsRoles === 0n ? 'revoked by the badge' : 'SET_TEXT on stats');
  }
}

async function checkResolution(client: PublicClient, found: Awaited<ReturnType<typeof discover>>) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const names = contractAddress('GameBoxNames');
  const free = fullName(`free-${now.toString(36)}`);
  const freeAddress = await client.getEnsAddress({ name: free });
  const description = await client.getEnsText({ name: free, key: DEFAULT_KEYS.description });
  const url = await client.getEnsText({ name: free, key: DEFAULT_KEYS.url });
  expect(freeAddress === null && description === 'This Game Box name is free.' && Boolean(url), `${free} (free) resolves to the default record`, `${description} ${url}`);
  for (const popup of currentPopups(found.popups)) {
    const address = await client.getEnsAddress({ name: fullName(popup.label) });
    if (popup.expiry > now) {
      const box = await client.readContract({ address: names, abi: gameBoxNamesAbi, functionName: 'getBox', args: [popup.ofBox] });
      expect(address !== null && isAddressEqual(address, box.account), `${fullName(popup.label)} resolves as ${popup.ofBox}`, address ?? 'null');
    } else {
      expect(address === null, `${fullName(popup.label)} has lapsed and resolves to the default`, address ?? 'null');
    }
  }
  for (const player of found.players) {
    const address = await client.getEnsAddress({ name: fullName(player.label) });
    expect(address !== null && isAddressEqual(address, player.badge), `${fullName(player.label)} resolves to its badge`, address ?? 'null');
  }
  for (const box of currentBoxes(found.boxes)) {
    const info = await client.readContract({ address: names, abi: gameBoxNamesAbi, functionName: 'getBox', args: [box.label] });
    const address = await client.getEnsAddress({ name: fullName(box.label) });
    if (info.expiry > now) {
      expect(address !== null && isAddressEqual(address, info.account), `${fullName(box.label)} resolves to its Box`, address ?? 'null');
      const status = await client.getEnsText({ name: fullName(box.label), key: 'status' });
      expect(status !== null && status !== '', `${fullName(box.label)} has a status`, status ?? 'null');
    } else {
      expect(address === null, `${fullName(box.label)} has lapsed and resolves to the default`, address ?? 'null');
    }
  }
  const cups = contractAddress('Championships');
  for (const cup of found.cups) {
    const info = await client.readContract({ address: cups, abi: championshipsAbi, functionName: 'getCup', args: [cup.id] });
    const name = championshipName(cup.label, cup.game);
    if (info.closed && info.winner === zeroAddress) {
      expect((await client.getEnsAddress({ name })) === null, `${name} closed with no players and is unregistered`);
      continue;
    }
    const standings = await client.getEnsText({ name, key: CUP_KEYS.standings });
    const rows = standings === null ? null : parseStandings(standings);
    const address = await client.getEnsAddress({ name });
    const expected = info.closed ? info.winner : rows?.[0]?.addr;
    expect(
      rows !== null && (expected === undefined ? address === null : address !== null && isAddressEqual(address, expected)),
      `${name} (${info.closed ? 'closed' : 'open'}) resolves its standings and ${info.closed ? 'winner' : 'leader'}`,
      `${rows?.length ?? 'no'} rows, addr ${address ?? 'null'}`,
    );
  }
  for (const game of Object.keys(namesProxies().titles)) {
    const title = await client.getEnsText({ name: fullName(game), key: GAME_KEYS.title });
    expect(title === titleName(game), `${fullName(game)} names its title`, title ?? 'null');
    const t = await client.readContract({ address: names, abi: gameBoxNamesAbi, functionName: 'getTitle', args: [game] });
    const holder = await client.getEnsAddress({ name: titleName(game) });
    if (t.expiry > now) expect(holder !== null && isAddressEqual(holder, t.holder), `${titleName(game)} resolves to its holder`, holder ?? 'null');
    else expect(holder === null, `${titleName(game)} is unheld or lapsed and doesn't resolve`, holder ?? 'null');
  }
}

run(async () => {
  const client = sepoliaClient();
  const found = await discover(client);
  await checkCode(client);
  await checkVerified(client, found.proxies);
  await checkRoles(client, found);
  await checkResolution(client, found);
  console.log(failures === 0 ? 'names:check passed' : `names:check: ${failures} failed`);
  return failures === 0;
});
