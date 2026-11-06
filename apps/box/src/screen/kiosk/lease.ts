// The Box's lease on screen (`/api/lease`, server/lease.ts). The Box hosts only while GBX is staked on it:
// - Leased: a tag beside the settings gear shows the time left. Tapped, it opens the lease: the Box's ENS name, a
//   clock running down to the lease's end over a bar of what is left, what is staked and by whom, and SLIDE TO UNSTAKE
//   (every GBX back to the staker; the Box goes offline as the transaction lands).
// - Not leased (or not read yet): BOX OFFLINE over the stage, under the gear, with the name and why. On the kiosk's
//   own page, with a staker on the Box, a slider picks how long to stake for, shows what it costs against what the
//   staker holds, and STAKE turns the Box back on.
// - The simulator (no Sepolia, gate `off`) shows none of it.
// It reads the Box every 2 s; its clocks count down every second in between, on the chain's time. None of its pointer
// or key events reach the stage.
import "./kiosk.css";
import "./lease.css";
import type { AdminJob } from "../../server/admin-wire.ts";
import { LEASE, type LeaseReply, type LeaseStatus, type StakeBody } from "../../server/lease-wire.ts";
import { framed } from "../parts/frame.ts";
import { el } from "../shell/dom.ts";
import { ensName, setEns } from "../shell/ens-name.ts";
import { playerWord } from "../views/board.ts";
import { getJson, hasLauncherToken, postJson } from "../views/builder-link.ts";
import type { Sound } from "../views/view.ts";
import { clock, gbxWord, hourStops, hoursWord, timeOfDay } from "./lease-words.ts";
import { slideToConfirm } from "./slide.ts";

const CHAMFER = 10;
const POLL_MS = 2_000;
const TICK_MS = 1_000;
/** A finished job stays on screen this long. */
const JOB_SHOWN_MS = 90_000;
/** The stake the slider starts on: a short demo. */
const DEFAULT_HOURS = 3;

const WHY: Readonly<Record<LeaseStatus["standing"], string>> = {
  none: "This Box has no name yet. Stake GBX to register it and turn it on.",
  active: "Its lease has run out. Stake GBX to turn it back on.",
  suspended: "Nothing is staked on it, so its name is suspended. Stake GBX to turn it back on.",
  revoked: "Its name is revoked: gamebox.eth's admin took it back.",
};

function key(label: string, onClick: () => void, className = "set-key"): HTMLButtonElement {
  const b = el("button", className, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function fact(label: string): { node: HTMLElement; value: HTMLElement } {
  const node = el("div", "lease-fact");
  const value = el("span", "lease-fact-value");
  node.append(el("span", "lease-fact-label", label), value);
  return { node, value };
}

/** The latest job while it runs, or for a while after. */
function shownJob(jobs: readonly AdminJob[]): AdminJob | null {
  const job = jobs[0];
  return job && (job.status === "running" || Date.now() - job.at < JOB_SHOWN_MS) ? job : null;
}

function jobWords(job: AdminJob): string {
  const state = job.status === "running" ? "SENDING…" : job.status === "failed" ? `FAILED · ${job.error ?? ""}` : "DONE";
  const hash = job.steps.at(-1)?.hash;
  return [job.what.toUpperCase(), state, hash && `${hash.slice(0, 10)}…`].filter(Boolean).join(" · ");
}

export function mountLease(host: HTMLElement, sound: Sound): void {
  const acts = hasLauncherToken();
  let last: LeaseReply | null = null;
  /** Seconds the Box's clock runs ahead of the chain's. */
  let skew = 0;
  const chainNow = (): number => Date.now() / 1000 - skew;

  // --- The tag, beside the gear ---
  const tag = framed(el("button", "lease-tag"), CHAMFER);
  tag.type = "button";
  tag.hidden = true;
  const tagTime = el("span", "lease-tag-time");
  tag.append(el("i", "lease-dot"), el("span", "lease-tag-word", "LEASED"), tagTime);

  // --- The lease, opened from the tag ---
  const page = el("div", "lease-page");
  page.hidden = true;
  const panel = framed(el("div", "lease-panel"), CHAMFER);
  const name = ensName("", "lease-ens");
  const standing = el("span", "lease-standing");
  const left = el("div", "lease-clock");
  const barFill = el("i", "lease-bar-fill");
  const bar = el("div", "lease-bar");
  bar.append(barFill);
  const span = el("p", "lease-span");
  const staked = fact("STAKED");
  const rate = fact("RATE");
  const operator = fact("STAKER");
  const hosting = fact("HOSTING");
  const facts = el("div", "lease-facts");
  facts.append(staked.node, rate.node, operator.node, hosting.node);
  const slide = slideToConfirm("SLIDE TO UNSTAKE", () => void unstake());
  const slideHint = el("p", "lease-hint");
  const job = el("p", "lease-job");
  const out = el("p", "set-out");
  const head = el("div", "lease-head");
  head.append(el("h1", "lease-heading", "BOX LEASE"), key("CLOSE", () => close()));
  const timer = el("div", "lease-timer");
  timer.append(el("span", "lease-label", "TIME LEFT"), left, bar, span);
  const nameRow = el("div", "lease-name-row");
  nameRow.append(name, standing);
  panel.append(head, nameRow, timer, facts);
  if (acts) panel.append(slide.node, slideHint);
  panel.append(job, out);
  page.append(panel);

  // --- BOX OFFLINE, over the stage ---
  const gate = el("div", "lease-gate");
  gate.hidden = true;
  const gatePanel = framed(el("div", "lease-gate-panel"), CHAMFER);
  const gateName = ensName("", "lease-ens");
  const why = el("p", "lease-why");
  const pickHours = el("div", "lease-pick-hours");
  const pickCost = el("div", "lease-pick-cost");
  const range = el("input", "lease-range");
  range.type = "range";
  range.step = "1";
  range.min = "0";
  const rangeEnds = el("div", "lease-range-ends");
  const rangeMin = el("span", "", "");
  const rangeMax = el("span", "", "");
  rangeEnds.append(rangeMin, rangeMax);
  const holds = fact("STAKER HOLDS");
  const gateRate = fact("RATE");
  const until = fact("RUNS UNTIL");
  const gateFacts = el("div", "lease-facts");
  gateFacts.append(gateRate.node, holds.node, until.node);
  const stakeKey = key("STAKE", () => void stake(), "set-key set-go lease-stake");
  const pick = el("div", "lease-pick");
  const pickHead = el("div", "lease-pick-head");
  pickHead.append(pickHours, pickCost);
  pick.append(el("span", "lease-label", "STAKE GBX TO HOST"), pickHead, range, rangeEnds, gateFacts, stakeKey);
  const gateJob = el("p", "lease-job");
  const gateOut = el("p", "set-out");
  gatePanel.append(el("div", "lease-offline", "BOX OFFLINE"), gateName, why, pick, gateJob, gateOut);
  gate.append(gatePanel);

  host.append(gate, tag, page);
  for (const node of [tag, page, gate]) {
    for (const type of ["pointerdown", "keydown", "keyup"] as const) node.addEventListener(type, (e) => e.stopPropagation());
  }

  let stops: number[] = [];
  const hours = (): number => stops[Number(range.value)] ?? DEFAULT_HOURS;

  function say(target: HTMLElement, message: unknown, bad = false): void {
    target.textContent = message instanceof Error ? message.message : String(message ?? "");
    target.classList.toggle("bad", bad);
  }

  async function unstake(): Promise<void> {
    sound.play("ui-select");
    slide.hold("UNSTAKING…");
    say(out, "");
    try {
      await postJson<AdminJob>(LEASE.unstake);
      await refresh();
    } catch (error) {
      sound.play("error");
      slide.reset();
      say(out, error, true);
    }
  }

  async function stake(): Promise<void> {
    sound.play("ui-select");
    stakeKey.disabled = true;
    say(gateOut, "");
    try {
      await postJson<AdminJob>(LEASE.stake, { hours: hours() } satisfies StakeBody);
      await refresh();
    } catch (error) {
      sound.play("error");
      stakeKey.disabled = false;
      say(gateOut, error, true);
    }
  }

  /** Draws the stake picker; whether the staker holds too little for the hours picked. */
  function drawPick(status: LeaseStatus): boolean {
    const next = hourStops(status.minHours, status.maxHours);
    if (next.join() !== stops.join()) {
      stops = next;
      range.max = String(stops.length - 1);
      const start = stops.indexOf(DEFAULT_HOURS);
      range.value = String(start < 0 ? 0 : start);
      rangeMin.textContent = hoursWord(stops[0] ?? status.minHours);
      rangeMax.textContent = hoursWord(stops.at(-1) ?? status.maxHours);
    }
    const h = hours();
    const cost = Number(status.ratePerHour) * h;
    pickHours.textContent = hoursWord(h);
    pickCost.textContent = gbxWord(String(cost));
    gateRate.value.textContent = `${gbxWord(status.ratePerHour)} / HOUR`;
    holds.value.textContent = status.gbx === null ? "—" : gbxWord(status.gbx);
    until.value.textContent = timeOfDay(chainNow() + h * 3_600);
    const short = status.gbx !== null && Number(status.gbx) < cost;
    holds.node.classList.toggle("bad", short);
    range.style.setProperty("--at", String(stops.length > 1 ? Number(range.value) / (stops.length - 1) : 1));
    return short;
  }

  function drawGate(reply: LeaseReply): void {
    const status = reply.status;
    setEns(gateName, status?.name ?? "");
    gateName.hidden = !status;
    why.textContent = status ? WHY[status.standing] : reply.error ? `Can't read the lease: ${reply.error}` : "Reading its lease on Sepolia…";
    const running = reply.jobs[0]?.status === "running";
    const canStake = acts && reply.staker !== null && status !== null && status.standing !== "revoked";
    pick.hidden = !canStake;
    if (canStake) {
      const short = drawPick(status);
      stakeKey.disabled = running || short;
      stakeKey.textContent = running ? "STAKING…" : `STAKE ${hoursWord(hours())}`;
    }
    const shown = shownJob(reply.jobs);
    gateJob.textContent = shown ? jobWords(shown) : acts && reply.staker === null ? "Set EGB_ADMIN_KEY on the Box to stake from here." : "";
    gateJob.dataset.status = shown?.status ?? "";
  }

  function drawLease(reply: LeaseReply): void {
    const status = reply.status;
    if (!status) return;
    setEns(name, status.name);
    standing.textContent = status.standing.toUpperCase();
    standing.dataset.standing = status.standing;
    staked.value.textContent = gbxWord(status.stake);
    rate.value.textContent = `${gbxWord(status.ratePerHour)} / HOUR`;
    operator.value.textContent = playerWord(null, status.operator);
    hosting.value.textContent = "OPEN TO PLAY";
    span.textContent = status.startedAt && status.endsAt ? `STAKED ${timeOfDay(status.startedAt)} · ENDS ${timeOfDay(status.endsAt)}` : "";
    const running = reply.jobs[0]?.status === "running";
    const mine = reply.staker !== null && status.operator !== null && reply.staker.toLowerCase() === status.operator.toLowerCase();
    slide.node.hidden = !mine;
    if (running) slide.hold("UNSTAKING…");
    else if (slide.node.dataset.state) slide.reset();
    slideHint.textContent = mine
      ? `${gbxWord(status.stake)} goes back to the staker, and the Box stops hosting until it is staked again.`
      : reply.staker === null
        ? "Set EGB_ADMIN_KEY on the Box to unstake from here."
        : `Only ${playerWord(null, status.operator)} can unstake this lease.`;
    const shown = shownJob(reply.jobs);
    job.textContent = shown ? jobWords(shown) : "";
    job.dataset.status = shown?.status ?? "";
  }

  /** The clocks, on the chain's time now. */
  function tick(): void {
    const status = last?.status;
    if (!status || last?.gate !== "open" || !status.endsAt) return;
    const now = chainNow();
    const rest = status.endsAt - now;
    tagTime.textContent = clock(rest);
    left.textContent = clock(rest);
    const whole = status.startedAt ? status.endsAt - status.startedAt : 0;
    barFill.style.transform = `scaleX(${whole > 0 ? Math.min(1, Math.max(0, rest / whole)) : 0})`;
    left.classList.toggle("low", rest < 300);
  }

  function draw(reply: LeaseReply): void {
    const before = last?.gate;
    last = reply;
    skew = Date.now() / 1000 - reply.now;
    const open = reply.gate === "open";
    const offline = reply.gate === "closed" || reply.gate === "checking";
    tag.hidden = !open;
    gate.hidden = !offline;
    if (!open) close();
    if (before === "open" && reply.gate === "closed") sound.play("error");
    if (before === "closed" && open) sound.play("boot");
    if (offline) drawGate(reply);
    if (open) drawLease(reply);
    tick();
  }

  async function refresh(): Promise<void> {
    try {
      draw(await getJson<LeaseReply>(LEASE.status));
    } catch {
      // The Box restarting: keep what is shown, and read again on the next poll.
    }
  }

  function open(): void {
    if (!page.hidden) return close();
    sound.play("ui-select");
    page.hidden = false;
    tag.setAttribute("aria-expanded", "true");
    say(out, "");
    void refresh();
  }

  function close(): void {
    if (page.hidden) return;
    sound.play("ui-back");
    page.hidden = true;
    tag.setAttribute("aria-expanded", "false");
  }

  tag.addEventListener("click", open);
  page.addEventListener("click", (e) => {
    if (e.target === page) close();
  });
  page.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  range.addEventListener("input", () => {
    sound.play("ui-focus");
    if (last?.status) drawGate(last);
  });

  void refresh();
  setInterval(() => void refresh(), POLL_MS);
  setInterval(tick, TICK_MS);
}
