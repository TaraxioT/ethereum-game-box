// The Admin tab: with EGB_ADMIN_KEY on the Box (gamebox.eth's admin), add a game with its champion title, open a
// championship (a prize in test USDC is minted and approved first) and close one once it has ended; the games with
// their titles, the latest championships and every job's transactions as they go. Its requests carry the launcher
// token through the screen's own builder link; it reads only while the tab is open.
import { formatSeconds } from "@egb/shared/admin";
import { ADMIN, type AdminCup, type AdminGame, type AdminJob, type AdminReply, type AdminView } from "../server/admin-wire.ts";
import { BuilderError, getJson, hasLauncherToken, postJson } from "../screen/views/builder-link.ts";
import { button, h, show } from "./dom.ts";

const POLL_MS = 3_000;
const UNITS = { seconds: 1, minutes: 60, hours: 3_600, days: 86_400 } as const;
type Unit = keyof typeof UNITS;

const short = (address: string | null): string => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—");
const who = (name: string | null, address: string | null): string => name ?? short(address);

/** `in 4m 10s`, or `4m ago` once past. */
function until(at: number, now: number): string {
  return at > now ? `in ${formatSeconds(at - now)}` : `${formatSeconds(now - at)} ago`;
}

function input(type: string, value: string, className = ""): HTMLInputElement {
  const el = h("input", className);
  el.type = type;
  el.value = value;
  return el;
}

function select<T extends string>(options: readonly T[], value: T): HTMLSelectElement {
  const el = h("select", "", ...options.map((option) => h("option", "", option)));
  el.value = value;
  return el;
}

function link(href: string, text: string): HTMLAnchorElement {
  const a = h("a", "", text);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}

const table = (heads: readonly string[], body: HTMLTableSectionElement): HTMLTableElement =>
  h("table", "", h("thead", "", h("tr", "", ...heads.map((t) => h("th", "", t)))), body);

export interface AdminTab {
  readonly el: HTMLElement;
  /** Reads now (the tab was opened). */
  refresh(): void;
}

export function adminTab(): AdminTab {
  const statusLine = h("p", "status");
  const out = h("output", "result");

  const gameLabel = input("text", "", "badge-name");
  gameLabel.placeholder = "game label, such as tapwar";
  const termCount = input("number", "15");
  termCount.min = "1";
  const termUnit = select(Object.keys(UNITS) as Unit[], "minutes");

  const cupGame = h("select");
  const cupLabel = input("text", "", "badge-name");
  cupLabel.placeholder = "cup label, such as demo-cup-1";
  const cupMinutes = input("number", "5");
  cupMinutes.min = "1";
  const cupPrize = input("text", "0");
  cupPrize.size = 8;

  const gamesBody = h("tbody");
  const cupsBody = h("tbody");
  const jobsBody = h("tbody");

  const el = h(
    "div",
    "tab",
    h("section", "card wide", h("h2", "", "Admin"), statusLine, out),
    h(
      "section",
      "card wide",
      h("h2", "", "Add a game and its title"),
      h("p", "hint", "Adds <label>.gamebox.eth and champion.<label>.gamebox.eth. A game can't be removed once added; its title moves with every win and lapses after the term."),
      h("div", "row", gameLabel, h("label", "", "title term ", termCount, " ", termUnit), button("Add game", () => act(addGame))),
    ),
    h("section", "card wide", h("h2", "", "Games and titles"), table(["Game", "Title term", "Champion", "Streak", "Title", "Cup"], gamesBody)),
    h(
      "section",
      "card wide",
      h("h2", "", "Open a cup"),
      h("p", "hint", "One open per game. Every result for the game scores it until it ends; it can't be cancelled, only closed once it has ended. A prize is test USDC, minted to the admin first."),
      h("div", "row", cupGame, cupLabel, h("label", "", "runs ", cupMinutes, " min"), h("label", "", "prize ", cupPrize, " USDC"), button("Open", () => act(openCup))),
    ),
    h("section", "card wide", h("h2", "", "Championships (latest)"), table(["#", "Name", "Ends", "Prize", "Status", "Winner", ""], cupsBody)),
    h("section", "card wide", h("h2", "", "Jobs"), table(["#", "What", "Status", "Transactions", "Error"], jobsBody)),
  );

  if (!hasLauncherToken()) {
    statusLine.textContent = "This page has no launcher token: open /test as a page (not in a frame) to use the admin's routes.";
    return { el, refresh: () => undefined };
  }

  function act(run: () => Promise<string>): Promise<void> {
    return show(out, run).then(() => void refresh());
  }

  async function addGame(): Promise<string> {
    const titleTerm = Math.round(Number(termCount.value) * UNITS[termUnit.value as Unit]);
    const job = await postJson<AdminJob>(ADMIN.game, { label: gameLabel.value, titleTerm });
    return `job ${job.id}: ${job.what}`;
  }

  async function openCup(): Promise<string> {
    const runSeconds = Math.round(Number(cupMinutes.value) * 60);
    const job = await postJson<AdminJob>(ADMIN.openCup, { game: cupGame.value, label: cupLabel.value, runSeconds, prize: cupPrize.value });
    return `job ${job.id}: ${job.what}`;
  }

  function drawStatus(reply: Extract<AdminReply, { enabled: true }>): void {
    const v = reply.view;
    const roles = v ? `games ${v.roles.games ? "yes" : "NO"} · cups ${v.roles.cups ? "yes" : "NO"} · USDC minter ${v.roles.minter ? "yes" : "NO"}` : "";
    statusLine.textContent = [reply.address, v && `${Number(v.eth).toFixed(4)} ETH`, v && `${v.usdc} USDC`, v && `block ${v.block}`, roles, reply.error]
      .filter(Boolean)
      .join(" · ");
    statusLine.classList.toggle("bad", reply.error !== null || (v !== null && !(v.roles.games && v.roles.cups)));
  }

  function drawGames(view: AdminView): void {
    const cupOf = (game: AdminGame): AdminCup | undefined => view.cups.find((c) => c.id === game.openCup);
    gamesBody.replaceChildren(
      ...view.games.map((g) => {
        const t = g.title;
        const cup = cupOf(g);
        const cells = [
          g.name,
          formatSeconds(g.titleTerm),
          t.holder ? who(t.holderName, t.holder) : "nobody yet",
          t.holder ? String(t.streak) : "",
          t.holder ? (t.live ? `held, lapses ${until(t.expiry, view.now)}` : `lapsed ${until(t.expiry, view.now)}`) : "",
          g.openCup ? `#${g.openCup}${cup ? ` ${cup.label}, ends ${until(cup.ends, view.now)}` : ""}` : "none open",
        ];
        return h("tr", "", ...cells.map((c) => h("td", "", c)));
      }),
    );
    // The championship's game picker follows the games, keeping the pick.
    const picked = cupGame.value;
    const labels = view.games.map((g) => g.label);
    if ([...cupGame.options].map((o) => o.value).join() !== labels.join()) {
      cupGame.replaceChildren(...labels.map((label) => h("option", "", label)));
      if (labels.includes(picked)) cupGame.value = picked;
    }
  }

  function drawCups(view: AdminView): void {
    cupsBody.replaceChildren(
      ...view.cups.map((c) => {
        const ended = c.ends <= view.now;
        const status = c.closed ? "closed" : ended ? "ended, not closed" : "open";
        const action = h("td", "");
        if (!c.closed && ended) {
          action.append(
            button("Close", () =>
              act(async () => {
                const job = await postJson<AdminJob>(ADMIN.closeCup, { game: c.game });
                return `job ${job.id}: ${job.what}`;
              }),
            ),
          );
        }
        const cells = [`#${c.id}`, c.name, until(c.ends, view.now), `${c.prize} USDC`, status, c.closed ? (c.winner ? who(c.winnerName, c.winner) : "nobody played") : ""];
        return h("tr", "", ...cells.map((cell) => h("td", "", cell)), action);
      }),
    );
  }

  function drawJobs(jobs: readonly AdminJob[]): void {
    jobsBody.replaceChildren(
      ...jobs.map((job) => {
        const txs = h("td", "");
        for (const step of job.steps) txs.append(link(step.etherscan, `${step.what} ↗`), h("br"));
        const status = h("td", job.status === "failed" ? "bad" : job.status === "done" ? "good" : "", job.status);
        return h("tr", "", h("td", "", String(job.id)), h("td", "", job.what), status, txs, h("td", "bad", job.error ?? ""));
      }),
    );
  }

  async function refresh(): Promise<void> {
    try {
      const reply = await getJson<AdminReply>(ADMIN.status);
      if (!reply.enabled) {
        statusLine.textContent = "No admin key on this Box: set EGB_ADMIN_KEY in ~/.config/egb/env and restart it.";
        statusLine.classList.add("bad");
        return;
      }
      drawStatus(reply);
      drawJobs(reply.jobs);
      if (reply.view) {
        drawGames(reply.view);
        drawCups(reply.view);
      }
    } catch (error) {
      statusLine.textContent = error instanceof BuilderError ? `The Box said ${error.status}: ${error.message}` : String(error);
      statusLine.classList.add("bad");
    }
  }

  setInterval(() => {
    if (!el.hidden) void refresh();
  }, POLL_MS);

  return { el, refresh: () => void refresh() };
}
