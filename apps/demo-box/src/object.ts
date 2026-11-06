// The `DemoBox` Durable Object: the one demo Box and its agent, with the alarm that beats every 5 minutes and closes
// any championship whose `ends` has passed. Both are built on first use, so a missing address or secret is an error on
// that call, not a broken object.

import { type DemoBoxView, contractAddress, namesProxies } from '@egb/shared/names';
import { describe } from '@egb/relayer/chain';
import { DurableObject } from 'cloudflare:workers';
import { type Hex, toHex } from 'viem';

import { Agent, type AgentView } from './agent.ts';
import { Box } from './box.ts';
import { type BoxChain, sepoliaChain } from './chain.ts';
import { closeEndedCups } from './cups.ts';
import type { Env } from './env.ts';
import { relayer } from './relayer.ts';
import type { Reply } from './relayer.ts';
import { p256Signer } from './signer.ts';

/** How often the Box beats, and looks for an ended championship. */
const HEARTBEAT_MS = 5 * 60_000;

const now = () => Math.floor(Date.now() / 1000);

/** A random 128-bit `P256Account` nonce: nonces are unordered, so a random one never collides in practice. */
function randomNonce(): bigint {
  return BigInt(toHex(crypto.getRandomValues(new Uint8Array(16))));
}

function deployedContracts() {
  return {
    names: contractAddress('GameBoxNames'),
    results: contractAddress('BoxResults'),
    pot: contractAddress('DuelPot'),
    cups: contractAddress('Championships'),
    factory: contractAddress('P256AccountFactory'),
    registry: namesProxies().registry,
  };
}

export class DemoBox extends DurableObject<Env> {
  private madeBox: Box | undefined;
  private madeAgent: Agent | undefined;
  private madeChain: BoxChain | undefined;

  private get chain(): BoxChain {
    this.madeChain ??= sepoliaChain(this.env.SEPOLIA_RPC_URL, deployedContracts());
    return this.madeChain;
  }

  private get box(): Box {
    if (this.madeBox) return this.madeBox;
    const contracts = deployedContracts();
    this.madeBox = new Box({
      store: this.ctx.storage,
      chain: this.chain,
      signer: p256Signer(this.env.DEMO_BOX_P256_KEY as Hex),
      account: contractAddress('DemoBoxAccount'),
      label: this.env.BOX_LABEL,
      defaultGame: this.env.DEFAULT_GAME,
      results: contracts.results,
      pot: contracts.pot,
      relayer: relayer(this.env),
      now,
      nonce: randomNonce,
    });
    return this.madeBox;
  }

  private get agent(): Agent {
    if (this.madeAgent) return this.madeAgent;
    const contracts = deployedContracts();
    this.madeAgent = new Agent({
      store: this.ctx.storage,
      chain: sepoliaChain(this.env.SEPOLIA_RPC_URL, contracts),
      signer: p256Signer(this.env.AGENT_P256_KEY as Hex, 'AGENT_P256_KEY'),
      label: this.env.AGENT_LABEL,
      names: contracts.names,
      mcpUrl: new URL('/mcp', this.env.PUBLIC_URL).href,
      relayer: relayer(this.env),
      now,
      nonce: randomNonce,
    });
    return this.madeAgent;
  }

  view(): Promise<DemoBoxView> {
    return this.box.view();
  }

  report(input: unknown, ip: string): Promise<Reply> {
    return this.box.report(input, ip);
  }

  stake(input: unknown, ip: string): Promise<Reply> {
    return this.box.stake(input, ip);
  }

  agentView(): Promise<AgentView> {
    return this.agent.view();
  }

  agentSetup(): Promise<Reply> {
    return this.agent.setup();
  }

  /** Starts the heartbeat if it isn't running: the first beat is now. */
  async start(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now());
  }

  override async alarm(): Promise<void> {
    try {
      await this.box.heartbeat();
    } catch (error) {
      console.error(`heartbeat failed: ${describe(error)}`);
    }
    try {
      const games = this.env.CUP_GAMES.split(',').map((game) => game.trim()).filter(Boolean);
      await closeEndedCups({ chain: this.chain, relayer: relayer(this.env), games, now });
    } catch (error) {
      console.error(`closing championships failed: ${describe(error)}`);
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
    }
  }
}
