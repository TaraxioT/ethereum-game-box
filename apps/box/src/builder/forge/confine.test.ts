import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentOptions } from "./claude.ts";
import { BUILD_TOOL, checkToolUse, DENIED_TOOLS, FILE_TOOLS, isInside, realish } from "./confine.ts";
import type { RunContext } from "./provider.ts";
import { tempDir } from "./test-helpers.ts";

function folder() {
  const base = tempDir("egb-confine-");
  const root = path.join(base, "game");
  for (const d of ["parts", ".reference/sdk", "dist", "node_modules/x", ".claude"]) mkdirSync(path.join(root, d), { recursive: true });
  writeFileSync(path.join(root, "rules.ts"), "export default {};");
  writeFileSync(path.join(root, ".reference/sdk/rules.ts"), "// sdk");
  writeFileSync(path.join(root, "dist/rules.js"), "// built");
  writeFileSync(path.join(base, "secret.txt"), "nope");
  return { base, root };
}

const allowed = (root: string, tool: string, input: Record<string, unknown>) => checkToolUse(root, tool, input).ok;

describe("reads", () => {
  it("go anywhere in the folder, .reference included, by absolute or relative path", () => {
    const { root } = folder();
    expect(allowed(root, "Read", { file_path: path.join(root, "rules.ts") })).toBe(true);
    expect(allowed(root, "Read", { file_path: "rules.ts" })).toBe(true);
    expect(allowed(root, "Read", { file_path: "parts/not-yet.ts" })).toBe(true);
    expect(allowed(root, "Read", { file_path: path.join(root, ".reference/sdk/rules.ts") })).toBe(true);
    expect(allowed(root, "Read", { file_path: ".claude/settings.json" })).toBe(true);
  });

  it("never reach build output", () => {
    const { root } = folder();
    for (const p of ["dist/rules.js", path.join(root, "dist/rules.js"), "node_modules/x/index.js", "dist"]) {
      expect(allowed(root, "Read", { file_path: p }), p).toBe(false);
    }
  });

  it("never leave the folder: absolute paths, .., ~ and siblings with a shared prefix", () => {
    const { base, root } = folder();
    mkdirSync(`${root}-evil`);
    writeFileSync(`${root}-evil/x.ts`, "");
    for (const p of [path.join(base, "secret.txt"), "../secret.txt", "/etc/passwd", "parts/../../secret.txt", `${root}-evil/x.ts`]) {
      expect(allowed(root, "Read", { file_path: p }), p).toBe(false);
    }
    expect(allowed(root, "Read", {})).toBe(false);
    expect(allowed(root, "Read", { file_path: 42 })).toBe(false);
  });

  it("judge a symlink by its target, existing or not", () => {
    const { base, root } = folder();
    symlinkSync(path.join(base, "secret.txt"), path.join(root, "link.txt"));
    symlinkSync(base, path.join(root, "up"));
    expect(allowed(root, "Read", { file_path: "link.txt" })).toBe(false);
    expect(allowed(root, "Read", { file_path: "up/secret.txt" })).toBe(false);
    expect(allowed(root, "Write", { file_path: "up/new.ts", content: "" })).toBe(false);
    expect(allowed(root, "Write", { file_path: "up/deeper/new.ts", content: "" })).toBe(false);
    expect(realish(path.join(root, "up/deeper/new.ts"))).toBe(path.join(base, "deeper/new.ts"));
  });
});

describe("writes", () => {
  it("go to the game's own files, new folders included", () => {
    const { root } = folder();
    expect(allowed(root, "Write", { file_path: path.join(root, "parts/board.ts") })).toBe(true);
    expect(allowed(root, "Write", { file_path: "deep/new/file.ts" })).toBe(true);
    expect(allowed(root, "Edit", { file_path: "game.json" })).toBe(true);
  });

  it("never touch .reference, dist, node_modules or .claude, the folder itself, or anything outside", () => {
    const { base, root } = folder();
    for (const p of [".reference/sdk/rules.ts", ".reference/new.md", "dist/rules.js", "node_modules/x/i.js", ".claude/settings.json", ".", root, path.join(base, "evil.ts"), "../evil.ts"]) {
      expect(allowed(root, "Edit", { file_path: p }), `Edit ${p}`).toBe(false);
      expect(allowed(root, "Write", { file_path: p, content: "" }), `Write ${p}`).toBe(false);
    }
    expect(checkToolUse(root, "Write", { file_path: ".reference/x" })).toEqual({ ok: false, reason: ".reference/ is read-only: the Box manages it." });
    expect(allowed(root, "Write", {})).toBe(false);
  });
});

describe("globs and greps", () => {
  it("stay inside", () => {
    const { base, root } = folder();
    expect(allowed(root, "Glob", { pattern: "**/*.ts" })).toBe(true);
    expect(allowed(root, "Glob", { pattern: "*.ts", path: ".reference" })).toBe(true);
    expect(allowed(root, "Glob", { pattern: `${root}/**/*.ts` })).toBe(true);
    expect(allowed(root, "Grep", { pattern: "mount" })).toBe(true);
    expect(allowed(root, "Grep", { pattern: "x", path: "parts", glob: "*.ts" })).toBe(true);
    for (const input of [
      { pattern: "../**/*" },
      { pattern: "parts/../../**" },
      { pattern: "/Users/**/*.env" },
      { pattern: `${base}/*` },
      { pattern: "~/.ssh/*" },
      { pattern: "*", path: base },
      { pattern: "*", path: "/" },
      { pattern: "dist/**" },
      { pattern: `${root}/dist/*.js` },
      { pattern: "*", path: "node_modules" },
      { pattern: 7 },
    ]) {
      expect(allowed(root, "Glob", input), JSON.stringify(input)).toBe(false);
    }
    for (const input of [{ pattern: "key", path: "/" }, { pattern: "key", glob: "../../**" }, { pattern: "key", glob: "~/*" }, { pattern: "key", path: "dist" }]) {
      expect(allowed(root, "Grep", input), JSON.stringify(input)).toBe(false);
    }
  });
});

describe("tools", () => {
  it("allow build_game and deny everything not listed", () => {
    const { root } = folder();
    expect(allowed(root, BUILD_TOOL, {})).toBe(true);
    for (const t of [...DENIED_TOOLS, "mcp__other__build_game", "mcp__forge__other", "build_game", "Unknown"]) {
      expect(allowed(root, t, { file_path: "rules.ts" }), t).toBe(false);
    }
  });

  it("isInside takes the root itself and nothing beside it", () => {
    const { base, root } = folder();
    expect(isInside(root, root)).toBe(true);
    expect(isInside(root, `${root}-evil/x`)).toBe(false);
    expect(isInside(root, base)).toBe(false);
  });
});

describe("the agent's options", () => {
  it("give five file tools and build_game, no settings, and confine through the hook and canUseTool", async () => {
    const { base, root } = folder();
    const ctx: RunContext = {
      workDir: root, gameId: "g", prompt: "p", resume: null, model: "claude-sonnet-5-5", maxTurns: 40, signal: new AbortController().signal,
      emit: () => {}, build: async () => ({ ok: true, errors: [], iconErrors: [], bytes: 0, ms: 0 }),
    };
    const o = await agentOptions(ctx, "GUIDE", { PATH: "/bin", HOME: "/home/pi", RELAYER_KEY: "secret", CLAUDECODE: "1" }, new AbortController());
    expect(o.tools).toEqual([...FILE_TOOLS]);
    expect(o.allowedTools).toBeUndefined();
    expect(o.disallowedTools).toEqual(expect.arrayContaining(["Bash", "WebFetch", "WebSearch", "Task", "Agent"]));
    expect(o.settingSources).toEqual([]);
    expect(o.cwd).toBe(root);
    expect(o.permissionMode).toBe("default");
    expect(o.maxTurns).toBe(40);
    expect(o.model).toBe("claude-sonnet-5-5");
    expect(o.strictMcpConfig).toBe(true);
    expect(Object.keys(o.mcpServers ?? {})).toEqual(["forge"]);
    expect(o.systemPrompt).toEqual({ type: "preset", preset: "claude_code", append: "GUIDE" });
    expect(o.env).toMatchObject({ PATH: "/bin", HOME: "/home/pi", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" });
    expect(o.env?.RELAYER_KEY).toBeUndefined();
    expect(o.env?.CLAUDECODE).toBeUndefined();
    expect(o.resume).toBeUndefined();

    const hook = o.hooks?.PreToolUse?.[0]?.hooks[0];
    if (!hook) throw new Error("no PreToolUse hook");
    const call = (tool_name: string, tool_input: unknown) =>
      hook({ hook_event_name: "PreToolUse", tool_name, tool_input, tool_use_id: "t", session_id: "s", transcript_path: "", cwd: root } as never, "t", { signal: new AbortController().signal });
    expect(await call("Read", { file_path: path.join(root, "rules.ts") })).toEqual({});
    expect(await call(BUILD_TOOL, {})).toEqual({});
    for (const [tool, input] of [["Read", { file_path: path.join(base, "secret.txt") }], ["Bash", { command: "ls" }], ["Write", { file_path: ".reference/x" }]] as const) {
      expect(await call(tool, input)).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
    }

    const can = o.canUseTool;
    if (!can) throw new Error("no canUseTool");
    const opts = { signal: new AbortController().signal, toolUseID: "t", requestId: "r" } as unknown as Parameters<typeof can>[2];
    expect(await can("Write", { file_path: path.join(root, "parts/x.ts"), content: "" }, opts)).toMatchObject({ behavior: "allow" });
    expect(await can(BUILD_TOOL, {}, opts)).toMatchObject({ behavior: "allow" });
    expect(await can("Write", { file_path: path.join(root, ".reference/sdk/rules.ts"), content: "" }, opts)).toMatchObject({ behavior: "deny" });
    expect(await can("WebFetch", { url: "https://example.com" }, opts)).toMatchObject({ behavior: "deny" });

    const resumed = await agentOptions({ ...ctx, resume: "session-9" }, "GUIDE", {}, new AbortController());
    expect(resumed.resume).toBe("session-9");
  });
});
