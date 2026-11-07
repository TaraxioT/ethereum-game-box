// The Durable Object that keeps one judgement per pot, named `<box>:<round>`. Its alarm drives everything: a run, the
// payment and the upload each happen in an alarm, so nothing depends on a request staying open.

import { rpc, sepoliaClient } from '@egb/relayer/chain';
import { DurableObject } from 'cloudflare:workers';
import { type Address, type Hex } from 'viem';

import { containerRunner } from './container.ts';
import type { Env } from './env.ts';
import { Judge, type JudgeJob } from './judge.ts';
import { LIMITS } from './limits.ts';
import { deployedPot, readPot } from './pot.ts';
import { type Scrub, envScrubber } from './safe.ts';
import { verifierSigner } from './signer.ts';
import { SignedChatCheck, cachedServices } from './tee.ts';
import { payRelayer, upstream } from './upstream.ts';
import { zgServices, zgTransport } from './zg-chain.ts';
import { ZgAuditStore } from './zg-storage.ts';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class Judgement extends DurableObject<Env> {
  private readonly judge: Judge;
  private readonly scrub: Scrub;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.scrub = envScrubber(env);
    const client = sepoliaClient(rpc(env.SEPOLIA_RPC_URL));
    const services = cachedServices(zgServices(env.ZG_SERVING_CONTRACT as Address, zgTransport(env.ZG_RPC)));
    this.judge = new Judge({
      store: ctx.storage,
      wake: (at) => ctx.storage.setAlarm(at),
      now: Date.now,
      runner: containerRunner(env, this.scrub),
      proxy: {
        baseUrl: env.ZG_BASE_URL,
        apiKey: env.ZG_API_KEY,
        model: env.ZG_MODEL,
        tee: new SignedChatCheck({ services, fetch, sleep }),
        fetch,
        scrub: this.scrub,
      },
      signer: verifierSigner(env.VERIFIER_PRIVATE_KEY as Hex, deployedPot),
      relayer: payRelayer(upstream(env.RELAYER, env.RELAYER_URL)),
      potState: async (box, round) => (await readPot(client, deployedPot(), box, round)).state,
      audits: new ZgAuditStore({
        indexerUrl: env.ZG_STORAGE_INDEXER,
        rpcUrl: env.ZG_STORAGE_RPC,
        key: env.ZG_STORAGE_KEY,
        timeoutMs: LIMITS.uploadMs,
      }),
      scrub: this.scrub,
    });
  }

  find(logHash: Hex) {
    return this.judge.find(logHash);
  }

  begin(job: JudgeJob) {
    return this.judge.begin(job);
  }

  status() {
    return this.judge.status();
  }

  audit() {
    return this.judge.audit();
  }

  recordText() {
    return this.judge.recordText();
  }

  modelTurn(attempt: number, text: string) {
    return this.judge.modelTurn(attempt, text);
  }

  override async alarm(): Promise<void> {
    // Set the next alarm directly: inside the handler, the running alarm may still read as set.
    let next: number | null;
    try {
      next = await this.judge.advance();
    } catch (error) {
      console.error(`advancing failed: ${this.scrub(error)}`);
      next = Date.now() + LIMITS.retryMs;
    }
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }
}
