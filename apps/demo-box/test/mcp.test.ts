import { describe, expect, it } from 'vitest';

import { MCP_PROTOCOL_VERSION, handleMcp } from '../src/mcp.ts';

const tools = { agent: async () => ({ name: 'bot.gamebox.eth' }), box: async () => ({ label: 'mumbai-01' }) };

async function rpc(body: unknown, method = 'POST') {
  const request = new Request('https://demo-box.test/mcp', {
    method,
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  const response = await handleMcp(request, tools, {});
  return { status: response.status, body: response.status === 200 ? ((await response.json()) as Record<string, unknown>) : null };
}

describe('the MCP endpoint', () => {
  it('initializes, and takes the initialized notification with a bare 202', async () => {
    const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION } });
    expect(init.body).toMatchObject({
      id: 1,
      result: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'bot.gamebox.eth' } },
    });
    expect(await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).toEqual({ status: 202, body: null });
  });

  it('lists the agent and box tools, and calls them', async () => {
    const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect((list.body!.result as { tools: { name: string }[] }).tools.map((tool) => tool.name)).toEqual(['agent', 'box']);
    const call = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'agent', arguments: {} } });
    expect(call.body).toMatchObject({ result: { structuredContent: { name: 'bot.gamebox.eth' } } });
    const text = (call.body!.result as { content: { text: string }[] }).content[0]!.text;
    expect(JSON.parse(text)).toEqual({ name: 'bot.gamebox.eth' });
  });

  it('answers errors the JSON-RPC way', async () => {
    expect((await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } })).body).toMatchObject({
      error: { code: -32602 },
    });
    expect((await rpc({ jsonrpc: '2.0', id: 5, method: 'resources/list' })).body).toMatchObject({ error: { code: -32601 } });
    expect((await rpc({ id: 6, method: 'ping' })).body).toMatchObject({ error: { code: -32600 } });
    expect((await rpc(undefined, 'GET')).status).toBe(405);
  });
});
