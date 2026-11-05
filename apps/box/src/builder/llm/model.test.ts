import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claudeChildEnv, claudeReady } from "./claude-env.ts";
import { designerSchema, parseDesignerAnswer, type DesignerModelContext } from "./designer.ts";
import { createModelClient, MODEL } from "./model.ts";
import type { QueryFn } from "./sdk.ts";

const schema = { type: "object", properties: { n: { type: "number" } }, required: ["n"] };
const parseN = (v: unknown) => (typeof v === "object" && v !== null && typeof (v as { n?: unknown }).n === "number" ? (v as { n: number }) : null);
const req = { system: "s", prompt: "p", schema, parse: parseN, timeoutMs: 5000 };
/** Linux with a Claude Code login on disk: the SDK path. */
const LOGGED_IN = { platform: "linux" as const, home: "/home/pi", exists: (f: string) => f === "/home/pi/.claude/.credentials.json" };

/** A fake Agent SDK query that yields `messages` and records its options. */
function fakeQuery(messages: unknown[], seen: Options[] = [], onClose?: () => void): QueryFn {
  return ((params: { options: Options }) => {
    seen.push(params.options);
    const gen = (async function* () {
      for (const m of messages) yield m;
    })();
    return Object.assign(gen, { close: () => onClose?.() });
  }) as unknown as QueryFn;
}

const ok = (v: unknown) => ({ type: "result", subtype: "success", is_error: false, structured_output: v });

afterEach(() => {
  vi.useRealTimers();
});

describe("picking the model's path", () => {
  it("the API with a key, the SDK on a Claude login, off without either or with EGB_MODEL=off", () => {
    expect(createModelClient({ ANTHROPIC_API_KEY: "k" }).provider).toBe("api");
    expect(createModelClient({}, LOGGED_IN).provider).toBe("sdk");
    const none = createModelClient({}, { ...LOGGED_IN, exists: () => false });
    expect(none.provider).toBe("off");
    expect(none.reason).toMatch(/run `claude` once/);
    expect(createModelClient({ EGB_MODEL: "off", ANTHROPIC_API_KEY: "k" }).provider).toBe("off");
  });

  it("readiness: env credentials, the Linux credentials file, the macOS keychain", () => {
    expect(claudeReady({ CLAUDE_CODE_OAUTH_TOKEN: "t" }, { platform: "linux", exists: () => false }).ok).toBe(true);
    expect(claudeReady({}, { platform: "darwin", exists: () => false }).ok).toBe(true);
    expect(claudeReady({ CLAUDE_CONFIG_DIR: "/c" }, { platform: "linux", exists: (f) => f === "/c/.credentials.json" }).ok).toBe(true);
  });
});

describe("the SDK path", () => {
  it("one turn, no tools, no settings, no session, structured output, haiku", async () => {
    const seen: Options[] = [];
    const client = createModelClient({}, { ...LOGGED_IN, query: fakeQuery([{ type: "system" }, ok({ n: 7 })], seen) });
    expect(await client.json(req)).toEqual({ n: 7 });
    const o = seen[0]!;
    expect(o.model).toBe(MODEL);
    expect(MODEL).toBe("claude-haiku-5-5");
    expect(o.tools).toEqual([]);
    expect(o.settingSources).toEqual([]);
    expect(o.persistSession).toBe(false);
    expect(o.outputFormat).toEqual({ type: "json_schema", schema });
    expect(o.systemPrompt).toBe("s");
    expect(o.thinking).toEqual({ type: "disabled" });
    expect(o.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
  });

  it("an error result, no output, or an answer that fails validation rejects", async () => {
    const at = (messages: unknown[]) => createModelClient({}, { ...LOGGED_IN, query: fakeQuery(messages) });
    await expect(at([{ type: "result", subtype: "error_max_structured_output_retries", is_error: true }]).json(req)).rejects.toThrow(/error_max_structured_output_retries/);
    await expect(at([{ type: "result", subtype: "success", is_error: false, result: "hi" }]).json(req)).rejects.toThrow(/no structured output/);
    await expect(at([ok({ n: "seven" })]).json(req)).rejects.toThrow(/failed validation/);
  });

  it("rejects at the deadline and closes the Claude Code process", async () => {
    vi.useFakeTimers();
    let closed = 0;
    const stuck = (() =>
      Object.assign(
        (async function* () {
          await new Promise(() => {});
        })(),
        { close: () => closed++ },
      )) as unknown as QueryFn;
    const client = createModelClient({}, { ...LOGGED_IN, query: stuck });
    const call = client.json(req);
    const caught = call.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await caught).toBe("the model timed out after 5000 ms");
    expect(closed).toBe(1);
  });

  it("runs one Claude Code process at a time", async () => {
    const gates: (() => void)[] = [];
    let running = 0;
    let most = 0;
    const gated = (() =>
      Object.assign(
        (async function* () {
          running++;
          most = Math.max(most, running);
          await new Promise<void>((r) => gates.push(r));
          running--;
          yield ok({ n: 1 });
        })(),
        { close: () => {} },
      )) as unknown as QueryFn;
    const client = createModelClient({}, { ...LOGGED_IN, query: gated });
    const calls = [client.json(req), client.json(req)];
    for (let i = 0; i < 2; i++) {
      while (gates.length === 0) await new Promise((r) => setTimeout(r, 1));
      gates.shift()!();
      await calls[i];
    }
    expect(most).toBe(1);
  });

  it("the child sees an allowlist: no Box secrets, nothing from a parent Claude Code session", () => {
    const env = claudeChildEnv({
      RELAYER_PRIVATE_KEY: "0xsecret", ELEVENLABS_API_KEY: "el", ALCHEMY_API_KEY: "a", EGB_DATA: "/d",
      ANTHROPIC_BASE_URL: "b", XDG_CONFIG_HOME: "/c", HOME: "/home/pi", PATH: "/bin",
      CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "x", CLAUDE_CODE_OAUTH_TOKEN: "keep",
    });
    for (const k of ["RELAYER_PRIVATE_KEY", "ELEVENLABS_API_KEY", "ALCHEMY_API_KEY", "EGB_DATA", "CLAUDECODE", "CLAUDE_CODE_SESSION_ID"]) expect(env[k], k).toBeUndefined();
    expect(env).toMatchObject({ ANTHROPIC_BASE_URL: "b", XDG_CONFIG_HOME: "/c", HOME: "/home/pi", PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "keep" });
  });
});

describe("the API path", () => {
  it("forces one tool whose input is the answer; the key only in its header", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "answer", input: { n: 3 } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createModelClient({ ANTHROPIC_API_KEY: "sk-test" }, { fetch: fetchFn });
    expect(await client.json(req)).toEqual({ n: 3 });
    const { url, init } = sent[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-test");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: MODEL, system: "s", messages: [{ role: "user", content: "p" }], tool_choice: { type: "tool", name: "answer" } });
    expect(body.tools[0].input_schema).toEqual(schema);
    expect(init.body).not.toContain("sk-test");
  });

  it("an HTTP error rejects with its status only", async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ error: { type: "overloaded_error", message: "x" } }), { status: 529 })) as unknown as typeof fetch;
    await expect(createModelClient({ ANTHROPIC_API_KEY: "sk-test" }, { fetch: fetchFn }).json(req)).rejects.toThrow(/^the model failed: HTTP 529 overloaded_error$/);
  });
});

describe("the Designer's answer", () => {
  const ctx: DesignerModelContext = {
    step: "theme",
    question: "Where is it set?",
    brief: { template: "quick-draw", mechanic: null, theme: null, twist: null, stakes: null, voice: null, title: null },
    templates: [{ id: "quick-draw", label: "Quick Draw" }],
    keys: ["Wild West"],
  };
  const good = { template: null, mechanic: null, theme: "Space", twist: null, stakes: [5, 10], voice: null, title: null, build: false, change: null };

  it("the schema names every field, nullable, and the shelf's ids", () => {
    const s = designerSchema(ctx) as { required: string[]; properties: Record<string, { anyOf?: { enum?: unknown[] }[] }> };
    expect(Object.keys(s.properties).sort()).toEqual([...s.required].sort());
    expect(s.properties.template!.anyOf![0]!.enum).toEqual(["quick-draw"]);
  });

  it("is validated field by field", () => {
    expect(parseDesignerAnswer(good, ctx)).toEqual(good);
    expect(parseDesignerAnswer({ ...good, template: "b17" }, ctx)).toBeNull();
    expect(parseDesignerAnswer({ ...good, stakes: [5, -1] }, ctx)).toBeNull();
    expect(parseDesignerAnswer({ ...good, build: "yes" }, ctx)).toBeNull();
    expect(parseDesignerAnswer({ ...good, change: "colour" }, ctx)).toBeNull();
    expect(parseDesignerAnswer({ ...good, theme: 4 }, ctx)).toBeNull();
    expect(parseDesignerAnswer([good], ctx)).toBeNull();
  });
});
