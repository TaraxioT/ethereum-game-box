// Everything a run needs, started in order and stopped in the other: anvil with the contracts, the fake 0G, the relayer,
// the store and the verifier on `wrangler dev`, and a man in the middle in front of the store. The Box comes last, once
// there is a game for its rack.

import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SERVING_CONTRACT } from '@egb/verifier/test/fake-zg';
import { p256 } from '@noble/curves/nist.js';
import { type Address, bytesToHex, hexToBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { removeAgents } from './agents.ts';
import { type Chain, startChain } from './anvil.ts';
import { type RunningBox, startBox } from './box.ts';
import { type Contracts, buildContracts, deployContracts, giveNames } from './contracts.ts';
import { type RunKeys, makeKeys } from './keys.ts';
import { local, PORTS, requirePortsFree } from './ports.ts';
import type { Child } from './processes.ts';
import { type Tamper, startTamper } from './tamper.ts';
import { startWorker } from './wrangler.ts';
import { type FakeZgControl, startZg } from './zg.ts';

export const BOX_LABEL = 'e2e-01';
/** What the Worker sends the fake 0G: made up, and worth nothing. */
export const ZG_API_KEY = 'made-up-for-the-fake';

export interface World {
  /** The run's folder. */
  readonly work: string;
  readonly chain: Chain;
  readonly keys: RunKeys;
  readonly contracts: Contracts;
  readonly zg: FakeZgControl;
  readonly tamper: Tamper;
  readonly relayerUrl: string;
  readonly storeUrl: string;
  readonly verifierUrl: string;
  /** Gives each badge a player name. */
  name(badges: readonly Address[]): Promise<void>;
  /** Starts the Box, or starts it again, on the same data. */
  startBox(): Promise<RunningBox>;
  /** Stops the verifier's Worker. Its state stays. */
  stopVerifier(): Promise<void>;
  startVerifier(): Promise<void>;
  stop(): Promise<void>;
}

function boxPoint(key: RunKeys['box']) {
  const point = p256.getPublicKey(hexToBytes(key), false);
  return { qx: bytesToHex(point.subarray(1, 33)), qy: bytesToHex(point.subarray(33)) };
}

export async function startWorld(): Promise<World> {
  await requirePortsFree();
  removeAgents();
  buildContracts();
  // One folder for every run, as the ports allow only one at a time: an interrupted run's is gone with the next.
  const work = path.join(tmpdir(), 'egb-store-e2e');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work);
  const keys = makeKeys();
  const chain = await startChain();

  const accounts = [keys.relayer, keys.admin, keys.lister, keys.stranger].map((key) => privateKeyToAccount(key).address);
  for (const address of accounts) await chain.fund(address);
  const contracts = await deployContracts(chain, keys, { label: BOX_LABEL, ...boxPoint(keys.box) }, path.join(work, 'deployments.json'));

  const zg = await startZg();
  const relayerUrl = local(PORTS.relayer);
  const storeUrl = local(PORTS.store);
  const verifierUrl = local(PORTS.verifier);
  const { deployments } = contracts;

  const [relayer, store] = await Promise.all([
    startWorker({
      app: 'relayer',
      port: PORTS.relayer,
      inspectorPort: PORTS.relayerInspector,
      secrets: { RELAYER_PRIVATE_KEY: keys.relayer, SEPOLIA_RPC_URL: chain.url },
      vars: {},
      deployments,
      work,
    }),
    startWorker({
      app: 'store',
      port: PORTS.store,
      inspectorPort: PORTS.storeInspector,
      secrets: { STORE_PUBLISH_TOKEN: keys.publish },
      vars: {},
      deployments,
      work,
    }),
  ]);
  const tamper = await startTamper(storeUrl);

  const verifierOptions = {
    app: 'verifier',
    port: PORTS.verifier,
    inspectorPort: PORTS.verifierInspector,
    secrets: {
      VERIFIER_PRIVATE_KEY: keys.verifier,
      ZG_API_KEY,
      ZG_STORAGE_KEY: keys.storage,
      SEPOLIA_RPC_URL: chain.url,
    },
    vars: {
      ZG_BASE_URL: `${zg.url}/v1`,
      ZG_RPC: `${zg.url}/rpc`,
      ZG_SERVING_CONTRACT: SERVING_CONTRACT,
      ZG_STORAGE_RPC: `${zg.url}/rpc`,
      ZG_STORAGE_INDEXER: `${zg.url}/indexer`,
      RELAYER_URL: relayerUrl,
      // Through the man in the middle, as the Box is, so a run can show it a changed zip too.
      STORE_URL: tamper.url,
    },
    deployments,
    work,
  };
  let verifier: Child | null = await startWorker(verifierOptions);

  let box: RunningBox | null = null;

  return {
    work,
    chain,
    keys,
    contracts,
    zg,
    tamper,
    relayerUrl,
    storeUrl,
    verifierUrl,
    name: (badges) => giveNames(chain, keys, contracts, badges),
    async startBox() {
      await box?.stop();
      box = await startBox({
        label: BOX_LABEL,
        keys,
        deployments,
        chainUrl: chain.url,
        relayerUrl,
        storeUrl: tamper.url,
        verifierUrl,
        work,
      });
      return box;
    },
    async stopVerifier() {
      await verifier?.stop();
      verifier = null;
      removeAgents();
    },
    async startVerifier() {
      verifier ??= await startWorker(verifierOptions);
    },
    async stop() {
      await box?.stop();
      await verifier?.stop();
      removeAgents();
      await tamper.stop();
      await Promise.all([relayer.stop(), store.stop()]);
      await zg.stop();
      await chain.stop();
      rmSync(work, { recursive: true, force: true });
    },
  };
}
