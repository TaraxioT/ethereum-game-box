import { describe, expect, it } from "vitest";

import { RunFailure } from "../src/failure.ts";
import { readCalls } from "../src/tools.ts";
import { toolCall } from "./fake-model.ts";

const verdict = (args: unknown): object => toolCall("submit_verdict", args);

describe("readCalls", () => {
  it("reads a shell call", () => {
    const [action] = readCalls([toolCall("shell", { command: "ls" })]);
    expect(action).toMatchObject({ tool: "shell", command: "ls" });
  });

  it("reads a split, keeping only the verdict's own fields", () => {
    const [action] = readCalls([verdict({ kind: "split", payouts: ["10", "0"], why: "A won", extra: 1 })]);
    expect(action).toMatchObject({ tool: "submit_verdict" });
    expect(action?.tool === "submit_verdict" && action.verdict).toEqual({
      kind: "split",
      payouts: ["10", "0"],
      why: "A won",
    });
  });

  it("reads cannot_judge, ignoring payouts sent with it", () => {
    const [action] = readCalls([verdict({ kind: "cannot_judge", payouts: [], why: "no log" })]);
    expect(action?.tool === "submit_verdict" && action.verdict).toEqual({ kind: "cannot_judge", why: "no log" });
  });

  it("reads several shell calls from one reply", () => {
    expect(readCalls([toolCall("shell", { command: "a" }), toolCall("shell", { command: "b" })])).toHaveLength(2);
  });

  it.each([
    ["no call at all", []],
    ["a call that isn't an object", ["shell"]],
    ["a null call", [null]],
    ["no id", [{ type: "function", function: { name: "shell", arguments: "{}" } }]],
    ["the wrong type", [{ id: "1", type: "code", function: { name: "shell", arguments: "{}" } }]],
    ["no function", [{ id: "1", type: "function" }]],
    ["arguments that aren't text", [{ id: "1", type: "function", function: { name: "shell", arguments: {} } }]],
    ["arguments that aren't JSON", [toolCall("shell", "{not json")]],
    ["arguments that aren't an object", [toolCall("shell", "null")]],
    ["an unknown tool", [toolCall("python", { code: "1" })]],
    ["a shell call with no command", [toolCall("shell", {})]],
    ["a blank command", [toolCall("shell", { command: "  " })]],
    ["a command that isn't text", [toolCall("shell", { command: ["ls"] })]],
    ["a verdict of an unknown kind", [verdict({ kind: "win", why: "x" })]],
    ["a verdict with no reason", [verdict({ kind: "cannot_judge" })]],
    ["a blank reason", [verdict({ kind: "cannot_judge", why: " " })]],
    ["a split with no payouts", [verdict({ kind: "split", why: "x" })]],
    ["a split with empty payouts", [verdict({ kind: "split", payouts: [], why: "x" })]],
    ["payouts as numbers", [verdict({ kind: "split", payouts: [10, 0], why: "x" })]],
    ["a negative payout", [verdict({ kind: "split", payouts: ["-1", "2"], why: "x" })]],
    ["a fractional payout", [verdict({ kind: "split", payouts: ["1.5", "2"], why: "x" })]],
    ["a hex payout", [verdict({ kind: "split", payouts: ["0x10", "2"], why: "x" })]],
    ["a padded payout", [verdict({ kind: "split", payouts: ["010", "2"], why: "x" })]],
    ["an empty payout", [verdict({ kind: "split", payouts: ["", "2"], why: "x" })]],
    [
      "a verdict beside a shell call",
      [toolCall("shell", { command: "ls" }), verdict({ kind: "cannot_judge", why: "x" })],
    ],
    [
      "two verdicts",
      [verdict({ kind: "cannot_judge", why: "x" }), verdict({ kind: "cannot_judge", why: "y" })],
    ],
  ])("refuses %s", (_name, input) => {
    expect(() => readCalls(input)).toThrow(RunFailure);
  });
});
