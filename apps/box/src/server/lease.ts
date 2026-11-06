// The Box's lease (`BoxLease` on Sepolia): GBX staked on the Box keeps its name Active, and only then does it host.
// The watch reads the lease every 10 s and checks its end every second against the chain's clock, so the Box closes
// the moment it runs out; a lease that ran out is closed on chain (`lapse`) once. With EGB_ADMIN_KEY the screen stakes
// and unstakes from that key (`POST /api/lease/stake`, `/unstake`, launcher token), as jobs like the admin panel's.
// Before the first read the gate is `checking` (closed); a failed read keeps the last one.
import type http from "node:http";
import {
  type AdminSender,
  type LeaseReads,
  type LeaseView,
  adminSender,
  lapseCall,
  leaseOpen,
  leaseReads,
  stakeCalls,
  unstakeCall,
} from "@egb/shared/admin";
import { sepoliaClient } from "@egb/shared/web";
import { type Address, type Hex, createWalletClient, formatEther, http as rpc, isAddressEqual } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import type { Clock } from "../core/ports.ts";
import type { AdminJob } from "./admin-wire.ts";
import { HttpError, readJson, sendJson } from "./http.ts";
import { built, createJobs, reason } from "./jobs.ts";
import { LEASE, type LeaseGate, type LeaseReply, type LeaseStatus } from "./lease-wire.ts";
import type { Route } from "./routes.ts";
import type { AdminSetting } from "./settings.ts";

export const LEASE_POLL_MS = 10_000;
const TICK_MS = 1_000;

export interface LeasePorts {
  /** The Box's label, `mumbai-01`. */
  readonly label: string;
  readonly reads: LeaseReads;
  /** The Box's own P-256 key (its signer's): a Box with no name is registered with it. */
  key(): Promise<{ readonly qx: Hex; readonly qy: Hex }>;
  /** The key that stakes and unstakes; null when the Box only watches. */
  readonly staker: { readonly address: Address; readonly sender: AdminSender } | null;
  /** The Box's clock: only its intervals and elapsed time are used. */
  readonly clock: Clock;
  log(text: string): void;
}

export interface LeaseWatch {
  gate(): LeaseGate;
  reply(): LeaseReply;
  /** Stakes `{ hours }` more on the Box. */
  stake(body: unknown): Promise<AdminJob>;
  /** Unstakes it: every GBX back, and the Box closes. */
  unstake(): Promise<AdminJob>;
  /** Hears every change of the gate. */
  onGate(listener: (gate: LeaseGate) => void): () => void;
  stop(): void;
}

/** The ports on Sepolia: reads over the RPC, and the admin key (when set) as the staker. */
export function leaseOnSepolia(options: {
  label: string;
  rpcUrl: string;
  admin: AdminSetting | null;
  key: LeasePorts["key"];
  clock: Clock;
  log: (text: string) => void;
}): LeaseWatch {
  const client = sepoliaClient([options.rpcUrl]);
  let staker: LeasePorts["staker"] = null;
  if (options.admin) {
    const account = privateKeyToAccount(options.admin.key);
    const wallet = createWalletClient({ account, chain: sepolia, transport: rpc(options.admin.rpcUrl, { timeout: 15_000 }) });
    staker = { address: account.address, sender: adminSender(wallet, client) };
  }
  options.log(`lease: ${options.label} hosts while GBX is staked on it${staker ? `; ${staker.address} stakes from the screen` : ""}`);
  return createLeaseWatch({ label: options.label, reads: leaseReads(client), key: options.key, staker, clock: options.clock, log: options.log });
}

function statusOf(view: LeaseView): LeaseStatus {
  return {
    label: view.label,
    name: view.name,
    standing: view.standing,
    expiry: view.expiry,
    startedAt: view.lease?.start ?? null,
    endsAt: view.lease?.end ?? null,
    stake: formatEther(view.lease?.stake ?? 0n),
    operator: view.lease?.operator ?? null,
    ratePerHour: formatEther(view.ratePerHour),
    minHours: view.minHours,
    maxHours: view.maxHours,
    gbx: view.staker ? formatEther(view.staker.gbx) : null,
  };
}

export function createLeaseWatch(ports: LeasePorts): LeaseWatch {
  const { clock, log, staker } = ports;
  let view: LeaseView | null = null;
  /** The Box clock's reading when `view` was read: the chain's time moves on from `view.now` by it. */
  let readAt = 0;
  let error: string | null = null;
  let gate: LeaseGate = "checking";
  /** The end of the last lease this Box closed on chain, so it closes each once. */
  let lapsed = 0;
  let reading: Promise<void> | null = null;
  const listeners = new Set<(gate: LeaseGate) => void>();

  const jobs = staker
    ? createJobs({ sender: staker.sender, now: () => Date.now(), log, tag: "lease", settled: () => void refresh() })
    : null;

  /** The last read, at the chain's time now. */
  function current(): LeaseView | null {
    return view ? { ...view, now: view.now + Math.floor((clock.now() - readAt) / 1000) } : null;
  }

  function settle(): void {
    const now = current();
    const next: LeaseGate = now === null ? "checking" : leaseOpen(now) ? "open" : "closed";
    if (next !== gate) {
      log(`lease: ${ports.label} ${gate} -> ${next}`);
      gate = next;
      for (const listener of listeners) listener(next);
    }
    if (now?.lease && now.lease.end <= now.now && jobs && !jobs.running() && lapsed !== now.lease.end) {
      lapsed = now.lease.end;
      const call = lapseCall(now);
      jobs.start(call.what, [call]);
    }
  }

  function refresh(): Promise<void> {
    reading ??= ports.reads
      .view(ports.label, staker?.address)
      .then((value) => {
        view = value;
        readAt = clock.now();
        error = null;
        settle();
      })
      .catch((e: unknown) => {
        error = `reading Sepolia failed: ${reason(e)}`;
      })
      .finally(() => (reading = null));
    return reading;
  }

  /** A fresh read, for a stake or unstake to be built on, and the sender. */
  async function ready(): Promise<{ view: LeaseView; jobs: NonNullable<typeof jobs> }> {
    if (!jobs) throw new HttpError(409, "no admin key on this Box: set EGB_ADMIN_KEY");
    if (jobs.running()) throw new HttpError(409, "a lease transaction is still going");
    await refresh();
    const now = current();
    if (!now) throw new HttpError(503, error ?? "the lease isn't read yet");
    return { view: now, jobs };
  }

  void refresh();
  const handles = [clock.every(LEASE_POLL_MS, () => void refresh()), clock.every(TICK_MS, settle)];

  return {
    gate: () => gate,
    reply() {
      const now = current();
      return {
        gate,
        now: now?.now ?? Math.floor(Date.now() / 1000),
        status: now ? statusOf(now) : null,
        staker: staker?.address ?? null,
        error,
        jobs: jobs?.list() ?? [],
      };
    },
    async stake(input) {
      const hours = (input as { hours?: unknown } | null)?.hours;
      if (typeof hours !== "number") throw new HttpError(400, "the body must be { hours: number }");
      const { view: now, jobs: run } = await ready();
      const key = now.key ?? (await ports.key());
      const calls = built(() => stakeCalls(now, key, hours));
      return run.start(calls[calls.length - 1]?.what ?? "stake", calls);
    },
    async unstake() {
      const { view: now, jobs: run } = await ready();
      if (now.lease && staker && !isAddressEqual(now.lease.operator, staker.address)) {
        throw new HttpError(409, `the lease is ${now.lease.operator}'s: only they can unstake it`);
      }
      const call = built(() => unstakeCall(now));
      return run.start(call.what, [call]);
    },
    onGate(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      for (const handle of handles) clock.cancel(handle);
    },
  };
}

/** The lease routes; with no lease (the simulator) `GET /api/lease` answers `off` and the writes are a 409. */
export function leaseRoutes(lease: LeaseWatch | null): Route[] {
  const off = (): never => {
    throw new HttpError(409, "this Box has no lease: it runs on the demo chain");
  };
  const write = (path: string, handle: (req: http.IncomingMessage) => Promise<AdminJob>): Route => ({
    method: "POST",
    path,
    launcher: true,
    handle: async (req, res) => sendJson(res, await handle(req), 202),
  });
  return [
    {
      method: "GET",
      path: LEASE.status,
      handle: (_req, res) =>
        sendJson(res, lease ? lease.reply() : ({ gate: "off", now: Math.floor(Date.now() / 1000), status: null, staker: null, error: null, jobs: [] } satisfies LeaseReply)),
    },
    write(LEASE.stake, async (req) => (lease ?? off()).stake(await readJson(req))),
    write(LEASE.unstake, async () => (lease ?? off()).unstake()),
  ];
}
