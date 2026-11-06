// One whole build outside the server, for checking the Forge on a laptop or the Pi:
//
//   node apps/box/src/builder/forge/smoke.ts [--provider claude|sim] [--template <id>] [--fixture] [--fast] [--data <dir>]
//
// It builds one game from a fixed brief through the real service (a forked child, the agent or the sim, the checks,
// the install) into a temp data folder (or --data), prints every event, and ends with the installed folder. The shelf
// is the team games' folder; --fixture adds the Forge's test template (tap-three). --fast replays the sim at once
// instead of at its recorded pace. Costs Claude usage with `claude`.
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ForgeEvent, ForgeProvider } from "../types.ts";
import { forgeDirs } from "./install.ts";
import { createForge } from "./service.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const provider = (opt("--provider") ?? "sim") as ForgeProvider;
const dataDir = opt("--data") ?? mkdtempSync(path.join(os.tmpdir(), "egb-forge-smoke-"));
const gameRoots = [fileURLToPath(new URL("../../games", import.meta.url))];
if (args.includes("--fixture")) gameRoots.push(fileURLToPath(new URL("./fixtures", import.meta.url)));

function line(e: ForgeEvent): string {
  switch (e.type) {
    case "status":
      return `· [${e.status}] ${e.text}`;
    case "say":
      return `  “${e.text.replace(/\s+/g, " ").slice(0, 160)}”`;
    case "tool":
      return `  → ${e.name}${e.path ? ` ${e.path}` : ""}`;
    case "tool_done":
      return `    ${e.ok ? "ok" : "FAILED"}`;
    case "compile":
      return `  ⚙ ${e.step} ${e.ok ? "ok" : "FAILED"}: ${e.text}`;
    case "result":
      return `■ ${e.ok ? `installed ${e.game}` : `failed: ${e.error}`}`;
  }
}

const forge = createForge({ dataDir, gameRoots, env: process.env, simSpeed: args.includes("--fast") ? 0 : 1 });
const shelf = forge.shelf();
const template = opt("--template") ?? shelf[0]?.id;
if (!template) {
  console.error(`No template on the shelf (looked in ${gameRoots.join(", ")}). Try --fixture.`);
  process.exit(1);
}
console.log(`Forge smoke · ${provider} · ready ${JSON.stringify(forge.ready(provider))} · template ${template} · data ${dataDir}`);
const t0 = Date.now();
const job = forge.submit(
  { template, mechanic: "each tap scores a point; first to five wins", theme: "a lighthouse in a storm", twist: null, stakes: [1, 5], voice: "a calm sea captain", title: "Beacon Five" },
  provider,
);
forge.subscribe(
  (e) => {
    if (e.job !== job.id) return;
    console.log(line(e));
    if (e.type !== "result") return;
    console.log(`${e.ok ? "READY" : "FAILED"} in ${((Date.now() - t0) / 1000).toFixed(1)} s${e.game ? ` · ${path.join(forgeDirs(dataDir).games, e.game)}` : ""}`);
    void forge.stop().then(() => process.exit(e.ok ? 0 : 1));
  },
  { replay: job.id },
);
