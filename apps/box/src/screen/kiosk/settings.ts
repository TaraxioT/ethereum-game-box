// The Settings page, on the kiosk's own page only (the one the Box gave its launcher token). A gear in the window's
// top-left corner (clear of the ports and the rack) opens it over the stage; CLOSE, Escape or the tag again shut it.
// It fits one screen with no scrolling, down to the Pi's 1280×720 (touch can't be trusted to scroll a kiosk):
// - The head: sound on or off, reload the screen, and EXIT TO DESKTOP (a first tap arms it, a second asks the Box to
//   close the kiosk's browser, POST /api/box/exit; the Box keeps running).
// - With EGB_ADMIN_KEY on the Box (gamebox.eth's admin, `/api/admin/…`), two columns. LIVE NOW: game by game, who
//   holds its title and for how long, and its cup (the leader, the prize and a countdown; CLOSE & PAY once it has
//   ended; OPENING… while its job runs), then the cups closed lately and ADD A GAME. On the right, OPEN A CUP in four
//   steps (1 GAME, a game with a cup open shown taken with that cup and its time left; 2 HOW LONG; 3 PRIZE; 4 NAME,
//   with NEW NAME), the cup's full ENS name as it will be registered, a summary of what OPEN does and OPEN; then the
//   ACTIVITY of every job as its transactions go. Presets for every choice, since the kiosk has no keyboard; the
//   labels are made up and can be typed over. Every ENS name shows whole, scrolling sideways when it doesn't fit.
// It reads the Box every 3 s while open, and its clocks count down every second in between.
// None of its pointer or key events reach the stage.
import "./kiosk.css";
import { ensName, setEns } from "../shell/ens-name.ts";
import { formatSeconds } from "@egb/shared/admin";
import { championshipLabelProblem, championshipName } from "@egb/shared/names";
import { gameOfLabel } from "../../core/catalogue.ts";
import { ADMIN, type AdminCup, type AdminGame, type AdminJob, type AdminReply, type AdminView } from "../../server/admin-wire.ts";
import { framed } from "../parts/frame.ts";
import { el } from "../shell/dom.ts";
import { BuilderError, getJson, hasLauncherToken, postJson } from "../views/builder-link.ts";
import type { Sound } from "../views/view.ts";
import { playerWord, timeLeft } from "../views/board.ts";

const CHAMFER = 10;
const ARMED_MS = 4_000;
const POLL_MS = 3_000;
const TICK_MS = 1_000;
const JOBS_SHOWN = 3;
const PAST_SHOWN = 3;

const RUNS = [
  ["2 MIN", 120],
  ["5 MIN", 300],
  ["15 MIN", 900],
  ["1 HOUR", 3_600],
] as const;
const PRIZES = ["0", "10", "50", "100"] as const;
/** What a new cup is opened with unless picked otherwise: a short demo. */
const DEFAULT_RUN = 300;
const DEFAULT_PRIZE = "50";
const DEFAULT_GAME = "quickdraw";
/** Words a made-up cup label starts with. */
const CUP_WORDS = ["dusk", "mesa", "canyon", "sunset", "gold", "comet", "frontier", "outlaw", "sheriff", "mumbai"] as const;
const TERMS = [
  ["2 MIN", 120],
  ["15 MIN", 900],
  ["1 DAY", 86_400],
  ["7 DAYS", 604_800],
] as const;

function key(label: string, onClick: () => void, className = "set-key"): HTMLButtonElement {
  const b = el("button", className, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/** A row of choices, one lit. */
function segments<T>(choices: readonly (readonly [string, T])[], start: T) {
  const row = el("div", "set-segments");
  let value = start;
  const buttons = choices.map(([label, v]) => {
    const b = key(label, () => {
      value = v;
      sync();
    }, "set-segment");
    return { b, v };
  });
  const sync = (): void => buttons.forEach(({ b, v }) => b.setAttribute("aria-pressed", String(v === value)));
  row.append(...buttons.map(({ b }) => b));
  sync();
  return { row, get: () => value };
}

function field(placeholder: string, value: string): HTMLInputElement {
  const input = el("input", "set-input");
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.spellcheck = false;
  input.autocapitalize = "off";
  return input;
}

function section(title: string, ...children: HTMLElement[]): HTMLElement {
  const s = el("section", "set-section");
  s.append(el("h2", "set-title", title), ...children);
  return s;
}

function row(...children: HTMLElement[]): HTMLElement {
  const r = el("div", "set-row");
  r.append(...children);
  return r;
}

/** A made-up label: `dusk-cup-42`, `game-k3x9`. A closed cup's name is its winner's for good, so each is new. */
const cupLabel = (): string =>
  `${CUP_WORDS[Math.floor(Math.random() * CUP_WORDS.length)]}-cup-${10 + Math.floor(Math.random() * 90)}`;
const gameLabel = (): string => `game-${Math.random().toString(36).slice(2, 6)}`;

/** A game's name on screen: the Box's title for its own games (`QUICK DRAW`), else its label. */
const gameWord = (label: string): string => (gameOfLabel(label)?.title ?? label).toUpperCase();

/** The games this Box plays first, in rack order, then any other game on chain. */
function ordered(games: readonly AdminGame[]): AdminGame[] {
  const known = (g: AdminGame): number => (gameOfLabel(g.label) ? 0 : 1);
  return [...games].sort((a, b) => known(a) - known(b));
}

/** A countdown to `ends` (unix seconds) that `tickCountdowns` keeps current without redrawing its line. */
function countdown(ends: number, prefix = ""): HTMLElement {
  const span = el("span", "set-countdown");
  span.dataset.ends = String(ends);
  span.dataset.prefix = prefix;
  return span;
}

/** `19:07`, the Box's local time `seconds` (unix) stands for. */
const clockAt = (seconds: number): string => new Date(seconds * 1000).toTimeString().slice(0, 5);

/** The running job that opens or closes `game`'s cup, if any (by its `what`, as `@egb/shared/admin` words it). */
function jobFor(jobs: readonly AdminJob[], game: string): AdminJob | undefined {
  return jobs.find((job) => job.status === "running" && (job.what.includes(`.${game}.gamebox.eth`) || job.what.startsWith(`close ${game}'s`)));
}

export function mountSettings(host: HTMLElement, sound: Sound): void {
  if (!hasLauncherToken()) return;

  const tag = framed(el("button", "set-tag"), CHAMFER);
  tag.type = "button";
  tag.setAttribute("aria-label", "Settings");
  tag.title = "Settings";
  tag.append(el("i", "set-gear"));

  const page = el("div", "set-page");
  page.hidden = true;
  const panel = framed(el("div", "set-panel"), CHAMFER);
  const status = el("p", "set-status");
  const out = el("p", "set-out");

  // --- The Box ---
  const soundKey = key("", () => {
    sound.setMuted(!sound.muted);
    drawSound();
  });
  const drawSound = (): void => {
    soundKey.textContent = sound.muted ? "SOUND OFF" : "SOUND ON";
    soundKey.setAttribute("aria-pressed", String(!sound.muted));
  };
  drawSound();
  let armed: ReturnType<typeof setTimeout> | undefined;
  const exitKey = key("EXIT TO DESKTOP", () => {
    if (exitKey.dataset.step !== "armed") {
      exitKey.dataset.step = "armed";
      exitKey.textContent = "TAP AGAIN TO EXIT";
      clearTimeout(armed);
      armed = setTimeout(disarm, ARMED_MS);
      return;
    }
    exitKey.dataset.step = "closing";
    exitKey.textContent = "CLOSING";
    postJson("/api/box/exit").catch((error: unknown) => {
      // The browser closing under the request is the exit working, not a refusal.
      if (error instanceof BuilderError && error.status === 0) return;
      disarm();
      say(error, true);
    });
  }, "set-key set-alert");
  const disarm = (): void => {
    delete exitKey.dataset.step;
    exitKey.textContent = "EXIT TO DESKTOP";
  };

  // --- Live now ---
  const liveList = el("div", "set-games");
  const pastList = el("ul", "set-list set-past");
  const live = section("Live now", liveList, el("h3", "set-sub", "Closed lately"), pastList);

  // --- Open a cup, in four steps ---
  const cupGame = el("div", "set-segments");
  let pickedGame = "";
  const cupName = field("cup label", cupLabel());
  const run = segments(RUNS, DEFAULT_RUN);
  const prize = segments(PRIZES.map((p) => [p === "0" ? "NONE" : `${p} USDC`, p] as const), DEFAULT_PRIZE);
  const openKey = key("OPEN", () => void act(openCup), "set-key set-go set-open");
  const preview = el("div", "set-preview");
  const previewName = ensName("", "set-preview-name");
  preview.append(el("span", "set-preview-kind", "WILL REGISTER"), previewName);
  const summary = el("p", "set-summary");
  const step = (n: number, label: string, ...children: HTMLElement[]): HTMLElement => {
    const r = row(el("span", "set-step", String(n)), el("span", "set-label", label), ...children);
    r.classList.add("set-step-row");
    return r;
  };
  const openSection = section(
    "Open a cup",
    step(1, "GAME", cupGame),
    step(2, "HOW LONG", run.row),
    step(3, "PRIZE", prize.row),
    step(4, "NAME", cupName, key("NEW NAME", () => ((cupName.value = cupLabel()), drawPlan()))),
    preview,
    row(summary, openKey),
    el("p", "set-hint", "Every result in that game before the end scores it: win 3, draw 1. At the close the winner is paid the prize and owns the name forever: nobody can change or take it."),
  );
  // Each choice redraws the plan: the name as it will be registered, and what OPEN does.
  for (const node of [run.row, prize.row]) node.addEventListener("click", () => drawPlan());
  cupName.addEventListener("input", () => drawPlan());

  // --- Activity, and games ---
  const jobsList = el("ul", "set-list set-jobs");
  const newGame = field("game label", gameLabel());
  const term = segments(TERMS, 900);
  const gamesSection = section(
    "Add a game",
    row(el("span", "set-label", "TITLE TERM"), term.row),
    row(el("span", "set-label", "LABEL"), newGame, key("ADD", () => void act(addGame), "set-key set-go")),
  );

  const left = el("div", "set-col");
  left.append(live, gamesSection);
  const right = el("div", "set-col");
  right.append(openSection, section("Activity", jobsList));
  const cols = el("div", "set-cols");
  cols.append(left, right);
  const head = el("div", "set-head");
  const keys = el("div", "set-row");
  keys.append(soundKey, key("RELOAD", () => location.reload()), exitKey, key("CLOSE", () => close(), "set-key set-go"));
  head.append(el("h1", "set-heading", "SETTINGS"), keys);
  panel.append(head, status, out, cols);
  page.append(panel);
  host.append(tag, page);

  /** The last reply, and the Box's clock minus the chain's (seconds) when it came. */
  let last: Extract<AdminReply, { enabled: true }> | null = null;
  let skew = 0;
  let readAt = 0;

  function say(message: unknown, bad = false): void {
    out.textContent = message instanceof Error ? message.message : String(message);
    out.classList.toggle("bad", bad);
  }

  async function act(send: () => Promise<AdminJob>): Promise<void> {
    try {
      const job = await send();
      say(`Sent: ${job.what}`);
    } catch (error) {
      say(error, true);
    }
    void refresh();
  }

  const openCup = (): Promise<AdminJob> =>
    postJson<AdminJob>(ADMIN.openCup, { game: pickedGame, label: cupName.value, runSeconds: run.get(), prize: prize.get() }).then((job) => {
      cupName.value = cupLabel();
      drawPlan();
      return job;
    });
  const addGame = (): Promise<AdminJob> =>
    postJson<AdminJob>(ADMIN.game, { label: newGame.value, titleTerm: term.get() }).then((job) => {
      newGame.value = gameLabel();
      return job;
    });
  const closeCup = (game: string) => (): Promise<AdminJob> => postJson<AdminJob>(ADMIN.closeCup, { game });

  function line(kind: string, what: string, when: string | HTMLElement, tone: "live" | "done" | "none", action?: HTMLElement): HTMLElement {
    const r = el("div", "set-line");
    r.dataset.tone = tone;
    const whenEl = el("span", "set-when");
    whenEl.append(when);
    r.append(el("span", "set-kind", kind), ensName(what, "set-what"), whenEl);
    if (action) r.append(action);
    return r;
  }

  function titleLine(g: AdminGame, now: number): HTMLElement {
    const t = g.title;
    const term = `TERM ${formatSeconds(g.titleTerm).toUpperCase()}`;
    if (!t.holder) return line("TITLE", "NOBODY YET · WIN A MATCH", term, "none");
    if (t.expiry <= now) return line("TITLE", `${t.name} · LAPSED, UP FOR GRABS`, term, "none");
    // The title's ENS name resolves to its holder's.
    const map = `${t.name} → ${t.holderName ?? t.holder}${t.streak > 1 ? ` ×${t.streak}` : ""}`;
    return line("TITLE", map, countdown(t.expiry), "live");
  }

  function cupLine(g: AdminGame, view: AdminView, jobs: readonly AdminJob[], now: number): HTMLElement {
    const job = jobFor(jobs, g.label);
    const c = view.cups.find((cup) => cup.game === g.label && !cup.closed);
    if (!c) return job ? line("CUP", "OPENING…", `${job.steps.length} TX SENT`, "done") : line("CUP", "NONE OPEN", "", "none");
    // The cup's ENS name resolves to its leader's.
    const leader = c.leader ? `${c.name} → ${c.leader.name ?? c.leader.address} · ${c.leader.points} PTS` : `${c.name} · NO RESULTS YET`;
    const what = `${leader}${c.prize === "0" ? "" : ` · ${c.prize} USDC`}`;
    if (c.ends > now) return line("CUP", what, countdown(c.ends), "live");
    if (job) return line("CUP", what, "CLOSING…", "done");
    const pay = key(c.prize === "0" ? "CLOSE IT" : `CLOSE & PAY ${c.prize} USDC`, () => void act(closeCup(c.game)), "set-key set-go set-pay");
    return line("CUP", what, "ENDED", "live", pay);
  }

  /** What LIVE NOW was last drawn from: it is drawn again only when that changes (a title lapsing or a cup ending
   *  included), so a name's drift and a swipe aren't reset every second; the countdowns move on their own. */
  let liveDrawn = "";
  let pickerDrawn = "";

  function drawLive(view: AdminView, jobs: readonly AdminJob[]): void {
    const now = Date.now() / 1000 - skew;
    const drawn = JSON.stringify([
      view.games.map((g) => [g, g.title.expiry <= now]),
      view.cups.map((c) => [c, c.ends <= now]),
      jobs.map((j) => [j.what, j.status, j.steps.length]),
    ]);
    if (drawn === liveDrawn) return;
    liveDrawn = drawn;
    liveList.replaceChildren(
      ...ordered(view.games).map((g) => {
        const card = el("div", "set-game");
        const top = el("div", "set-game-head");
        top.append(el("span", "set-game-name", gameWord(g.label)), ensName(g.name, "set-game-ens"));
        card.append(top, titleLine(g, now), cupLine(g, view, jobs, now));
        return card;
      }),
    );
    const past = view.cups.filter((c) => c.closed).slice(0, PAST_SHOWN);
    pastList.replaceChildren(
      ...past.map((c: AdminCup) => {
        const li = el("li", "set-item");
        li.append(
          ensName(c.name, "set-name"),
          ensName(c.winner ? `→ ${c.winnerName ?? c.winner} · FOREVER` : "NOBODY PLAYED", "set-who"),
          el("span", "set-when", `${c.prize} USDC`),
        );
        return li;
      }),
    );
    if (!past.length) pastList.replaceChildren(el("li", "set-item set-empty", "NONE YET"));
  }

  /** Step 1: the games, Quick Draw first when it is free; one with a cup open shows that cup and its time left. */
  function drawPicker(view: AdminView): void {
    const now = Date.now() / 1000 - skew;
    const games = ordered(view.games);
    const openOn = (g: AdminGame): AdminCup | undefined => view.cups.find((c) => c.game === g.label && !c.closed);
    const free = (g: AdminGame): boolean => !openOn(g);
    if (!games.some((g) => g.label === pickedGame && free(g))) {
      pickedGame = (games.find((g) => g.label === DEFAULT_GAME && free(g)) ?? games.find(free))?.label ?? "";
    }
    const drawn = JSON.stringify([pickedGame, games.map((g) => [g.label, openOn(g)?.name, (openOn(g)?.ends ?? 0) <= now])]);
    if (drawn === pickerDrawn) return drawPlan();
    pickerDrawn = drawn;
    cupGame.replaceChildren(
      ...games.map((g) => {
        const b = key("", () => {
          pickedGame = g.label;
          drawPicker(view);
        }, "set-segment set-game-pick");
        b.append(el("b", "", gameWord(g.label)));
        const taken = openOn(g);
        if (taken) {
          const when = el("small");
          when.append(taken.ends > now ? countdown(taken.ends, "OPEN · ") : "ENDED · CLOSE IT FIRST");
          b.append(ensName(taken.name, "set-taken"), when);
          b.disabled = true;
        }
        b.setAttribute("aria-pressed", String(g.label === pickedGame));
        return b;
      }),
    );
    drawPlan();
  }

  /** The cup as OPEN would make it: its full ENS name, its run, prize and end, and whether the label will do. */
  function drawPlan(): void {
    if (!pickedGame) {
      setEns(previewName, "EVERY GAME HAS A CUP OPEN: CLOSE ONE FIRST");
      preview.classList.add("bad");
      summary.textContent = "";
      openKey.disabled = true;
      return;
    }
    const label = cupName.value;
    const problem = championshipLabelProblem(label);
    setEns(previewName, championshipName(label || "…", pickedGame));
    preview.classList.toggle("bad", problem !== null);
    const runWord = RUNS.find(([, seconds]) => seconds === run.get())?.[0] ?? `${run.get()} S`;
    const ends = clockAt(Date.now() / 1000 - skew + run.get());
    const pays = prize.get() === "0" ? "NO PRIZE" : `PRIZE ${prize.get()} USDC`;
    summary.textContent = problem ? `THE NAME NEEDS ${problem.toUpperCase()}` : `OPENS FOR ${runWord} · ${pays} · ENDS AT ${ends}`;
    summary.classList.toggle("bad", problem !== null);
    openKey.disabled = problem !== null;
  }

  function drawJobs(jobs: readonly AdminJob[]): void {
    jobsList.replaceChildren(
      ...jobs.slice(0, JOBS_SHOWN).map((job) => {
        const li = el("li", "set-item");
        const state = job.status === "failed" ? `FAILED: ${job.error ?? ""}` : job.status === "running" ? "SENDING…" : "DONE";
        li.append(el("span", "set-name", job.what.toUpperCase()), el("span", "set-who", state), el("span", "set-when", `${job.steps.length} TX`));
        li.dataset.status = job.status;
        return li;
      }),
    );
    if (!jobs.length) jobsList.replaceChildren(el("li", "set-item set-empty", "NOTHING SENT YET"));
  }

  function drawStatus(): void {
    if (!last) return;
    const v = last.view;
    const ago = readAt ? Math.max(0, Math.round((Date.now() - readAt) / 1000)) : null;
    status.textContent = [
      `ADMIN ${playerWord(null, last.address)}`,
      v && `${Number(v.eth).toFixed(3)} ETH`,
      v && `BLOCK ${Number(v.block).toLocaleString("en-US")}`,
      ago !== null && (ago < 2 ? "UPDATED NOW" : `UPDATED ${ago}S AGO`),
      v && !(v.roles.games && v.roles.cups) && "THIS KEY IS NO LONGER THE ADMIN",
      last.error,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  /** Each countdown on the page to its time left, as the Box's clock now says. */
  function tickCountdowns(): void {
    const now = Date.now() / 1000 - skew;
    for (const span of page.querySelectorAll<HTMLElement>(".set-countdown")) {
      span.textContent = `${span.dataset.prefix ?? ""}${timeLeft(Number(span.dataset.ends) - now)} LEFT`;
    }
  }

  /** Redraws what moves with the clock: the countdowns, a title lapsing or a cup ending, the planned cup's end and the
   *  status line's age. */
  function tick(): void {
    drawStatus();
    if (last?.view) {
      drawLive(last.view, last.jobs);
      drawPicker(last.view);
    }
    tickCountdowns();
  }

  async function refresh(): Promise<void> {
    try {
      const reply = await getJson<AdminReply>(ADMIN.status);
      if (!reply.enabled) {
        cols.hidden = true;
        status.textContent = "No admin key on this Box (EGB_ADMIN_KEY): cups and games can't be changed here.";
        return;
      }
      cols.hidden = false;
      last = reply;
      readAt = Date.now();
      drawJobs(reply.jobs);
      if (reply.view) {
        skew = Date.now() / 1000 - reply.view.now;
      } else {
        liveDrawn = "";
        liveList.replaceChildren(el("p", "set-hint", "READING SEPOLIA…"));
      }
      tick();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  let poll: ReturnType<typeof setInterval> | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined;
  function open(): void {
    page.hidden = false;
    tag.setAttribute("aria-expanded", "true");
    sound.play("ui-select");
    drawSound();
    void refresh();
    poll = setInterval(() => void refresh(), POLL_MS);
    ticker = setInterval(tick, TICK_MS);
  }
  function close(): void {
    page.hidden = true;
    tag.setAttribute("aria-expanded", "false");
    sound.play("ui-back");
    clearInterval(poll);
    clearInterval(ticker);
    disarm();
  }

  tag.addEventListener("click", () => (page.hidden ? open() : close()));
  for (const node of [tag, page]) {
    for (const type of ["pointerdown", "keydown", "keyup"] as const) node.addEventListener(type, (e) => e.stopPropagation());
  }
  page.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}
