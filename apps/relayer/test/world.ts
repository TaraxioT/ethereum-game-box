// A fake Game Box names deployment on the fake chain, with the relayer's routes and sender wired to it.

import {
  boxResultsAbi,
  defaultReverseRegistrarAbi,
  demoLicencesAbi,
  gameBoxNamesAbi,
  p256AccountAbi,
  p256AccountFactoryAbi,
  permissionedRegistryAbi,
  rawSignature,
} from '@egb/shared/names';
import { p256 } from '@noble/curves/nist.js';
import {
  type Abi,
  type Address,
  type Hex,
  bytesToHex,
  encodeAbiParameters,
  encodeEventTopics,
  hexToBytes,
  labelhash,
  numberToHex,
  parseEther,
  toHex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import type { Addresses, Context } from '../src/request.ts';
import { type Deps, handle } from '../src/routes.ts';
import { Relay } from '../src/sender.ts';
import { FakeChain, Revert } from './fake-chain.ts';
import { MemoryStore } from './memory-store.ts';

export const NOW = 1_800_000_000;

export const REGISTRY: Address = '0x00000000000000000000000000000000000000a4';
export const addresses: Addresses = {
  names: '0x00000000000000000000000000000000000000a1',
  results: '0x00000000000000000000000000000000000000a2',
  licences: '0x00000000000000000000000000000000000000a3',
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
  /** Signatures (lower-cased) each account's `isValidSignature` accepts. */
  readonly erc1271 = new Map<string, Set<string>>();
  /** Function name -> the contract error its `eth_call` reverts with. */
  readonly reverts = new Map<string, [Abi, string, unknown[]]>();
  readonly relay: Relay;
  readonly deps: Deps;
  wakes = 0;

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
      });

    this.relay = new Relay({
      store: this.store,
      client: this.chain.client,
      account: this.relayerAccount,
      tipWei: 2_000_000_000n,
      now: () => NOW,
      wake: async () => void this.wakes++,
    });
    const ctx: Context = {
      client: this.chain.client,
      relayer: this.relayerAccount.address,
      addresses,
      now: () => NOW,
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
