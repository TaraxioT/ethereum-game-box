// The screen's end of screen/seats.test.ts, in a real browser: the real shell, views and parts on a stand-in for the Box's
// link, with 2, 3 or 4 seats on each page. `?scene=` draws one scene and says what it found overlapping; with no scene the
// page plays every scene, at each screen's size, each in a frame of that size, and reports them all. Nothing in the screen
// imports this.
import "./fonts.css";
import "./tokens.css";
import "./shell/shell.css";
import "./views/views.css";
import { stationView, type Seat, type Seated } from "@egb/sdk";
import { TEAM_GAMES } from "../core/catalogue.ts";
import type { BoxLink, BoxState, GameInfo, Judged, Match, MatchPlay, Phase, SeatState, Tx } from "../core/types.ts";
import { registerParts } from "./parts/register.ts";
import { startApp } from "./shell/app.ts";
import { routes } from "./views/routes.ts";
import type { Sound } from "./views/view.ts";

/** One screen, as the test and a person looking at it ask for it: its phase, the seats on show and who sits in them. */
export interface Scene {
  readonly phase: Phase;
  /** Seats on show. */
  readonly seats: number;
  /** The seats with a badge. */
  readonly players: readonly Seat[];
  /** The verifier's word, on `result`: a split, or a refund. */
  readonly refunded?: boolean;
}

/** What a scene found: pairs of things on top of each other, and things sticking out of what holds them. */
export interface SceneReport {
  readonly scene: string;
  readonly size: string;
  readonly seats: number;
  /** How many seat panels stood on the page. */
  readonly panels: number;
  readonly problems: readonly string[];
}

const NAMES = ["nova", "kite", "juno", "orion-the-long-named"];
const ADDRESSES = ["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222", "0x3333333333333333333333333333333333333333", "0x4444444444444444444444444444444444444444"] as const;
const BUNDLE = `0x${"ab".repeat(32)}` as const;
const NOW = Date.now();
const FAR = NOW + 3_600_000;

const SIZES = [
  { name: "pi", w: 1280, h: 720 },
  { name: "demo", w: 1280, h: 800 },
  { name: "portrait", w: 720, h: 1080 },
] as const;

const PAGES: readonly Phase[] = ["join", "stake", "playing", "judging", "result", "refund", "lobby"];

/** Every page with every way of filling it that a match can have. */
function scenes(): Scene[] {
  const fills: readonly Omit<Scene, "phase">[] = [
    { seats: 2, players: [0, 1] },
    { seats: 3, players: [0, 1, 2] },
    { seats: 4, players: [0, 1, 2] },
    { seats: 4, players: [0, 1, 2, 3] },
    { seats: 4, players: [0, 2, 3] },
    { seats: 4, players: [0, 2] },
  ];
  return [...PAGES.flatMap((phase) => fills.map((fill) => ({ phase, ...fill }))), { phase: "join", seats: 4, players: [] }, { phase: "result", seats: 4, players: [0, 1, 2, 3], refunded: true }];
}

const sceneKey = (scene: Scene): string => `${scene.phase}-${scene.seats}of${scene.players.join("")}${scene.refunded ? "-refunded" : ""}`;

const tapRush = (seats: number): GameInfo => ({ id: "tap-rush", kind: "store", title: "Tap Rush", players: seats, minPlayers: 2, minutes: 0, stakes: [5, 10, 25], tier: "judged", ready: true, sealed: null, icon: null, manifest: null, bundle: BUNDLE });

function seatOf(scene: Scene, seat: number): SeatState {
  const taken = scene.players.some((player) => player === seat);
  const name = NAMES[seat] ?? "";
  return {
    badge: taken ? { address: ADDRESSES[seat as Seat], name } : null,
    ens: taken ? `${name}.gamebox.eth` : null,
    balance: taken ? (seat === 1 ? 5 : 100) : null,
    pending: 0,
    signed: scene.phase === "stake" && seat === 0,
    record: null,
  };
}

function judged(scene: Scene): Judged {
  const pot = 10 * scene.players.length;
  const first = pot - 5 * (scene.players.length - 1);
  if (scene.refunded) return { step: "refunded", payouts: null, hash: null, etherscan: null, reason: "the verifier couldn't judge this match" };
  return { step: "paid", payouts: scene.players.map((_, i) => (i === 0 ? first : 5)), hash: BUNDLE, etherscan: null, reason: null };
}

function matchOf(scene: Scene): Match | null {
  if (scene.phase === "join" || scene.phase === "stake") return null;
  const count = scene.players.length;
  const play: MatchPlay = {
    game: "store",
    id: "tap-rush",
    title: "Tap Rush",
    bundle: BUNDLE,
    taps: "identify",
    endsAt: FAR,
    lines: scene.players.map(() => "PLAY"),
    judged: scene.phase === "result" ? judged(scene) : null,
    resultAt: scene.phase === "result" ? NOW : null,
  };
  return {
    id: 1,
    game: "tap-rush",
    playFor: "usdc",
    round: 7,
    stake: 10,
    openedBlock: 100,
    refundAt: FAR,
    play,
    outcome: scene.phase === "playing" ? null : { winner: null },
    voided: false,
    endedAt: scene.phase === "playing" ? null : NOW,
    refunded: scene.players.map(() => false),
    lines: null,
  };
}

function stateOf(scene: Scene): BoxState {
  const game = tapRush(scene.seats);
  const seats = Array.from({ length: scene.seats }, (_, seat) => seatOf(scene, seat)) as unknown as Seated<SeatState>;
  const view = stationView("", "", "");
  const open: Tx = { id: 1, kind: "open", seat: null, direction: "in", amount: 10 * scene.players.length, step: "in-block", block: 123, hash: BUNDLE, etherscan: null, error: null, stepAt: NOW };
  return {
    phase: scene.phase,
    games: [...TEAM_GAMES, game],
    focus: game.id,
    seats,
    fewest: Math.min(2, scene.seats),
    chain: { block: 9_800_123, blockAt: NOW, blockMs: 12_000, gasGwei: 1.2 },
    fetching: false,
    stake: 10,
    playFor: "usdc",
    board: null,
    boards: {},
    taps: [null, null],
    match: matchOf(scene),
    txs: scene.phase === "stake" ? [open] : [],
    lobby: { badge: null, card: null, proposal: null, from: "home" },
    stations: [view, view],
  };
}

function standIn(state: BoxState): BoxLink {
  return { state: () => state, now: () => Date.now(), subscribe: () => () => {}, send() {} };
}

const SILENT: Sound = { play() {}, music() {}, duck() {}, muted: true, setMuted() {} };

interface Box {
  readonly name: string;
  readonly rect: DOMRect;
}

const boxes = (selector: string, name: (node: HTMLElement, i: number) => string): Box[] =>
  [...document.querySelectorAll<HTMLElement>(selector)].filter((node) => node.getClientRects().length > 0).map((node, i) => ({ name: name(node, i), rect: node.getBoundingClientRect() }));

/** More than a hairline of `a` lies over `b`. */
function overlaps(a: DOMRect, b: DOMRect): boolean {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
}

/** What's on top of what, and what sticks out of its seat panel. */
function problems(): string[] {
  const found: string[] = [];
  const parts = [
    ...boxes(".view .seat-panel", (node) => `panel ${node.dataset.seat}`),
    ...boxes(".view .page-plate", () => "plate"),
    ...boxes(".view egb-key", (node) => `key ${node.textContent}`),
    ...boxes("egb-port", (node) => `port ${node.dataset.seat}`),
    ...boxes("egb-clock", () => "clock"),
    ...boxes("egb-gauge", () => "gauge"),
  ];
  parts.forEach((a, i) => {
    for (const b of parts.slice(i + 1)) if (overlaps(a.rect, b.rect)) found.push(`${a.name} overlaps ${b.name}`);
  });
  const holders = [...document.querySelectorAll<HTMLElement>(".view :is(.seat-panel, .page-plate)")];
  for (const holder of holders) {
    const frame = holder.getBoundingClientRect();
    for (const part of holder.querySelectorAll<HTMLElement>(":scope > :is(div, span, ul)")) {
      const r = part.getBoundingClientRect();
      if (r.height === 0 || !part.textContent) continue;
      if (r.left < frame.left - 1 || r.right > frame.right + 1 || r.top < frame.top - 1 || r.bottom > frame.bottom + 1) found.push(`${part.className} sticks out of ${holder.className}`);
    }
  }
  return found;
}

/** Past the views' rez, so what's measured is what stands. */
const SETTLE_MS = 900;
const FRAMES_AT_ONCE = 6;

/** The faces a page measures itself in: on a real Box they have long loaded by the time a page opens. */
const FACES = ['700 40px "Syncopate"', '600 18px "Oxanium Variable"', '700 18px "JetBrains Mono"'];

async function showScene(scene: Scene): Promise<void> {
  await Promise.all(FACES.map((face) => document.fonts.load(face)));
  registerParts();
  startApp(document.body, { link: standIn(stateOf(scene)), sound: SILENT, routes });
  setTimeout(() => window.parent.postMessage({ scene: sceneKey(scene), panels: document.querySelectorAll(".view .seat-panel").length, problems: problems() }, "*"), SETTLE_MS);
}

/** Draws a scene in a frame of the screen's size, and hears what it found. */
function play(scene: Scene, size: (typeof SIZES)[number]): Promise<SceneReport> {
  const frame = document.createElement("iframe");
  frame.width = String(size.w);
  frame.height = String(size.h);
  frame.src = `?scene=${encodeURIComponent(JSON.stringify(scene))}`;
  return new Promise((resolve) => {
    const heard = (event: MessageEvent<Omit<SceneReport, "size" | "seats">>): void => {
      if (event.source !== frame.contentWindow) return;
      window.removeEventListener("message", heard);
      frame.remove();
      resolve({ ...event.data, size: size.name, seats: scene.seats });
    };
    window.addEventListener("message", heard);
    document.body.append(frame);
  });
}

/** Every scene at every size, a few frames at a time. */
async function playAll(): Promise<void> {
  const todo = SIZES.flatMap((size) => scenes().map((scene) => ({ scene, size })));
  const reports: SceneReport[] = [];
  const worker = async (): Promise<void> => {
    for (let next = todo.shift(); next; next = todo.shift()) reports.push(await play(next.scene, next.size));
  };
  await Promise.all(Array.from({ length: FRAMES_AT_ONCE }, worker));
  await fetch("/api/report", { method: "POST", body: JSON.stringify(reports) });
}

const asked = new URLSearchParams(location.search).get("scene");
if (asked) void showScene(JSON.parse(asked) as Scene);
else void playAll();
