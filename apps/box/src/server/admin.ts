// The admin panel on the Box: with `EGB_ADMIN_KEY` (gamebox.eth's admin) the screen's Settings page adds games and
// opens and closes championships, sent from that key over SEPOLIA_RPC_URL (`@egb/shared/admin` builds, checks and
// sends every call). A request is checked before it answers (a bad label is a 400); its transactions then run as a
// job in the background, one job at a time, and the page follows them on `GET /api/admin`. The key and the RPC URL are
// never logged or answered: every error that leaves here has its URLs replaced by `<rpc>`.
import type http from "node:http";
import {
  type AdminCall,
  type AdminFunds,
  type AdminReads,
  type AdminSender,
  type AdminView as ChainView,
  AdminInputError,
  AdminRefused,
  addGameCall,
  adminReads,
  adminSender,
  closeCupCall,
  openCupCalls,
} from "@egb/shared/admin";
import { contractAddress, fakeUsdcAbi, formatUsdc, usdc } from "@egb/shared/names";
import { ETHERSCAN, sepoliaClient } from "@egb/shared/web";
import { type Address, type PublicClient, createWalletClient, formatEther, http as rpc } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { redact } from "../chain/reads.ts";
import { wireBoard } from "./board.ts";
import { ADMIN, type AdminJob, type AdminReply, type AdminStep, type AdminView } from "./admin-wire.ts";
import { HttpError, readJson, sendJson } from "./http.ts";
import type { Route } from "./routes.ts";
import type { AdminSetting } from "./settings.ts";

/** A view younger than this is answered from memory (the tab polls every few seconds). */
const VIEW_TTL_MS = 3_000;
/** Jobs kept for the tab. */
const JOBS_KEPT = 12;
const MAX_LABEL = 64;

export interface AdminPorts {
  readonly address: Address;
  readonly reads: AdminReads;
  readonly sender: AdminSender;
  /** The admin's USDC and what `Championships` may take, read now. */
  funds(): Promise<AdminFunds>;
  /** Unix ms. */
  now(): number;
  log(text: string): void;
}

export interface Admin {
  readonly address: Address;
  reply(): Promise<AdminReply>;
  addGame(body: unknown): AdminJob;
  openCup(body: unknown): Promise<AdminJob>;
  closeCup(body: unknown): AdminJob;
}

/** The ports on Sepolia: the key's account over the RPC. */
export function adminOnSepolia(setting: AdminSetting, log: (text: string) => void): Admin {
  const account = privateKeyToAccount(setting.key);
  const client: PublicClient = sepoliaClient([setting.rpcUrl]);
  const wallet = createWalletClient({ account, chain: sepolia, transport: rpc(setting.rpcUrl, { timeout: 15_000 }) });
  const token = { address: contractAddress("FakeUSDC"), abi: fakeUsdcAbi } as const;
  log(`admin: ${account.address} (EGB_ADMIN_KEY) on the screen's Settings page`);
  return createAdmin({
    address: account.address,
    reads: adminReads(client, account.address),
    sender: adminSender(wallet, client),
    async funds() {
      const [balance, allowance] = await Promise.all([
        client.readContract({ ...token, functionName: "balanceOf", args: [account.address] }),
        client.readContract({ ...token, functionName: "allowance", args: [account.address, contractAddress("Championships")] }),
      ]);
      return { balance, allowance };
    },
    now: () => Date.now(),
    log,
  });
}

const reason = (error: unknown): string =>
  redact(error instanceof AdminRefused ? error.message : error instanceof Error ? error.message.split("\n")[0] ?? "" : String(error));

function wireView(view: ChainView): AdminView {
  return { ...wireBoard(view), eth: formatEther(view.eth), usdc: formatUsdc(view.usdc), roles: view.roles };
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpError(400, "the body must be a JSON object");
  return value as Record<string, unknown>;
}

function text(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LABEL) throw new HttpError(400, `${key} must be a string of 1 to ${MAX_LABEL} characters`);
  return value.trim().toLowerCase();
}

function seconds(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value)) throw new HttpError(400, `${key} must be whole seconds`);
  return value;
}

function prize(body: Record<string, unknown>): bigint {
  const value = body.prize;
  if (typeof value !== "string" || !/^\d{1,9}(\.\d{1,6})?$/.test(value.trim())) throw new HttpError(400, "prize must be USDC, such as \"0\" or \"25.5\"");
  return usdc(value.trim());
}

/** Builds the calls; a refusal of the input is a 400. */
function built<T>(build: () => T): T {
  try {
    return build();
  } catch (error) {
    if (error instanceof AdminInputError) throw new HttpError(400, error.message);
    throw error;
  }
}

export function createAdmin(ports: AdminPorts): Admin {
  const jobs: AdminJob[] = [];
  let nextId = 1;
  let view: { at: number; value: AdminView } | null = null;
  let viewError: string | null = null;
  let reading: Promise<void> | null = null;

  function refresh(): Promise<void> {
    reading ??= ports.reads
      .view()
      .then((value) => {
        view = { at: ports.now(), value: wireView(value) };
        viewError = null;
      })
      .catch((error: unknown) => {
        viewError = `reading Sepolia failed: ${reason(error)}`;
      })
      .finally(() => (reading = null));
    return reading;
  }

  function update(id: number, change: Partial<AdminJob>): void {
    const i = jobs.findIndex((job) => job.id === id);
    const job = jobs[i];
    if (job) jobs[i] = { ...job, ...change };
  }

  /** Starts `calls` as a job: answered at once, run in the background. */
  function start(what: string, calls: readonly AdminCall[]): AdminJob {
    const job: AdminJob = { id: nextId++, what, status: "running", steps: [], error: null, at: ports.now() };
    jobs.unshift(job);
    jobs.length = Math.min(jobs.length, JOBS_KEPT);
    ports.log(`admin: job ${job.id} ${what}`);
    const steps: AdminStep[] = [];
    void ports.sender
      .send(calls, (step, hash) => {
        steps.push({ what: step, hash, etherscan: `${ETHERSCAN}/tx/${hash}` });
        update(job.id, { steps: [...steps] });
        ports.log(`admin: job ${job.id} sent ${step}: ${hash}`);
      })
      .then(() => {
        update(job.id, { status: "done" });
        ports.log(`admin: job ${job.id} done`);
      })
      .catch((error: unknown) => {
        const why = reason(error);
        update(job.id, { status: "failed", error: why });
        ports.log(`admin: job ${job.id} failed: ${why}`);
      })
      .finally(() => {
        view = null;
        void refresh();
      });
    return job;
  }

  const nowSeconds = () => Math.floor(ports.now() / 1000);

  return {
    address: ports.address,
    async reply() {
      if (!view || ports.now() - view.at > VIEW_TTL_MS) await refresh();
      return { enabled: true, address: ports.address, view: view?.value ?? null, error: viewError, jobs: [...jobs] };
    },
    addGame(input) {
      const body = object(input);
      const call = built(() => addGameCall(text(body, "label"), seconds(body, "titleTerm")));
      return start(call.what, [call]);
    },
    async openCup(input) {
      const body = object(input);
      const now = nowSeconds();
      const cup = { game: text(body, "game"), label: text(body, "label"), ends: now + seconds(body, "runSeconds"), prize: prize(body) };
      const funds = await ports.funds();
      const calls = built(() => openCupCalls(cup, now, ports.address, funds));
      return start(calls[calls.length - 1]?.what ?? "open a cup", calls);
    },
    closeCup(input) {
      const call = built(() => closeCupCall(text(object(input), "game")));
      return start(call.what, [call]);
    },
  };
}

const route = (method: Route["method"], path: string, handle: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>): Route => ({
  method,
  path,
  launcher: true,
  handle,
});

/** The admin routes; without an admin, `GET /api/admin` says so and every write is a 409. */
export function adminRoutes(admin: Admin | null): Route[] {
  const off = (): never => {
    throw new HttpError(409, "no admin key on this Box: set EGB_ADMIN_KEY");
  };
  return [
    route("GET", ADMIN.status, async (_, res) => sendJson(res, admin ? await admin.reply() : ({ enabled: false } satisfies AdminReply))),
    route("POST", ADMIN.game, async (req, res) => sendJson(res, (admin ?? off()).addGame(await readJson(req)), 202)),
    route("POST", ADMIN.openCup, async (req, res) => sendJson(res, await (admin ?? off()).openCup(await readJson(req)), 202)),
    route("POST", ADMIN.closeCup, async (req, res) => sendJson(res, (admin ?? off()).closeCup(await readJson(req)), 202)),
  ];
}
