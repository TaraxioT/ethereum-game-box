import {
  AGENT_KEYS,
  type ClaimRequest,
  type ExecuteRequest,
  P256_VECTOR_KEY,
  agentEndpointKey,
  claimNameDigest,
  executeBatchDigest,
  executeDigest,
  fullName,
  permissionedResolverAbi,
} from '@egb/shared/names';
import { MemoryStore } from '@egb/relayer/test/memory-store';
import { accountSignatureProblem } from '@egb/relayer/verify';
import { type Address, type Hex, decodeFunctionData, toHex } from 'viem';
import { packetToBytes } from 'viem/ens';
import { describe, expect, it } from 'vitest';

import { Agent, type AgentSetupReply } from '../src/agent.ts';
import type { AgentChain } from '../src/chain.ts';
import type { Reply } from '../src/relayer.ts';
import { p256Signer } from '../src/signer.ts';

const NOW = 1_800_000_000;
const ACCOUNT: Address = '0x00000000000000000000000000000000000000d2';
const NAMES: Address = '0x00000000000000000000000000000000000000a1';
const RESOLVER: Address = '0x00000000000000000000000000000000000000c2';
const MCP_URL = 'https://demo-box.test/mcp';

function setup() {
  const signer = p256Signer(P256_VECTOR_KEY.privateKey, 'AGENT_P256_KEY');
  const state = { deployed: false, name: '', records: new Map<string, string>(), txStatus: 'sent' };
  const chain: AgentChain = {
    accountOf: async (qx, qy) => (qx === signer.qx && qy === signer.qy ? ACCOUNT : `0x${'00'.repeat(20)}`),
    deployed: async () => state.deployed,
    nameOf: async () => state.name,
    resolverOf: async (label) => (label === 'bot' ? RESOLVER : `0x${'00'.repeat(20)}`),
    text: async (resolver, label, key) => (resolver === RESOLVER && label === 'bot' ? (state.records.get(key) ?? '') : ''),
  };
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  let reply: Reply | undefined;
  let nonce = 1n;
  const agent = new Agent({
    store: new MemoryStore(),
    chain,
    signer,
    label: 'bot',
    names: NAMES,
    mcpUrl: MCP_URL,
    relayer: {
      post: async (path, body) => {
        posts.push({ path, body: body as Record<string, unknown> });
        return reply ?? { status: 202, body: { id: `id-${posts.length}` } };
      },
      get: async (path) => ({ status: 200, body: { id: path.slice(4), status: state.txStatus } }),
    },
    now: () => NOW,
    nonce: () => nonce++,
  });
  const setReply = (next: Reply) => void (reply = next);
  return { agent, signer, state, posts, setReply };
}

const step = async (agent: Agent) => (await agent.setup()).body as unknown as AgentSetupReply;

const setTexts = (body: ExecuteRequest) =>
  (body.calls ?? [body.call!]).map((call) => {
    expect(call.target).toBe(RESOLVER);
    const [name, key, value] = decodeFunctionData({ abi: permissionedResolverAbi, data: call.data }).args as [Hex, string, string];
    expect(name).toBe(toHex(packetToBytes(fullName('bot'))));
    return [key, value];
  });

describe('the agent', () => {
  it('shows its name, its account from the factory, its key and the ENSIP-26 records it publishes', async () => {
    const { agent, signer } = setup();
    const view = await agent.view();
    expect(view).toMatchObject({ label: 'bot', name: 'bot.gamebox.eth', account: ACCOUNT, qx: signer.qx, qy: signer.qy, next: 'deploy' });
    expect(view.records[agentEndpointKey('mcp')]).toBe(MCP_URL);
    expect(view.records[AGENT_KEYS.context]).toMatch(/^# bot\.gamebox\.eth\n/);
  });

  it('deploys its account first, and starts nothing else while that is pending', async () => {
    const { agent, signer, posts } = setup();
    expect(await step(agent)).toEqual({ step: 'deploy', id: 'id-1' });
    expect(posts).toEqual([{ path: '/account/deploy', body: { qx: signer.qx, qy: signer.qy } }]);
    expect(await step(agent)).toMatchObject({ step: 'pending', id: 'id-1', tx: { status: 'sent' } });
    expect(posts).toHaveLength(1);
  });

  it('claims bot.gamebox.eth with a raw signature its account checks with ERC-1271', async () => {
    const { agent, signer, state, posts } = setup();
    state.deployed = true;
    expect(await step(agent)).toEqual({ step: 'claim', id: 'id-1' });
    const body = posts[0]!.body as unknown as ClaimRequest;
    expect(posts[0]!.path).toBe('/names/claim');
    expect(body).toMatchObject({ label: 'bot', badge: ACCOUNT, deadline: String(NOW + 600) });
    const digest = claimNameDigest({ label: 'bot', badge: ACCOUNT, deadline: BigInt(NOW + 600) }, NAMES);
    // `P256Account.isValidSignature` takes the raw form only: 64 bytes over the digest itself.
    expect((body.signature.length - 2) / 2).toBe(64);
    expect(accountSignatureProblem(digest, body.signature, signer.qx, signer.qy)).toBeNull();
  });

  it('writes both records in one signed batch once it holds its name', async () => {
    const { agent, signer, state, posts } = setup();
    Object.assign(state, { deployed: true, name: 'bot.gamebox.eth' });
    expect(await step(agent)).toEqual({ step: 'records', id: 'id-1' });
    expect(posts[0]!.path).toBe('/account/execute');
    const body = posts[0]!.body as unknown as ExecuteRequest;
    expect(body.account).toBe(ACCOUNT);
    expect(Object.fromEntries(setTexts(body))).toEqual(await agent.records());
    const calls = body.calls!.map((call) => ({ ...call, value: BigInt(call.value) }));
    const digest = executeBatchDigest({ calls, nonce: BigInt(body.nonce), deadline: BigInt(body.deadline) }, ACCOUNT);
    expect(accountSignatureProblem(digest, body.signature, signer.qx, signer.qy)).toBeNull();
  });

  it('writes only the records that differ, and is done when none do', async () => {
    const { agent, signer, state, posts } = setup();
    Object.assign(state, { deployed: true, name: 'bot.gamebox.eth', txStatus: 'done' });
    state.records.set(AGENT_KEYS.context, agent.records()[AGENT_KEYS.context]!);
    await step(agent);
    const body = posts[0]!.body as unknown as ExecuteRequest;
    expect(setTexts(body)).toEqual([[agentEndpointKey('mcp'), MCP_URL]]);
    const digest = executeDigest(
      { ...body.call!, value: 0n, nonce: BigInt(body.nonce), deadline: BigInt(body.deadline) },
      ACCOUNT,
    );
    expect(accountSignatureProblem(digest, body.signature, signer.qx, signer.qy)).toBeNull();

    state.records.set(agentEndpointKey('mcp'), MCP_URL);
    expect(await agent.setup()).toEqual({ status: 200, body: { step: 'done' } });
    expect((await agent.view()).next).toBe('done');
    expect(posts).toHaveLength(1);
  });

  it("passes the relayer's refusal on, and holds nothing pending", async () => {
    const { agent, posts, setReply } = setup();
    setReply({ status: 429, body: { error: 'rate limit: 3 account deploys per hour from one address' } });
    expect((await agent.setup()).status).toBe(429);
    setReply({ status: 202, body: { id: 'next' } });
    expect(await step(agent)).toEqual({ step: 'deploy', id: 'next' });
    expect(posts).toHaveLength(2);
  });

  it('refuses to go on if its account holds another name', async () => {
    const { agent, state } = setup();
    Object.assign(state, { deployed: true, name: 'alice.gamebox.eth' });
    await expect(agent.setup()).rejects.toThrow(/holds alice.gamebox.eth/);
  });
});
