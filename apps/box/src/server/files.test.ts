import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileAtomic } from "./files.ts";
import { checkLedger, createLedgerFile } from "./ledger-file.ts";

const NOVA = `0x${"ab".repeat(20)}`;
const KITE = `0x${"cd".repeat(20)}`;

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "egb-files-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("writeFileAtomic", () => {
  it("writes a new file, folders and all, and replaces an old one whole", async () => {
    const file = join(dir, "a", "b", "ledger.json");
    await writeFileAtomic(file, "one");
    expect(await readFile(file, "utf8")).toBe("one");
    await writeFileAtomic(file, "two");
    expect(await readFile(file, "utf8")).toBe("two");
    expect(await readdir(join(dir, "a", "b"))).toEqual(["ledger.json"]);
  });

  it("leaves the old file and no temp file when the write can't land", async () => {
    const file = join(dir, "taken");
    await writeFileAtomic(join(file, "inner"), "x");
    await expect(writeFileAtomic(file, "over a folder")).rejects.toThrow();
    expect(await readdir(dir)).toEqual(["taken"]);
  });
});

describe("the ledger file", () => {
  it("starts empty with no file, and keeps every change across a restart", async () => {
    const file = join(dir, "ledger.json");
    const logs: string[] = [];
    const first = createLedgerFile(file, (text) => logs.push(text));
    expect(first.load()).toEqual({ balances: {}, escrow: {} });
    first.save({ balances: { [NOVA]: 100 }, escrow: {} });
    first.save({ balances: { [NOVA]: 90, [KITE]: 90 }, escrow: { [NOVA]: 10, [KITE]: 10 } });
    await first.flush();
    expect(createLedgerFile(file, () => {}).load()).toEqual({ balances: { [NOVA]: 90, [KITE]: 90 }, escrow: { [NOVA]: 10, [KITE]: 10 } });
    expect(logs).toEqual([]);
  });

  it("moves a file that isn't a ledger aside and starts empty", async () => {
    const file = join(dir, "ledger.json");
    await writeFile(file, "{ half a ledger");
    const logs: string[] = [];
    expect(createLedgerFile(file, (text) => logs.push(text)).load()).toEqual({ balances: {}, escrow: {} });
    expect(logs[0]).toMatch(/isn't a ledger/);
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^ledger\.json\.bad-\d+$/);
  });

  it("checks the shape: whole EGB, real addresses", () => {
    expect(checkLedger({ balances: { [NOVA]: 5 }, escrow: { [KITE]: 5 } })).toEqual({ balances: { [NOVA]: 5 }, escrow: { [KITE]: 5 } });
    expect(checkLedger({ balances: { [NOVA]: -5 }, escrow: {} })).toBeNull();
    expect(checkLedger({ balances: { nova: 5 }, escrow: {} })).toBeNull();
    expect(checkLedger({ balances: {}, escrow: { [NOVA]: 1.5 } })).toBeNull();
    expect(checkLedger({ balances: {}, escrow: 20 })).toBeNull();
    expect(checkLedger([])).toBeNull();
  });
});
