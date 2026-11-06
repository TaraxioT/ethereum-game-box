import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileAtomic } from "./files.ts";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "egb-files-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("writeFileAtomic", () => {
  it("writes a new file, folders and all, and replaces an old one whole", async () => {
    const file = join(dir, "a", "b", "rounds.json");
    await writeFileAtomic(file, "one");
    expect(await readFile(file, "utf8")).toBe("one");
    await writeFileAtomic(file, "two");
    expect(await readFile(file, "utf8")).toBe("two");
    expect(await readdir(join(dir, "a", "b"))).toEqual(["rounds.json"]);
  });

  it("leaves the old file and no temp file when the write can't land", async () => {
    const file = join(dir, "taken");
    await writeFileAtomic(join(file, "inner"), "x");
    await expect(writeFileAtomic(file, "over a folder")).rejects.toThrow();
    expect(await readdir(dir)).toEqual(["taken"]);
  });
});
