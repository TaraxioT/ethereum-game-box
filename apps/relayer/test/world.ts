// A fake Game Box names deployment on the fake chain, with the relayer's routes and sender wired to it.

import {
  boxAccountAbi,
  boxResultsAbi,
  demoLicencesAbi,
  gameBoxNamesAbi,
  permissionedRegistryAbi,
} from '@egb/shared/names';
import { p256 } from '@noble/curves/nist.js';
import { type Abi, type Address, type Hex, bytesToHex, hexToBytes, labelhash, numberToHex, parseEther, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import type { Addresses, Context } from '../src/request.ts';
import { type Deps, handle } from '../src/routes.ts';
import { Relay } from '../src/sender.ts';
import { FakeChain, Revert } from './fake-chain.ts';
import { MemoryStore } from './memory-store.ts';

export const NOW = 1_800_000_000;

export const addresses: Addresses = {
  names: '0x00000000000000000000000000000000000000a1',
  results: '0x00000000000000000000000000000000000000a2',
  licences: '0x00000000000000000000000000000000000000a3',
};
export const REGISTRY: Address = '0x00000000000000000000000000000000000000a4';
export const BOX_ACCOUNT: Address = '0x00000000000000000000000000000000000000B0';
export const BOX_RESOLVER: Address = '0x00000000000000000000000000000000000000C0';
export const BOX = 'mumbai-01';

const N = p256.Point.CURVE().n;

/** A software Box key, signing raw digests the way the contracts check them. */
export function boxKey() {
  const secret = p256.utils.randomSecretKey();
  const point = p256.getPublicKey(secret, false);
  return {
    qx: bytesToHex(point.subarray(1, 33)),
    qy: bytesToHex(point.subarray(33)),
    sign(digest: Hex, { highS = false } = {}): { r: Hex; s: Hex } {
      const sig = p256.sign(hexToBytes(digest), secret, { prehash: false, lowS: true });
      const r = bytesToHex(sig.subarray(0, 32));
      const s = BigInt(bytesToHex(sig.subarray(32)));
      return { r, s: numberToHex(highS ? N - s : s, { size: 32 }) };
    },
  };
}

interface BoxEntry {
  operator: Address;
  account: Address;
  qx: Hex;
  qy: Hex;
  status: number;
  resolver: Address;
  expiry: bigint;
}

export class World {
  readonly chain = new FakeChain();
  readonly store = new MemoryStore();
  readonly key = boxKey();
  readonly relayerAccount = privateKeyToAccount(generatePrivateKey());
  readonly players = new Map<string, string>();
  readonly boxes = new Map<string, BoxEntry>();
  readonly registered = new Set<string>();
  readonly usedRounds = new Set<string>();
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
    const fail = (name: string) => {
      const revert = this.reverts.get(name);
      if (revert) throw new Revert(...revert);
    };
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
        REGISTRY: () => REGISTRY,
        claimPlayer: () => (fail('claimPlayer'), zero),
      })
      .contract(REGISTRY, permissionedRegistryAbi as Abi, {
        getStatus: ([id]) => (this.registered.has(toHex(id as bigint, { size: 32 })) ? 2 : 0),
      })
      .contract(addresses.results, boxResultsAbi as Abi, {
        roundUsed: ([box, round]) => this.usedRounds.has(`${box}:${round}`),
        submit: () => fail('submit'),
      })
      .contract(addresses.licences, demoLicencesAbi as Abi, {
        openPopup: ([label]) => (fail('openPopup'), `popup-${label}`),
      })
      .contract(BOX_ACCOUNT, boxAccountAbi as Abi, {
        execute: () => (fail('execute'), '0x'),
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
