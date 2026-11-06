// The Settings page, on the kiosk's own page only (the one the Box gave its launcher token). A gear in the window's
// top-left corner (clear of the ports and the rack) opens it over the stage; CLOSE, Escape or the tag again shut it. It fits one screen with
// no scrolling, down to the Pi's 1280×720 (touch can't be trusted to scroll a kiosk):
// - The head: sound on or off, reload the screen, and EXIT TO DESKTOP (a first tap arms it, a second asks the Box to
//   close the kiosk's browser, POST /api/box/exit; the Box keeps running).
// - Two columns, CHAMPIONSHIPS and GAMES with JOBS (with EGB_ADMIN_KEY on the Box, as gamebox.eth's admin, `/api/admin/…`): open a
//   championship on a game for a few minutes with a prize, close one that has ended, and add a game with its title.
//   Presets for every choice, since the kiosk has no keyboard; the labels are made up and can be typed over.
// None of its pointer or key events reach the stage.
import "./kiosk.css";
import { formatSeconds } from "@egb/shared/admin";
import { ADMIN, type AdminCup, type AdminJob, type AdminReply, type AdminView } from "../../server/admin-wire.ts";
import { framed } from "../parts/frame.ts";
import { el } from "../shell/dom.ts";
import { BuilderError, getJson, hasLauncherToken, postJson } from "../views/builder-link.ts";
import type { Sound } from "../views/view.ts";
import { playerWord } from "../views/board.ts";

const CHAMFER = 10;
const ARMED_MS = 4_000;
const POLL_MS = 3_000;
const JOBS_SHOWN = 3;
/** Championships listed: the open ones, then the latest closed, up to this many. */
const CUPS_SHOWN = 4;

const RUNS = [
  ["2 MIN", 120],
  ["5 MIN", 300],
  ["15 MIN", 900],
  ["1 HOUR", 3_600],
] as const;
const PRIZES = ["0", "10", "50", "100"] as const;
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
function segments<T>(choices: readonly (readonly [string, T])[], start: T, onPick: (value: T) => void = () => undefined) {
  const row = el("div", "set-segments");
  let value = start;
  const buttons = choices.map(([label, v]) => {
    const b = key(label, () => {
      value = v;
      sync();
      onPick(v);
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

/** A made-up label: `cup-1907`, `game-k3x9`. */
const cupLabel = (): string => `cup-${new Date().toTimeString().slice(0, 5).replace(":", "")}`;
const gameLabel = (): string => `game-${Math.random().toString(36).slice(2, 6)}`;

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

  // --- Championships ---
  const cupGame = el("div", "set-segments");
  let pickedGame = "";
  const cupName = field("championship label", cupLabel());
  const run = segments(RUNS, 300);
  const prize = segments(PRIZES.map((p) => [p === "0" ? "NO PRIZE" : `${p} USDC`, p] as const), "0");
  const cupsList = el("ul", "set-list");
  const cupsSection = section(
    "Championships",
    el("p", "set-hint", "Every result on the game scores it: win 3, draw 1. Close it once it ends to pay the winner."),
    row(el("span", "set-label", "GAME"), cupGame),
    row(el("span", "set-label", "RUNS"), run.row),
    row(el("span", "set-label", "PRIZE"), prize.row),
    row(el("span", "set-label", "NAME"), cupName, key("OPEN", () => void act(openCup), "set-key set-go")),
    cupsList,
  );

  // --- Games and titles ---
  const gamesList = el("ul", "set-list");
  const newGame = field("game label", gameLabel());
  const term = segments(TERMS, 120);
  const gamesSection = section(
    "Games and titles",
    el("p", "set-hint", "Each win takes the game's title; it lapses after its term. A game added stays for good."),
    gamesList,
    row(el("span", "set-label", "TITLE TERM"), term.row),
    row(el("span", "set-label", "NEW GAME"), newGame, key("ADD GAME", () => void act(addGame), "set-key set-go")),
  );

  const jobsList = el("ul", "set-list set-jobs");
  const right = el("div", "set-col");
  right.append(gamesSection, section("Jobs", jobsList));
  const cols = el("div", "set-cols");
  cols.append(cupsSection, right);
  const head = el("div", "set-head");
  const keys = el("div", "set-row");
  keys.append(soundKey, key("RELOAD", () => location.reload()), exitKey, key("CLOSE", () => close(), "set-key set-go"));
  head.append(el("h1", "set-heading", "SETTINGS"), keys);
  panel.append(head, status, out, cols);
  page.append(panel);
  host.append(tag, page);

  function say(message: unknown, bad = false): void {
    out.textContent = message instanceof Error ? message.message : String(message);
    out.classList.toggle("bad", bad);
  }

  async function act(run: () => Promise<AdminJob>): Promise<void> {
    try {
      const job = await run();
      say(`Sent: ${job.what}`);
    } catch (error) {
      say(error, true);
    }
    void refresh();
  }

  const openCup = (): Promise<AdminJob> =>
    postJson<AdminJob>(ADMIN.openCup, { game: pickedGame, label: cupName.value, runSeconds: run.get(), prize: prize.get() }).then((job) => {
      cupName.value = cupLabel();
      return job;
    });
  const addGame = (): Promise<AdminJob> =>
    postJson<AdminJob>(ADMIN.game, { label: newGame.value, titleTerm: term.get() }).then((job) => {
      newGame.value = gameLabel();
      return job;
    });

  function drawGames(view: AdminView): void {
    const labels = view.games.map((g) => g.label);
    if (!labels.includes(pickedGame)) pickedGame = labels[0] ?? "";
    cupGame.replaceChildren(
      ...labels.map((label) => {
        const b = key(label.toUpperCase(), () => {
          pickedGame = label;
          drawGames(view);
        }, "set-segment");
        b.setAttribute("aria-pressed", String(label === pickedGame));
        return b;
      }),
    );
    gamesList.replaceChildren(
      ...view.games.map((g) => {
        const t = g.title;
        const holder = t.holder ? `${playerWord(t.holderName, t.holder)}${t.streak > 1 ? ` ×${t.streak}` : ""}` : "NO CHAMPION YET";
        const when = !t.holder ? "" : t.expiry > view.now ? `${formatSeconds(t.expiry - view.now)} left` : "lapsed";
        return item(g.label.toUpperCase(), holder, `${when}${when ? " · " : ""}term ${formatSeconds(g.titleTerm)}`);
      }),
    );
  }

  function drawCups(view: AdminView): void {
    const shown = [...view.cups.filter((c) => !c.closed), ...view.cups.filter((c) => c.closed)].slice(0, CUPS_SHOWN);
    cupsList.replaceChildren(
      ...shown.map((c: AdminCup) => {
        const ended = c.ends <= view.now;
        const who = c.closed
          ? c.winner ? `WON BY ${playerWord(c.winnerName, c.winner)}` : "NOBODY PLAYED"
          : c.leader ? `${playerWord(c.leader.name, c.leader.address)} LEADS, ${c.leader.points} PTS` : "NO GAMES YET";
        const when = c.closed ? "closed" : ended ? "ended" : `${formatSeconds(c.ends - view.now)} left`;
        const li = item(`${c.label.toUpperCase()} · ${c.game.toUpperCase()}`, who, `${when} · ${c.prize} USDC`);
        if (!c.closed && ended) li.append(key("CLOSE & PAY", () => void act(() => postJson<AdminJob>(ADMIN.closeCup, { game: c.game })), "set-key set-go"));
        return li;
      }),
    );
    if (!shown.length) cupsList.replaceChildren(item("NONE YET", "", ""));
  }

  function drawJobs(jobs: readonly AdminJob[]): void {
    jobsList.replaceChildren(
      ...jobs.slice(0, JOBS_SHOWN).map((job) => {
        const li = item(job.what, job.status === "failed" ? `FAILED: ${job.error ?? ""}` : job.status.toUpperCase(), `${job.steps.length} tx`);
        li.dataset.status = job.status;
        return li;
      }),
    );
    if (!jobs.length) jobsList.replaceChildren(item("NOTHING SENT YET", "", ""));
  }

  function item(name: string, who: string, when: string): HTMLLIElement {
    const li = el("li", "set-item");
    li.append(el("span", "set-name", name), el("span", "set-who", who), el("span", "set-when", when));
    return li;
  }

  async function refresh(): Promise<void> {
    try {
      const reply = await getJson<AdminReply>(ADMIN.status);
      if (!reply.enabled) {
        cols.hidden = true;
        status.textContent = "No admin key on this Box (EGB_ADMIN_KEY): championships and games can't be changed here.";
        return;
      }
      cols.hidden = false;
      const v = reply.view;
      status.textContent = [
        `ADMIN ${playerWord(null, reply.address)}`,
        v && `${Number(v.eth).toFixed(3)} ETH`,
        v && `BLOCK ${v.block}`,
        v && !(v.roles.games && v.roles.cups) && "THIS KEY IS NO LONGER THE ADMIN",
        reply.error,
      ]
        .filter(Boolean)
        .join(" · ");
      drawJobs(reply.jobs);
      if (v) {
        drawGames(v);
        drawCups(v);
      }
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  let poll: ReturnType<typeof setInterval> | undefined;
  function open(): void {
    page.hidden = false;
    tag.setAttribute("aria-expanded", "true");
    sound.play("ui-select");
    drawSound();
    void refresh();
    poll = setInterval(() => void refresh(), POLL_MS);
  }
  function close(): void {
    page.hidden = true;
    tag.setAttribute("aria-expanded", "false");
    sound.play("ui-back");
    clearInterval(poll);
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
