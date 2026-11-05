// The Builder tab: who builds here and whether it can, the Forge's jobs with their status (cancel one still going,
// remove a built game), and the builder's event stream as it comes (a job's whole log on request). Its requests carry
// the launcher token the page got as a top-level navigation, through the screen's own builder link.
import type { ForgeEvent, ForgeJob } from "../builder/types.ts";
import { BUILDER, type BuilderStatus, type CancelReply, type HelloEvent, type JobReply } from "../server/builder-wire.ts";
import { BuilderError, getJson, hasLauncherToken, openBuilderStream, postJson } from "../screen/views/builder-link.ts";
import { button, h, show } from "./dom.ts";

/** Lines kept in the live log. */
const LOG_LINES = 300;
const FINISHED = new Set(["done", "failed"]);

const time = (at: number): string => new Date(at).toLocaleTimeString("en-GB", { hour12: false });

/** One event as a log line. */
function line(e: ForgeEvent): string {
  const head = `${time(e.at)} ${e.job}`;
  switch (e.type) {
    case "status":
      return `${head} status ${e.status}: ${e.text}`;
    case "say":
      return `${head} say: ${e.text}`;
    case "tool":
      return `${head} tool ${e.name}${e.path ? ` ${e.path}` : ""} (${e.id})`;
    case "tool_done":
      return `${head} tool_done ${e.id} ${e.ok ? "ok" : "FAILED"}`;
    case "compile":
      return `${head} compile ${e.step} ${e.ok ? "ok" : "FAILED"}${e.text ? `: ${e.text}` : ""}`;
    case "result":
      return `${head} result ${e.ok ? `ok: ${e.game ?? ""}` : `failed: ${e.error ?? ""}`}`;
  }
}

export function builderTab(): { readonly el: HTMLElement } {
  const statusLine = h("p", "status");
  const out = h("output", "result");
  const jobsBody = h("tbody");
  const jobs = h(
    "table",
    "",
    h("thead", "", h("tr", "", ...["Job", "Status", "Provider", "Title", "Game", "Error", ""].map((t) => h("th", "", t)))),
    jobsBody,
  );
  const log = h("pre", "json");
  const detailTitle = h("h2", "", "A job's events");
  const detail = h("pre", "json");
  const lines: string[] = [];

  const el = h(
    "div",
    "tab",
    h("section", "card wide", h("h2", "", "Builder"), statusLine, out),
    h("section", "card wide", h("h2", "", "Jobs"), jobs),
    h("section", "card wide", h("h2", "", "Event stream"), log),
    h("section", "card wide", detailTitle, detail),
  );

  if (!hasLauncherToken()) {
    statusLine.textContent = "This page has no launcher token: open /test as a page (not in a frame) to use the builder's routes.";
    return { el };
  }

  function drawStatus(s: BuilderStatus): void {
    const model = s.model.provider === "off" ? `keywords only (${s.model.reason ?? "model off"})` : `model via ${s.model.provider}`;
    const voice = `voice ${s.voice.mode}${s.voice.reason ? ` (${s.voice.reason})` : ""}`;
    const ready = s.ready.ok ? "ready" : `not ready: ${s.ready.reason ?? ""}`;
    statusLine.textContent = `Provider ${s.provider}${s.simulated ? " (SIMULATED)" : ""} · ${ready} · ${model} · ${voice} · ${s.building ? "building" : "idle"}`;
  }

  function act(run: () => Promise<string>): Promise<void> {
    return show(out, run).then(() => void refresh());
  }

  function drawJobs(list: readonly ForgeJob[]): void {
    jobsBody.replaceChildren(
      ...list.map((job) => {
        const actions = h("td", "");
        actions.append(
          button("Events", () => openJob(job.id)),
          ...(FINISHED.has(job.status)
            ? []
            : [button("Cancel", () => act(async () => ((await postJson<CancelReply>(BUILDER.cancel, { id: job.id })).cancelled ? `cancelling ${job.id}` : `${job.id} can't be cancelled now`)))]),
          ...(job.status === "done" && job.game
            ? [button("Remove game", () => act(async () => (await postJson(BUILDER.remove, { game: job.game }), `removed ${job.game}`)))]
            : []),
        );
        const cells = [job.id, job.status, job.provider, job.brief.title ?? "", job.game ?? "", job.error ?? ""];
        return h("tr", "", ...cells.map((c) => h("td", "", c)), actions);
      }),
    );
  }

  async function openJob(id: string): Promise<void> {
    const reply = await getJson<JobReply>(`${BUILDER.job}?id=${encodeURIComponent(id)}`);
    detailTitle.textContent = `${id} · ${reply.job.status} · ${reply.events.length} events`;
    detail.textContent = reply.events.map(line).join("\n");
  }

  async function refresh(): Promise<void> {
    try {
      const [status, list] = await Promise.all([getJson<BuilderStatus>(BUILDER.status), getJson<ForgeJob[]>(BUILDER.jobs)]);
      drawStatus(status);
      drawJobs(list);
    } catch (error) {
      statusLine.textContent = error instanceof BuilderError ? `The builder said ${error.status}: ${error.message}` : String(error);
    }
  }

  function append(text: string): void {
    lines.push(text);
    if (lines.length > LOG_LINES) lines.splice(0, lines.length - LOG_LINES);
    log.textContent = lines.join("\n");
    log.scrollTop = log.scrollHeight;
  }

  openBuilderStream((event, data) => {
    if (event === "hello") {
      const hello = data as HelloEvent;
      drawStatus(hello.status);
      append(`${time(Date.now())} connected${hello.job ? `: replaying ${hello.job.id}` : ""}${hello.designer ? ` · design ${hello.designer.session} at ${hello.designer.step}` : ""}`);
      return;
    }
    if (event === "designer") return;
    const e = data as ForgeEvent;
    append(line(e));
    // A job's status changed: the table follows.
    if (e.type === "status" || e.type === "result") void refresh();
  });
  void refresh();

  return { el };
}
