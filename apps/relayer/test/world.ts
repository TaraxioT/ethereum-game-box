// A fake Game Box names deployment on the fake chain, with the relayer's routes and sender wired to it.

import {
  boxResultsAbi,
  boxSeatsAbi,
  championshipsAbi,
  defaultReverseRegistrarAbi,
  demoLicencesAbi,
  duelPotAbi,
  fakeUsdcAbi,
  gameBoxNamesAbi,
  p256AccountAbi,
  p256AccountFactoryAbi,
  permissionedRegistryAbi,
  rawSignature,
  storePotAbi,
  universalResolverAbi,
} from '@egb/shared/names';
import { gameBoxLobbyAbi } from '@egb/shared/swap';
import { p256 } from '@noble/curves/nist.js';
import {
  type Abi,
  type Address,
  type Hex,
  bytesToHex,
  encodeAbiParameters,
  encodeEventTopics,
  hexToBytes,
  keccak256,
  labelhash,
  numberToHex,
  parseAbi,
  parseEther,
  toHex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { packetToBytes } from 'viem/ens';

import type { Addresses, Context } from '../src/request.ts';
import { type Deps, handle } from '../src/routes.ts';
import { Relay } from '../src/sender.ts';
import { FakeChain, Revert } from './fake-chain.ts';
import { MemoryStore } from './memory-store.ts';

export const NOW = 1_800_000_000;

export const REGISTRY: Address = '0x00000000000000000000000000000000000000a4';
export const STORE_POT: Address = '0x00000000000000000000000000000000000000ab';
export const STORE_USDC: Address = '0x00000000000000000000000000000000000000ac';
export const LOBBY: Address = '0x00000000000000000000000000000000000000ad';
export const HOOK: Address = '0x00000000000000000000000000000000000000ae';
export const addresses: Addresses = {
  names: '0x00000000000000000000000000000000000000a1',
  results: '0x00000000000000000000000000000000000000a2',
  licences: '0x00000000000000000000000000000000000000a3',
  usdc: '0x00000000000000000000000000000000000000a7',
  pot: '0x00000000000000000000000000000000000000a8',
  storePot: STORE_POT,
  storeUsdc: STORE_USDC,
  lobby: { lobby: LOBBY, hook: HOOK, usdcIsToken0: false },
  cups: '0x00000000000000000000000000000000000000a9',
  seats: '0x00000000000000000000000000000000000000aa',
  factory: '0x00000000000000000000000000000000000000a6',
  factoryBlock: 50n,
  registry: REGISTRY,
  reverseRegistrar: '0x00000000000000000000000000000000000000a5',
  targets: new Set(
    [
      '0x00000000000000000000000000000000000000a1',
      '0x00000000000000000000000000000000000000a2',
      '0x00000000000000000000000000000000000000a3',
      '0x00000000000000000000000000000000000000a4',
      '0x00000000000000000000000000000000000000a5',
      '0x00000000000000000000000000000000000000a6',
    ].map((address) => address.toLowerCase()),
  ),
};
export const BOX_ACCOUNT: Address = '0x00000000000000000000000000000000000000B0';
export const BOX_RESOLVER: Address = '0x00000000000000000000000000000000000000C0';
export const BOX = 'mumbai-01';

const N = p256.Point.CURVE().n;
const ACCOUNT_CODE: Hex = '0x6080';

/** A software P-256 key, signing raw digests the way the contracts check them. */
export function boxKey() {
  const secret = p256.utils.randomSecretKey();
  const point = p256.getPublicKey(secret, false);
  const sign = (digest: Hex, { highS = false } = {}): { r: Hex; s: Hex } => {
    const sig = p256.sign(hexToBytes(digest), secret, { prehash: false, lowS: true });
    const r = bytesToHex(sig.subarray(0, 32));
    const s = BigInt(bytesToHex(sig.subarray(32)));
    return { r, s: numberToHex(highS ? N - s : s, { size: 32 }) };
  };
  return {
    qx: bytesToHex(point.subarray(1, 33)),
    qy: bytesToHex(point.subarray(33)),
    sign,
    /** The raw `r ‖ s` form a `P256Account` takes; with `highS`, the same signature with a high `s`. */
    raw(digest: Hex, { highS = false } = {}): Hex {
      const { r, s } = sign(digest);
      return highS ? `0x${r.slice(2)}${numberToHex(N - BigInt(s), { size: 32 }).slice(2)}` : rawSignature(BigInt(r), BigInt(s));
    },
  };
}
export type Key = ReturnType<typeof boxKey>;

interface BoxEntry {
  operator: Address;
  account: Address;
  qx: Hex;
  qy: Hex;
  status: number;
  resolver: Address;
  expiry: bigint;
}

/** A `DuelPot.Pot`. `state`: 0 none, 1 open, 2 settled, 3 refunded. */
export interface PotEntry {
  a: Address;
  b: Address;
  amount: bigint;
  opened: bigint;
  state: number;
  game: Hex;
}

/** A `StorePot.Pot`. `state`: 0 none, 1 open, 2 settled, 3 voided, 4 refunded. */
export interface StorePotEntry {
  players: Address[];
  amount: bigint;
  opened: bigint;
  state: number;
  bundle: Hex;
  record: Hex;
}

/** A `Championships.Cup`. */
export interface CupEntry {
  game: string;
  label: string;
  resolver: Address;
  opener: Address;
  ends: bigint;
  prize: bigint;
  closed: boolean;
  winner: Address;
}

/** The slice of the Universal Resolver viem's `getEnsAddress` calls. */
const resolveWithGatewaysAbi = parseAbi([
  'function resolveWithGateways(bytes name, bytes data, string[] gateways) view returns (bytes, address)',
]);

interface AccountEntry {
  qx: Hex;
  qy: Hex;
  /** Whether `accountOf` of its current key is its address (false once it rotated). */
  matchesKey: boolean;
}

export class World {
  readonly chain = new FakeChain();
  readonly store = new MemoryStore();
  readonly key = boxKey();
  readonly relayerAccount = privateKeyToAccount(generatePrivateKey());
  readonly players = new Map<string, string>();
  readonly boxes = new Map<string, BoxEntry>();
  readonly popups = new Map<string, bigint>();
  readonly registered = new Set<string>();
  readonly resolvers = new Map<string, Address>([[BOX, BOX_RESOLVER]]);
  readonly usedRounds = new Set<string>();
  readonly usedNonces = new Set<string>();
  readonly accounts = new Map<string, AccountEntry>();
  /** USDC balances by address (lower-cased). */
  readonly usdc = new Map<string, bigint>();
  /** Pots by `box:round`. */
  readonly pots = new Map<string, PotEntry>();
  /** Store USDC balances by address (lower-cased). */
  readonly storeUsdc = new Map<string, bigint>();
  /** `StorePot`'s pots by `box:round`. */
  readonly storePots = new Map<string, StorePotEntry>();
  /** The bundles `StorePot` lists. */
  readonly listed = new Set<string>();
  /** Who holds `VERIFIER_ROLE` (lower-cased). */
  readonly verifiers = new Set<string>();
  /** Open championship ids by game, and championships by id. */
  readonly openCups = new Map<string, bigint>();
  readonly cups = new Map<bigint, CupEntry>();
  /** What the Universal Resolver resolves each ENS name to. */
  readonly ensNames = new Map<string, Address>();
  /** Signatures (lower-cased) each account's `isValidSignature` accepts. */
  readonly erc1271 = new Map<string, Set<string>>();
  /** The GBX `GameBoxLobby.buy` returns. */
  gbxOut = 99_750_000_000_000_000_000n;
  /** Function name -> the contract error its `eth_call` reverts with. */
  readonly reverts = new Map<string, [Abi, string, unknown[]]>();
  readonly relay: Relay;
  readonly deps: Deps;
  wakes = 0;
  /** Unix seconds, for the relay and the routes. */
  time = NOW;

  constructor() {
    this.boxes.set(BOX, {
      operator: '0x00000000000000000000000000000000000000E0',
      account: BOX_ACCOUNT,
      qx: this.key.qx,
      qy: this.key.qy,
      status: 1,
      resolver: BOX_RESOLVER,
      expiry: BigInt(NOW + 30 * 86_400),
    });
    this.addAccount(BOX_ACCOUNT, this.key);
    const none: BoxEntry = {
      operator: zero,
      account: zero,
      qx: `0x${'00'.repeat(32)}`,
      qy: `0x${'00'.repeat(32)}`,
      status: 0,
      resolver: zero,
      expiry: 0n,
    };
    this.chain
      .contract(addresses.names, gameBoxNamesAbi as Abi, {
        labelOf: ([badge]) => this.players.get(String(badge).toLowerCase()) ?? '',
        nameOf: ([badge]) => {
          const label = this.players.get(String(badge).toLowerCase());
          return label ? `${label}.gamebox.eth` : '';
        },
        getBox: ([label]) => this.boxes.get(String(label)) ?? none,
        getPopup: ([label]) => ({ ofBox: this.popups.has(String(label)) ? BOX : '', expiry: this.popups.get(String(label)) ?? 0n }),
        REGISTRY: () => REGISTRY,
        claimPlayer: () => (this.fail('claimPlayer'), zero),
      })
      .contract(REGISTRY, permissionedRegistryAbi as Abi, {
        getStatus: ([id]) => (this.registered.has(toHex(id as bigint, { size: 32 })) ? 2 : 0),
        getResolver: ([label]) => this.resolvers.get(String(label)) ?? zero,
      })
      .contract(addresses.factory, p256AccountFactoryAbi as Abi, {
        accountOf: ([qx, qy]) => this.accountOf(qx as Hex, qy as Hex),
        deploy: ([qx, qy]) => (this.fail('deploy'), this.accountOf(qx as Hex, qy as Hex)),
      })
      .contract(addresses.results, boxResultsAbi as Abi, {
        roundUsed: ([box, round]) => this.usedRounds.has(`${box}:${round}`),
        submit: () => this.fail('submit'),
      })
      .contract(addresses.licences, demoLicencesAbi as Abi, {
        openPopup: ([label]) => (this.fail('openPopup'), `popup-${label}`),
      })
      .contract(addresses.reverseRegistrar, defaultReverseRegistrarAbi as Abi, {
        setNameForAddrWithSignature: () => this.fail('setNameForAddrWithSignature'),
      })
      .contract(addresses.usdc, fakeUsdcAbi as Abi, {
        balanceOf: ([account]) => this.usdc.get(String(account).toLowerCase()) ?? 0n,
        mint: () => this.fail('mint'),
      })
      .contract(addresses.pot, duelPotAbi as Abi, {
        getPot: ([box, round]) => this.pots.get(`${box}:${round}`) ?? noPot,
        REFUND_DELAY: () => 3600n,
        open: () => this.fail('open'),
        refund: () => this.fail('refund'),
      })
      .contract(STORE_USDC, fakeUsdcAbi as Abi, {
        balanceOf: ([account]) => this.storeUsdc.get(String(account).toLowerCase()) ?? 0n,
        mint: () => this.fail('mint'),
      })
      .contract(STORE_POT, storePotAbi as Abi, {
        VERIFIER_ROLE: () => VERIFIER_ROLE,
        hasRole: ([role, account]) => role === VERIFIER_ROLE && this.verifiers.has(String(account).toLowerCase()),
        listed: ([bundle]) => this.listed.has(String(bundle)),
        getPot: ([box, round]) => this.storePots.get(`${box}:${round}`) ?? noStorePot,
        REFUND_DELAY: () => 3600n,
        open: () => this.fail('open'),
        settle: () => this.fail('settle'),
        voidPot: () => this.fail('voidPot'),
        refund: () => this.fail('refund'),
      })
      .contract(LOBBY, gameBoxLobbyAbi as Abi, {
        buy: () => (this.fail('buy'), [this.gbxOut, false]),
      })
      .contract(addresses.cups, championshipsAbi as Abi, {
        openCup: ([game]) => this.openCups.get(String(game)) ?? 0n,
        getCup: ([id]) => this.cups.get(id as bigint),
        close: () => (this.fail('close'), zero),
      })
      .contract(addresses.seats, boxSeatsAbi as Abi, {
        claim: () => (this.fail('claim'), zero),
      })
      .contract(sepolia.contracts.ensUniversalResolver.address, resolveWithGatewaysAbi, {
        resolveWithGateways: ([name]) => {
          const entry = [...this.ensNames].find(([known]) => toHex(packetToBytes(known)) === name);
          if (!entry) throw new Revert(universalResolverAbi as Abi, 'ResolverNotFound', [name]);
          return [encodeAbiParameters([{ type: 'address' }], [entry[1]]), zero];
        },
      });

    this.relay = new Relay({
      store: this.store,
      client: this.chain.client,
      account: this.relayerAccount,
      tipWei: 2_000_000_000n,
      now: () => this.time,
      wake: async () => void this.wakes++,
    });
    const ctx: Context = {
      client: this.chain.client,
      relayer: this.relayerAccount.address,
      addresses,
      now: () => this.time,
      dripWei: parseEther('0.0003'),
    };
    this.deps = { ctx, relayer: this.relay, allowedOrigins: 'https://gamebox-names.pages.dev,http://localhost:*' };
  }

  private fail(name: string): void {
    const revert = this.reverts.get(name);
    if (revert) throw new Revert(...revert);
  }

  /** The factory's address for a key: a stand-in for CREATE2. */
  accountOf(qx: Hex, qy: Hex): Address {
    for (const [address, entry] of this.accounts) {
      if (entry.matchesKey && entry.qx === qx && entry.qy === qy) return address as Address;
    }
    return `0x${qx.slice(2, 42)}`;
  }

  /** A deployed `P256Account` of `key` at `address`. With `rotated`, its key no longer gives its address; with
   *  `madeByFactory: false`, the factory never deployed it either. */
  addAccount(address: Address, key: Pick<Key, 'qx' | 'qy'>, options: { rotated?: boolean; madeByFactory?: boolean } = {}) {
    const { rotated = false, madeByFactory = true } = options;
    this.accounts.set(address.toLowerCase(), { qx: key.qx, qy: key.qy, matchesKey: madeByFactory && !rotated });
    this.chain.code.set(address.toLowerCase(), ACCOUNT_CODE);
    if (rotated && madeByFactory) {
      const topics = encodeEventTopics({ abi: p256AccountFactoryAbi, eventName: 'AccountDeployed', args: { account: address } });
      const data = encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [`0x${'11'.repeat(32)}`, `0x${'22'.repeat(32)}`]);
      this.chain.logs.push({ address: addresses.factory, topics: topics as Hex[], data });
    }
    this.chain.contract(address, p256AccountAbi as Abi, {
      publicKey: () => [key.qx, key.qy],
      nonceUsed: ([nonce]) => this.usedNonces.has(`${address.toLowerCase()}:${nonce}`),
      isValidSignature: ([, signature]) =>
        this.erc1271.get(address.toLowerCase())?.has(String(signature).toLowerCase()) ? '0x1626ba7e' : '0xffffffff',
      execute: () => (this.fail('execute'), '0x'),
      executeBatch: () => (this.fail('executeBatch'), []),
    });
    return this;
  }

  register(label: string): void {
    this.registered.add(labelhash(label));
  }

  async post(path: string, body: unknown, headers: Record<string, string> = {}) {
    const request = new Request(`https://relayer.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers },
      body: JSON.stringify(body, (_, value) => (typeof value === 'bigint' ? value.toString() : value)),
    });
    const response = await handle(request, this.deps);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async get(path: string) {
    const response = await handle(new Request(`https://relayer.test${path}`), this.deps);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }
}

const zero: Address = '0x0000000000000000000000000000000000000000';
const noPot: PotEntry = { a: zero, b: zero, amount: 0n, opened: 0n, state: 0, game: `0x${'00'.repeat(32)}` };
const noStorePot: StorePotEntry = {
  players: [],
  amount: 0n,
  opened: 0n,
  state: 0,
  bundle: `0x${'00'.repeat(32)}`,
  record: `0x${'00'.repeat(32)}`,
};
const VERIFIER_ROLE = keccak256(toHex('VERIFIER_ROLE'));
