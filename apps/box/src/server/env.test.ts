import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { envFiles, loadEnv, loadEnvFile, parseEnv } from "./env.ts";

let dir = "";
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = "";
});

describe("env files", () => {
  it("parses comments, export, quotes and inline comments", () => {
    const env = parseEnv(['# comment', "export A=1", 'B="two words" ', "C='x # not a comment'", "D=plain # comment", "E=", "bad line", 'F="a\\nb"'].join("\n"));
    expect(env).toEqual({ A: "1", B: "two words", C: "x # not a comment", D: "plain", E: "", F: "a\nb" });
  });

  it("never overrides a key that is already set, and ignores a missing file", async () => {
    dir = await mkdtemp(join(tmpdir(), "egb-env-"));
    await writeFile(join(dir, ".env"), "A=file\nB=file\n");
    const target: Record<string, string | undefined> = { A: "real" };
    expect(loadEnvFile(join(dir, ".env"), target)).toEqual(["B"]);
    expect(target).toEqual({ A: "real", B: "file" });
    expect(loadEnvFile(join(dir, "missing"), target)).toEqual([]);
  });

  it("reads the Box's env file before the repo's .env, so the Box's wins", async () => {
    dir = await mkdtemp(join(tmpdir(), "egb-env-"));
    const home = join(dir, "home");
    const repo = join(dir, "repo");
    await mkdir(join(home, ".config", "egb"), { recursive: true });
    await mkdir(repo);
    await writeFile(join(home, ".config", "egb", "env"), "EGB_PORT=9000\n");
    await writeFile(join(repo, ".env"), "EGB_PORT=9001\nEGB_HOST=0.0.0.0\n");
    const env: Record<string, string | undefined> = { EGB_DATA: "/srv/egb" };
    expect(loadEnv(env, home, repo)).toEqual([join(home, ".config", "egb", "env"), join(repo, ".env")]);
    expect(env).toEqual({ EGB_DATA: "/srv/egb", EGB_PORT: "9000", EGB_HOST: "0.0.0.0" });
  });

  it("takes EGB_ENV_FILE in place of the Box's default file", () => {
    expect(envFiles({ EGB_ENV_FILE: "/etc/egb.env" }, "/home/pi", "/repo")).toEqual(["/etc/egb.env", "/repo/.env"]);
    expect(envFiles({}, "/home/pi", "/repo")).toEqual(["/home/pi/.config/egb/env", "/repo/.env"]);
  });
});
