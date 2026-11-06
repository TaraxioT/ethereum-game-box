// The sound board: a developer's page for hearing every sound on the Box's own speaker, one at a time or all in a row,
// each by its name in plain words with what it means and what it should sound like. A seat's sound plays for Player 1
// and then Player 2; a rising one climbs. It is the page at `#sounds`, reached from the Box's screen by holding the
// block clock for two seconds (`bindBoardHold`), and its BACK key returns to the Box.
import "./board.css";
import type { Sound } from "../views/view.ts";
import { SOUNDS, type SoundEntry, type SoundGroup } from "./catalogue.ts";

export const BOARD_HASH = "#sounds";
/** How long the block clock is held to open the board. */
const HOLD_MS = 2000;

const GROUPS: readonly [SoundGroup, string][] = [
  ["badge", "Badge taps"],
  ["game", "In the games"],
  ["screen", "Screen touches"],
  ["box", "The Box"],
];

/** How long to leave after each sound before the next, for the ones that ring on. */
const LONG: Readonly<Partial<Record<string, number>>> = { boot: 3200, over: 2400, "round-won": 1200, round: 1000, land: 1100 };
const GAP_MS = 750;
const SEAT_GAP_MS = 550;
const RISE_STEPS = 6;
const RISE_MS = 110;

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Plays a sound as the board does: both seats in turn, or climbing. Resolves when it has rung out. */
async function audition(sound: Sound, entry: SoundEntry, cancelled: () => boolean): Promise<void> {
  const rest = LONG[entry.name] ?? GAP_MS;
  if (entry.rising) {
    for (let k = 0; k < RISE_STEPS && !cancelled(); k++) {
      sound.play(entry.name, { pitch: k / (RISE_STEPS - 1) });
      await wait(RISE_MS);
    }
  } else if (entry.seated) {
    sound.play(entry.name, { seat: 0 });
    await wait(Math.max(SEAT_GAP_MS, rest));
    if (cancelled()) return;
    sound.play(entry.name, { seat: 1 });
  } else sound.play(entry.name);
  await wait(rest);
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function mountSoundBoard(host: HTMLElement, sound: Sound): void {
  const page = node("main", "board");
  const head = node("header", "board-head");
  const title = node("h1", "board-title", "SOUND BOARD");
  const now = node("p", "board-now", "Tap a sound to hear it, or PLAY ALL.");
  const controls = node("div", "board-controls");
  const all = node("button", "board-key primary", "PLAY ALL");
  const music = node("button", "board-key", "MUSIC");
  const duck = node("button", "board-key", "DUCK");
  const mute = node("button", "board-key", "");
  const back = node("button", "board-key ghost", "BACK TO THE BOX");
  controls.append(all, music, duck, mute, back);
  head.append(title, now, controls);
  page.append(head);

  const rows = new Map<string, HTMLElement>();
  for (const [group, label] of GROUPS) {
    const section = node("section", "board-group");
    section.append(node("h2", "board-group-title", label));
    for (const entry of SOUNDS.filter((e) => e.group === group)) {
      const row = node("button", "board-sound");
      row.append(
        node("b", "board-sound-label", entry.label),
        node("code", "board-sound-name", entry.name),
        node("span", "board-sound-meaning", entry.meaning),
        node("span", "board-sound-like", entry.sounds),
      );
      row.addEventListener("click", () => void hear([entry]));
      rows.set(entry.name, row);
      section.append(row);
    }
    page.append(section);
  }
  host.replaceChildren(page);

  /** Bumped by every new run: an older run stops at its next step. */
  let run = 0;
  async function hear(entries: readonly SoundEntry[]): Promise<void> {
    const mine = ++run;
    const cancelled = () => mine !== run;
    all.textContent = entries.length > 1 ? "STOP" : "PLAY ALL";
    for (const [i, entry] of entries.entries()) {
      if (cancelled()) return;
      for (const [name, row] of rows) row.classList.toggle("playing", name === entry.name);
      rows.get(entry.name)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const count = entries.length > 1 ? `${i + 1} / ${entries.length} · ` : "";
      now.textContent = `${count}${entry.label}${entry.seated ? " — Player 1, then Player 2" : ""}`;
      await audition(sound, entry, cancelled);
    }
    if (cancelled()) return;
    for (const row of rows.values()) row.classList.remove("playing");
    all.textContent = "PLAY ALL";
    now.textContent = entries.length > 1 ? "That was every sound." : now.textContent;
  }

  all.addEventListener("click", () => {
    if (all.textContent === "STOP") {
      run++;
      all.textContent = "PLAY ALL";
      for (const row of rows.values()) row.classList.remove("playing");
      now.textContent = "Stopped.";
    } else void hear(SOUNDS);
  });

  let musicOn = false;
  let ducked = false;
  const drawSwitches = (): void => {
    music.classList.toggle("on", musicOn);
    duck.classList.toggle("on", ducked);
    mute.textContent = sound.muted ? "MUTED" : "SOUND ON";
    mute.classList.toggle("alert", sound.muted);
  };
  music.addEventListener("click", () => {
    musicOn = !musicOn;
    sound.music(musicOn);
    drawSwitches();
  });
  duck.addEventListener("click", () => {
    ducked = !ducked;
    sound.duck(ducked);
    drawSwitches();
  });
  mute.addEventListener("click", () => {
    sound.setMuted(!sound.muted);
    drawSwitches();
  });
  back.addEventListener("click", () => {
    history.replaceState(null, "", location.pathname + location.search);
    location.reload();
  });
  drawSwitches();
}

/** Holding the block clock for two seconds opens the sound board. */
export function bindBoardHold(area: HTMLElement): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => clearTimeout(timer);
  area.addEventListener("pointerdown", (e) => {
    if (!(e.target instanceof Element) || !e.target.closest("egb-clock")) return;
    cancel();
    timer = setTimeout(() => {
      location.hash = BOARD_HASH;
      location.reload();
    }, HOLD_MS);
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"] as const) area.addEventListener(type, cancel);
}
