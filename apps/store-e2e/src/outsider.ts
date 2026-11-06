// Someone with no Box in front of them: they sign what they like, send it to the relayer, the verifier or `StorePot`
// itself, and read what comes back. A pot a scenario wants to attack is opened here too, with the Box's key, so nothing
// else is judging it.

import type { MatchLog } from '@egb/sdk';
import type { TxView } from '@egb/shared/names';
import {
  type StoreStake,
  type StoreVerdict,
  type StoreVoid,
  judgeDigest,
  jsonTextHash,
  storePotAbi,
  storeStakeDigest,
  storeVerdictTypedData,
  storeVoidTypedData,
} from '@egb/shared/store';
import { p256 } from '@noble/curves/nist.js';
import { type Address, BaseError, ContractFunctionRevertedError, type Hex, bytesToHex, createWalletClient, hexToBytes, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

import { BOX_LABEL, type World } from './world.ts';

/** How long a signed message is good for: past any scenario. */
const SIGNED_FOR_SECONDS = 600;
/** What a transaction that must revert gets, as nothing can estimate one. */
const REVERT_GAS = 1_000_000n;
/** A relayer's send, from taking it to a block past its own. */
const DONE_MS = 30_000;

export interface Answer {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

const deadline = () => BigInt(Math.floor(Date.now() / 1000) + SIGNED_FOR_SECONDS);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function post(url: string, body: unknown): Promise<Answer> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** A message as a route reads it: every big number a decimal string. */
const wire = (message: object): unknown => JSON.parse(JSON.stringify(message, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value)));

function p256Sign(key: Hex, digest: Hex) {
  const signature = p256.sign(hexToBytes(digest), hexToBytes(key), { prehash: false, lowS: true, format: 'compact' });
  return { r: bytesToHex(signature.subarray(0, 32)), s: bytesToHex(signature.subarray(32)) };
}

export function outsider({ chain, keys, contracts: { pot }, relayerUrl, verifierUrl }: World) {
  const wallet = createWalletClient({ account: privateKeyToAccount(keys.stranger), chain: sepolia, transport: http(chain.url) });
  const potContract = { address: pot, abi: storePotAbi } as const;

  /** Follows a relayer's request to its end. */
  async function done(id: string): Promise<TxView> {
    const until = Date.now() + DONE_MS;
    while (Date.now() < until) {
      const tx = (await (await fetch(`${relayerUrl}/tx/${id}`)).json()) as TxView;
      if (tx.status === 'done' || tx.status === 'failed') return tx;
      await sleep(200);
    }
    throw new Error(`the relayer never finished ${id}`);
  }

  /** A `Stake` signed with the Box's key. */
  function signedStake(round: bigint, bundle: Hex, players: readonly Address[], amount: bigint) {
    const stake: StoreStake = { box: BOX_LABEL, bundle, round, players, amount, deadline: deadline() };
    return { stake, ...p256Sign(keys.box, storeStakeDigest(stake, pot)) };
  }

  return {
    signedStake,

    /** Opens a pot through the relayer, with the Box's key. */
    async openPot(round: bigint, bundle: Hex, players: readonly Address[], amount: bigint): Promise<void> {
      const { stake, r, s } = signedStake(round, bundle, players, amount);
      const answer = await post(`${relayerUrl}/store/open`, { stake: wire(stake), r, s });
      if (answer.status !== 202) throw new Error(`the relayer refused the stake: ${JSON.stringify(answer.body)}`);
      const tx = await done(answer.body.id as string);
      if (tx.status !== 'done') throw new Error(`the stake failed: ${JSON.stringify(tx)}`);
    },

    verdict: (round: bigint, payouts: readonly bigint[]): StoreVerdict => ({ box: BOX_LABEL, round, payouts, record: jsonTextHash('{}'), deadline: deadline() }),
    voiding: (round: bigint): StoreVoid => ({ box: BOX_LABEL, round, record: jsonTextHash('{}'), deadline: deadline() }),
    signVerdict: (key: Hex, verdict: StoreVerdict) => privateKeyToAccount(key).signTypedData(storeVerdictTypedData(verdict, pot)),
    signVoid: (key: Hex, voiding: StoreVoid) => privateKeyToAccount(key).signTypedData(storeVoidTypedData(voiding, pot)),

    settleAtRelayer: (verdict: StoreVerdict, signature: Hex) => post(`${relayerUrl}/store/settle`, { verdict: wire(verdict), signature }),
    voidAtRelayer: (voiding: StoreVoid, signature: Hex) => post(`${relayerUrl}/store/void`, { void: wire(voiding), signature }),
    refundAtRelayer: (round: bigint) => post(`${relayerUrl}/store/refund`, { box: BOX_LABEL, round: String(round) }),

    /** Sends a log to the verifier, signed with the P-256 `key`. */
    async judge(log: MatchLog, key: Hex = keys.box): Promise<Answer> {
      const text = JSON.stringify(log);
      const judge = { box: log.header.box, round: BigInt(log.header.round), log: jsonTextHash(text), deadline: deadline() };
      return post(`${verifierUrl}/judge`, { log: text, deadline: String(judge.deadline), ...p256Sign(key, judgeDigest(judge, pot)) });
    },

    /** Sends a call straight to `StorePot`, from a key that holds no role, and the chain must revert it. The error's name
     *  comes from a simulation, and the receipt is the proof. */
    async refusedByPot(functionName: 'open' | 'settle' | 'voidPot' | 'refund', args: readonly unknown[]): Promise<string> {
      const call = { ...potContract, functionName, args, account: wallet.account } as never;
      const error: unknown = await chain.client.simulateContract(call).then(
        () => null,
        (failure: unknown) => failure,
      );
      const reverted = error instanceof BaseError ? error.walk((cause) => cause instanceof ContractFunctionRevertedError) : null;
      if (!(reverted instanceof ContractFunctionRevertedError)) throw new Error(`${functionName} didn't revert`);
      const hash = await wallet.writeContract({ ...(call as object), gas: REVERT_GAS } as never);
      const { status } = await chain.client.waitForTransactionReceipt({ hash });
      if (status !== 'reverted') throw new Error(`${functionName} went through on chain`);
      return reverted.data?.errorName ?? 'unknown';
    },

    /** Refunds a pot straight on `StorePot`, from a key that holds no role. */
    async refund(round: bigint): Promise<void> {
      const hash = await wallet.writeContract({ ...potContract, functionName: 'refund', args: [BOX_LABEL, round] });
      const { status } = await chain.client.waitForTransactionReceipt({ hash });
      if (status !== 'success') throw new Error(`refunding ${round} reverted`);
    },
  };
}
