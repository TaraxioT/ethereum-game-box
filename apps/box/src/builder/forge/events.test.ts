import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatBuild } from "./build.ts";
import { createEventMapper, resultError, toolPath, type SdkLikeMessage } from "./events.ts";
import { MAX_ERROR_LINES } from "./limits.ts";
import type { ForgeEventBody } from "./provider.ts";
import { loadRecording } from "./sim.ts";

const ROOT = "/box/data/forge/work/job-1";

function errorsFixture(): SdkLikeMessage[] {
  return readFileSync(new URL("./fixtures/claude-errors.jsonl", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l.split("/GAME").join(ROOT)) as SdkLikeMessage);
}

function mapAll(messages: readonly SdkLikeMessage[]): ForgeEventBody[] {
  const mapper = createEventMapper(ROOT);
  return messages.flatMap((m) => mapper.map(m));
}

describe("SDK messages to ForgeEvents", () => {
  it("a recorded run: every tool step has a name and a path, and pairs with its result", () => {
    const events = mapAll(loadRecording(ROOT, "lantern-race-k2x9").map((e) => e.msg));
    const tools = events.filter((e) => e.type === "tool");
    const done = events.filter((e) => e.type === "tool_done");
    expect(done.map((e) => e.id)).toEqual(tools.map((e) => e.id));
    expect(tools.map((e) => [e.name, e.path])).toEqual([
      ["Read", ".reference/README.md"],
      ["Read", ".reference/template/BLUEPRINT.md"],
      ["Read", ".reference/sdk/rules.ts"],
      ["Read", ".reference/sdk/frame.ts"],
      ["Read", ".reference/parts.md"],
      ["Glob", "*"],
      ["Read", "rules.ts"],
      ["Write", "rules.ts"],
      ["Write", "screen.ts"],
      ["Write", "game.json"],
      ["Write", "icon.svg"],
      ["Write", "BLUEPRINT.md"],
      ["build_game", null],
    ]);
    expect(done.every((e) => e.ok)).toBe(true);
    const says = events.filter((e) => e.type === "say").map((e) => e.text);
    expect(says).toHaveLength(3);
    expect(says.at(-1)).toMatch(/^Lantern Race: tap your badge/);
    // The system message, the result and everything else map to nothing: statuses and results are the runner's.
    expect(new Set(events.map((e) => e.type))).toEqual(new Set(["say", "tool", "tool_done"]));
  });

  it("an error run: a failed build, a denied tool, a subagent's noise, a rate-limit event, no thinking", () => {
    const events = mapAll(errorsFixture());
    expect(events.map((e) => e.type)).toEqual(["say", "tool", "tool_done", "tool", "tool_done", "tool", "tool_done"]);
    expect(events[0]).toEqual({ type: "say", text: "Let me build it." });
    expect(events[1]).toEqual({ type: "tool", id: "toolu_e1", name: "build_game", path: null });
    expect(events[2]).toEqual({ type: "tool_done", id: "toolu_e1", ok: false });
    expect(events[3]).toEqual({ type: "tool", id: "toolu_e2", name: "Bash", path: null });
    expect(events[4]).toEqual({ type: "tool_done", id: "toolu_e2", ok: false });
    // A path outside the folder shows as its base name, never the whole path.
    expect(events[5]).toEqual({ type: "tool", id: "toolu_e4", name: "Read", path: "passwd" });
    const result = errorsFixture().at(-1)!;
    expect(resultError(result)).toBe("The agent ran out of turns before finishing.");
  });

  it("result errors in words", () => {
    expect(resultError({ type: "result", subtype: "error_max_budget_usd" })).toMatch(/spending limit/);
    expect(resultError({ type: "result", subtype: "error_during_execution", errors: ["API Error: 529 overloaded"] })).toBe("API Error: 529 overloaded");
    expect(resultError({ type: "result", subtype: "success", is_error: true, result: "" })).toBe("The agent stopped with an error.");
  });

  it("tool paths", () => {
    expect(toolPath(ROOT, "Edit", { file_path: `${ROOT}/parts/board.ts` })).toBe("parts/board.ts");
    expect(toolPath(ROOT, "Write", { file_path: "screen.ts" })).toBe("screen.ts");
    expect(toolPath(ROOT, "Grep", { pattern: "x", path: ".reference" })).toBe(".reference");
    expect(toolPath(ROOT, "Grep", { pattern: "x", glob: "*.ts" })).toBe("*.ts");
    expect(toolPath(ROOT, "Grep", { pattern: "x" })).toBeNull();
    expect(toolPath(ROOT, "mcp__forge__build_game", {})).toBeNull();
  });

  it("build_game's answer: OK with the size, or the first errors", () => {
    expect(formatBuild({ ok: true, errors: [], iconErrors: [], bytes: 42_000, ms: 1200 })).toMatch(/^Build OK · 41\.0 KB \(1\.2 s\)\nIcon OK\./);
    expect(formatBuild({ ok: true, errors: [], iconErrors: ["icon.svg: no <script>"], bytes: 1, ms: 1 })).toMatch(/The icon needs fixing[\s\S]*no <script>/);
    const errors = Array.from({ length: 50 }, (_, i) => `rules.ts:${i + 1}:1 nope`);
    const lines = formatBuild({ ok: false, errors, iconErrors: [], bytes: 0, ms: 10 }).split("\n");
    expect(lines[0]).toBe("Build failed · 50 errors");
    expect(lines.filter((l) => l.includes("nope"))).toHaveLength(MAX_ERROR_LINES);
    expect(lines).toContain("… and 20 more lines");
  });
});
