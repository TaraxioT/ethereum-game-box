// A fake of the Worker's proxy: an OpenAI-format server that plays a script, one step per request, and keeps what it
// was sent. No dependencies, so the Docker check can run it in a plain Node container.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface SeenRequest {
  readonly headers: Record<string, string | string[] | undefined>;
  // Decoded JSON from the code under test.
  readonly body: {
    readonly messages: readonly { role: string; content: string | null; tool_call_id?: string }[];
    readonly [key: string]: unknown;
  };
}

/** What the fake does with one request. */
export type Step =
  /** Answers with this exact status and body. */
  | { readonly status: number; readonly text: string }
  /** Cuts the connection without answering, as a dying server does. */
  | { readonly die: true }
  /** Never answers. */
  | { readonly hang: true };

export type Script = (turn: number, request: SeenRequest) => Step;

export interface FakeModel {
  readonly url: string;
  readonly requests: readonly SeenRequest[];
  close(): Promise<void>;
}

export const reply = (message: object, usage?: object): Step => ({
  status: 200,
  text: JSON.stringify({ id: "chat-1", choices: [{ index: 0, message }], ...(usage ? { usage } : {}) }),
});

export const toolCall = (name: string, args: unknown, id = `call-${name}`): object => ({
  id,
  type: "function",
  function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});

/** A reply making these tool calls. */
export const calls = (...toolCalls: readonly object[]): Step =>
  reply({ role: "assistant", content: null, tool_calls: toolCalls });

export const shellCall = (command: string): Step => calls(toolCall("shell", { command }));

export const verdictCall = (verdict: object): Step => calls(toolCall("submit_verdict", verdict));

/** A script of these steps, which then repeats its last step. */
export const steps =
  (...list: readonly Step[]): Script =>
  (turn) => {
    const step = list[Math.min(turn, list.length - 1)];
    if (!step) throw new Error("an empty script");
    return step;
  };

export function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve) => {
    server.listen(port, "0.0.0.0", () => resolve((server.address() as AddressInfo).port));
  });
}

/** A fake on `port`, or on a free one. It answers any path, as the script says. */
export async function startFakeModel(script: Script, port = 0): Promise<FakeModel> {
  const requests: SeenRequest[] = [];
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += String(chunk);
    const request: SeenRequest = { headers: req.headers, body: JSON.parse(text) as SeenRequest["body"] };
    requests.push(request);
    const step = script(requests.length - 1, request);
    if ("die" in step) req.socket.destroy();
    else if (!("hang" in step)) res.writeHead(step.status, { "content-type": "application/json" }).end(step.text);
  });
  const bound = await listen(server, port);
  return {
    url: `http://127.0.0.1:${bound}/v1/chat/completions`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
