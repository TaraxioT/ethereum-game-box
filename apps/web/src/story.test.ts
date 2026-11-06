// The Story's step machine: Next, Back, Reset, and a step whose write fails.
import { describe, expect, it, vi } from "vitest";

import { type Step, Story, type StoryView } from "./story.ts";

function steps(failAt?: string) {
  const log: string[] = [];
  const make = (id: string, writes: boolean): Step => ({
    id,
    title: id,
    brief: "",
    caption: "",
    show: () => void log.push(`show ${id}`),
    act: writes
      ? async () => {
          log.push(`write ${id}`);
          if (id === failAt) throw new Error(`${id} reverted: LabelAlreadyRegistered`);
        }
      : undefined,
  });
  return { log, list: [make("tree", false), make("claim", true), make("scoped", true), make("agent", false)] };
}

function story(failAt?: string) {
  const { log, list } = steps(failAt);
  const views: StoryView[] = [];
  const reset = vi.fn();
  const s = new Story(list, (view) => views.push(view), reset);
  return { s, log, views, reset };
}

describe("the Story", () => {
  it("starts on the first step without writing", () => {
    const { s, log } = story();
    expect(s.current).toEqual({ index: 0, state: "idle", error: null });
    expect(log).toEqual([]);
    expect(s.canBack).toBe(false);
  });

  it("Next shows each step and runs its writes", async () => {
    const { s, log, views } = story();
    await s.next();
    expect(s.current).toEqual({ index: 1, state: "done", error: null });
    expect(views.map((v) => v.state)).toEqual(["running", "done"]);
    await s.next();
    await s.next();
    expect(log).toEqual(["show claim", "write claim", "show scoped", "write scoped", "show agent"]);
    expect(s.canNext).toBe(false);
    await s.next();
    expect(s.current.index).toBe(3);
  });

  it("Back shows the step before without writing again", async () => {
    const { s, log } = story();
    await s.next();
    await s.next();
    log.length = 0;
    await s.back();
    expect(s.current).toEqual({ index: 1, state: "done", error: null });
    expect(log).toEqual(["show claim"]);
  });

  it("Reset goes back to the first step and clears only the walkthrough", async () => {
    const { s, log, reset } = story();
    await s.next();
    await s.next();
    log.length = 0;
    await s.reset();
    expect(reset).toHaveBeenCalledOnce();
    expect(s.current).toEqual({ index: 0, state: "done", error: null });
    expect(log).toEqual(["show tree"]);
  });

  it("a failed write stops on its step with the error, and Retry runs it again", async () => {
    const { s, log } = story("scoped");
    await s.next();
    await s.next();
    expect(s.current).toEqual({ index: 2, state: "failed", error: "scoped reverted: LabelAlreadyRegistered" });
    expect(s.canNext).toBe(true);
    log.length = 0;
    await s.retry();
    expect(log).toEqual(["show scoped", "write scoped"]);
    expect(s.current.state).toBe("failed");
  });

  it("ignores a write that a later move overtook", async () => {
    let release: () => void = () => {};
    const slow: Step = { id: "slow", title: "", brief: "", caption: "", show: () => {}, act: () => new Promise<void>((r) => (release = r)) };
    const s = new Story([steps().list[0]!, slow, steps().list[3]!], () => {});
    const running = s.next();
    expect(s.current.state).toBe("running");
    await s.back();
    release();
    await running;
    expect(s.current).toEqual({ index: 0, state: "done", error: null });
  });
});
