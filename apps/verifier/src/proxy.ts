// The only way a model call leaves the container. The container's request is untrusted: the proxy keeps the fields a
// chat needs, adds the key, the model and 0G's private mode itself, and records the turn. A reply the `TeeCheck` can't
// prove never reaches the agent.

import type { AgentTurn } from '@egb/shared/store';

import { type Failure, failed } from './failure.ts';
import { isRecord, parsed, utf8Bytes } from './json.ts';
import { LIMITS } from './limits.ts';
import type { Scrub } from './safe.ts';
import type { TeeCheck } from './tee.ts';

export interface ProxyOptions {
  /** 0G's Router, up to `/v1`. */
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly tee: TeeCheck;
  /** Call it unbound: the Workers `fetch` throws "Illegal invocation" as a method of anything else. */
  readonly fetch: typeof fetch;
  readonly scrub: Scrub;
}

export type TurnResult =
  | { readonly ok: true; readonly turn: AgentTurn; readonly reply: string }
  | { readonly ok: false; readonly turn: AgentTurn | null; readonly failure: Failure };

/** What goes to 0G: the fields a chat needs from `text`, or null if it isn't a chat. `model`, `verify_tee` and the
 *  token cap are ours, whatever the container sent. */
function chatBody(text: string, model: string): Record<string, unknown> | null {
  const request = parsed(text);
  if (!isRecord(request) || !Array.isArray(request.messages)) return null;
  const { messages, tools, tool_choice, chat_template_kwargs, max_tokens } = request;
  const tokens = typeof max_tokens === 'number' ? Math.min(max_tokens, LIMITS.replyTokens) : LIMITS.replyTokens;
  return { model, messages, tools, tool_choice, chat_template_kwargs, max_tokens: tokens, verify_tee: true };
}

/** Sends one turn to 0G and proves its reply. Never throws: whatever goes wrong comes back as a `Failure`. */
export async function proxyTurn(options: ProxyOptions, text: string): Promise<TurnResult> {
  if (utf8Bytes(text) > LIMITS.turnBytes) return { ok: false, turn: null, failure: failed('container', 'a model call is too large') };
  const body = chatBody(text, options.model);
  if (!body) return { ok: false, turn: null, failure: failed('container', 'a model call is not a chat') };

  const unproven = (chatId: string | null, response: unknown): AgentTurn => ({
    chatId,
    model: options.model,
    teeVerified: false,
    request: body,
    response,
  });

  const { fetch: send } = options;
  let response: Response;
  let replyText: string;
  try {
    response = await send(`${options.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
        'x-0g-provider-trust-mode': 'private',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(LIMITS.modelMs),
    });
    replyText = await response.text();
  } catch (error) {
    console.error(`0G can't be reached: ${options.scrub(error)}`);
    return { ok: false, turn: unproven(null, null), failure: failed('zg', "0G can't be reached") };
  }

  const chatId = response.headers.get('zg-res-key');
  const reply = parsed(replyText);
  if (!response.ok) {
    return { ok: false, turn: unproven(chatId, { status: response.status }), failure: failed('zg', `0G answered ${response.status}`) };
  }
  if (utf8Bytes(replyText) > LIMITS.turnBytes) {
    return { ok: false, turn: unproven(chatId, null), failure: failed('zg', "0G's reply is too large") };
  }
  if (reply === undefined) return { ok: false, turn: unproven(chatId, null), failure: failed('zg', "0G's reply isn't JSON") };

  let checked;
  try {
    checked = await options.tee.check({ headers: response.headers, body: reply });
  } catch (error) {
    console.error(`the TEE check failed: ${options.scrub(error)}`);
    checked = { problem: 'the TEE check could not run' };
  }
  if ('problem' in checked) {
    return { ok: false, turn: unproven(chatId, { reply, problem: checked.problem }), failure: failed('tee', checked.problem) };
  }
  const turn: AgentTurn = {
    chatId: checked.proof.chatId,
    model: options.model,
    teeVerified: true,
    request: body,
    response: { reply, proof: checked.proof },
  };
  return { ok: true, turn, reply: replyText };
}
