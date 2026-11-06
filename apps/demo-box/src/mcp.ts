// The agent's MCP endpoint (`agent-endpoint[mcp]`): MCP's Streamable HTTP transport, stateless, JSON replies only.
// It lists two read-only tools: `agent` (the agent's name, account and records) and `box` (the demo Box's state).

export const MCP_PROTOCOL_VERSION = '2025-06-18';

export interface McpTools {
  agent(): Promise<unknown>;
  box(): Promise<unknown>;
}

const TOOLS = [
  {
    name: 'agent',
    description: "bot.gamebox.eth, the Game Box's practice opponent: its account, public key and ENSIP-26 records.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'box',
    description: 'The demo Box it plays at: its name, account, public key and last heartbeat.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

const result = (id: unknown, value: unknown) => ({ jsonrpc: '2.0', id, result: value });
const failure = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** The answer to one JSON-RPC message, or `null` for a notification (which gets a bare 202). */
export async function answerMcp(message: unknown, tools: McpTools): Promise<object | null> {
  const { jsonrpc, id, method, params } = (typeof message === 'object' && message !== null ? message : {}) as JsonRpcRequest;
  if (jsonrpc !== '2.0' || typeof method !== 'string') return failure(id, -32600, 'invalid request');
  if (id === undefined) return null;
  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'bot.gamebox.eth', version: '1.0.0' },
      });
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, { tools: TOOLS });
    case 'tools/call': {
      const name = (params as { name?: unknown } | undefined)?.name;
      if (name !== 'agent' && name !== 'box') return failure(id, -32602, `unknown tool ${String(name)}`);
      const value = await tools[name]();
      return result(id, { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value });
    }
    default:
      return failure(id, -32601, `method not found: ${method}`);
  }
}

/** `POST /mcp`: one JSON-RPC message (this protocol version has no batches). */
export async function handleMcp(request: Request, tools: McpTools, headers: Record<string, string>): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...headers, allow: 'POST' } });
  const body: unknown = await request.json().catch(() => undefined);
  if (body === undefined) return Response.json(failure(null, -32700, 'parse error'), { status: 400, headers });
  const answer = await answerMcp(body, tools);
  return answer ? Response.json(answer, { headers }) : new Response(null, { status: 202, headers });
}
