// <egb-port seat="0|1">: a player's node in a top corner of the Box. A round socket of light in the seat's colour
// (Player 1 orange, Player 2 cyan) holding the badge's blockie as a lit 8 × 8 LED grid, the badge's name reading away
// from it, the balance under the name, and a seat-colour underline running out from the socket under both. Seat 0
// reads rightwards from its socket at the left; seat 1 mirrors it.
//
// Size: the module fills its box (designed at 380 × 96, the socket's centre 52 px in from its outer side and halfway
// down). `compact`: the in-game overlay, drawn at 70 % from its top outer corner. `key="A|L"` (Demo mode): a key hint
// in the inner bottom corner, and hover lifts the socket. `bot`: a small BOT tag (the bot holds this seat).
//
// `set(seat)` draws a seat. A badge arriving rezzes the socket and the name; leaving derezzes the name and drops the
// socket to 25 %. Changed balance digits flicker in. `pulse()`: the socket's bloom flashes once (a tap). `refuse()`:
// the module shakes and the socket flashes red (a tap that meant nothing here).
import { playerName } from "../../core/badges.ts";
import type { SeatState } from "../../core/types.ts";
import { blockieLedSvg } from "./blockie.ts";
import { setDigits } from "./digits.ts";
import { motion, pick, shadow, sheet } from "./part.ts";
import { derez, rez } from "../shell/rez.ts";

const styles = sheet(`
:host {
  display: block; position: relative; width: 380px; height: 96px; container-type: size;
  --seat: var(--p1); --seat-bloom: var(--p1-bloom);
}
:host([seat="1"]) { --seat: var(--p2); --seat-bloom: var(--p2-bloom); }
:host([key]) { cursor: pointer; }
.port {
  --p: calc(100cqh / 96);
  position: absolute; inset: 0; transform-origin: 0 0; transition: transform var(--t-move) var(--ease-out);
}
:host([seat="1"]) .port { direction: rtl; transform-origin: 100% 0; }
:host([compact]) .port { transform: scale(0.7); }

/* The socket: a circle of seat-colour light, 25 % while empty, full with its bloom once a badge is seated, inside a
   dial of fine seat-colour ticks. */
.socket {
  position: absolute; inset-inline-start: calc(22 * var(--p)); top: calc(18 * var(--p));
  width: calc(60 * var(--p)); height: calc(60 * var(--p)); display: grid; place-items: center;
}
.socket > i { position: absolute; inset: 0; border-radius: 50%; }
.ring { border: 2px solid var(--seat); opacity: 0.25; transition: opacity 200ms linear; background: radial-gradient(circle, color-mix(in srgb, var(--seat) 14%, transparent), transparent 70%); }
.dial {
  inset: calc(-7 * var(--p)) !important; opacity: 0.35;
  background: repeating-conic-gradient(var(--seat) 0 1.2deg, transparent 1.2deg 10deg);
  -webkit-mask: radial-gradient(circle, transparent calc(50% - 4px), #000 calc(50% - 4px));
  mask: radial-gradient(circle, transparent calc(50% - 4px), #000 calc(50% - 4px));
}
.port.seated .dial { opacity: 0.7; }
.ring::after { content: ""; position: absolute; inset: -1.5px; border-radius: 50%; border: 1px solid color-mix(in srgb, var(--seat) 35%, var(--sys-hot)); }
.glow { box-shadow: 0 0 6px var(--seat-bloom), 0 0 16px var(--seat-bloom), inset 0 0 8px var(--seat-bloom); opacity: 0; transition: opacity 200ms linear; }
.flash { box-shadow: 0 0 0 2px var(--seat), 0 0 10px var(--seat), 0 0 22px var(--seat-bloom), inset 0 0 12px var(--seat-bloom); opacity: 0; }
.alarm { box-shadow: 0 0 0 2px var(--alert), 0 0 12px var(--alert), inset 0 0 10px var(--alert); opacity: 0; }
/* A tap's flash and a refusal's alarm keep their layers: lifted onto one only while they flash, they make the Pi's
   GPU raster the wide top of the screen again as the flash starts and as it ends (a 66–100 ms frame per tap). */
.flash, .alarm { will-change: opacity; }
.port.seated .ring, .port.seated .glow { opacity: 1; }
:host([key]:hover) .ring { opacity: 1; }
.face { position: relative; width: calc(40 * var(--p)); height: calc(40 * var(--p)); }
.face svg { display: block; width: 100%; height: 100%; }
.face .c0 { fill: color-mix(in srgb, var(--seat) 9%, transparent); }
.face .c1 { fill: var(--seat); }
.face .c2 { fill: color-mix(in srgb, var(--seat) 45%, var(--sys-hot)); }

/* The name over the balance, reading away from the socket. */
.info {
  position: absolute; inset-inline-start: calc(98 * var(--p)); inset-inline-end: calc(8 * var(--p)); top: calc(14 * var(--p));
  display: flex; flex-direction: column; align-items: flex-start; gap: calc(4 * var(--p));
}
.name {
  max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; direction: ltr;
  font: 600 max(11px, calc(24 * var(--p) * var(--fit, 1))) / 1.15 var(--hud-body); letter-spacing: 0.02em; color: var(--fg);
}
.name span { color: var(--fg-3); }
.tap { display: none; margin-top: calc(10 * var(--p)); font: 600 max(14px, calc(20 * var(--p))) / 1.15 var(--hud-body); letter-spacing: 0.08em; color: var(--fg-4); }
.bal { direction: ltr; display: flex; align-items: baseline; gap: 0.3em; white-space: nowrap; }
/* Its own layer, like the clock's digits: a payout's digits flicker in without the GPU rastering the port round them. */
.num { will-change: transform; font: 700 max(14px, calc(22 * var(--p))) / 1 var(--mono); font-variant-numeric: tabular-nums; color: var(--fg); }
.unit { font: 600 max(14px, calc(14 * var(--p))) / 1 var(--hud-body); letter-spacing: 0.08em; color: var(--fg-3); }
.port:not(.seated) :is(.name, .bal) { display: none; }
.port:not(.seated) .tap { display: block; }

/* The underline: out from the socket under the name and balance, ending in a tick. */
.underline {
  position: absolute; inset-inline-start: calc(82 * var(--p)); inset-inline-end: calc(36 * var(--p)); top: calc(84 * var(--p)); height: 1px;
  background: linear-gradient(to var(--run, right), var(--seat), color-mix(in srgb, var(--seat) 50%, transparent));
  opacity: 0.3; transition: opacity 200ms linear;
}
:host([seat="1"]) .underline { --run: left; }
.underline::before {
  content: ""; position: absolute; inset-inline-start: 0; top: -1px; width: calc(48 * var(--p)); height: 3px;
  background: var(--seat); box-shadow: 0 0 6px var(--seat-bloom);
}
.underline::after { content: ""; position: absolute; inset-inline-end: 0; bottom: 0; width: 1px; height: 6px; background: var(--seat); }
.port.seated .underline { opacity: 0.9; }

/* Demo mode's key hint, and the bot's tag. */
.hint {
  display: none; position: absolute; inset-inline-end: calc(4 * var(--p)); bottom: calc(4 * var(--p)); width: 20px; height: 20px;
  place-items: center; border: 1px solid var(--fg-3); font: 700 14px/1 var(--mono); color: var(--fg-2);
}
:host([key]) .hint { display: grid; }
.bot { display: none; position: absolute; inset-inline-end: calc(4 * var(--p)); top: calc(6 * var(--p)); font: 600 14px/1 var(--hud-body); letter-spacing: 0.08em; color: var(--fg-3); }
:host([bot]) .bot { display: block; }
`);

export class EgbPort extends HTMLElement {
  static readonly observedAttributes = ["key"];
  readonly #port: HTMLElement;
  readonly #socket: HTMLElement;
  readonly #flash: HTMLElement;
  readonly #alarm: HTMLElement;
  readonly #face: HTMLElement;
  readonly #name: HTMLElement;
  readonly #num: HTMLElement;
  readonly #hint: HTMLElement;
  /** The seated badge's address; undefined until the first `set`, which draws without animating. */
  #address: string | null | undefined;

  constructor() {
    super();
    const root = shadow(
      this,
      styles,
      `<div class="port">
        <div class="socket"><i class="dial"></i><i class="ring"></i><i class="glow"></i><i class="flash"></i><i class="alarm"></i><div class="face"></div></div>
        <div class="info"><div class="name"></div><div class="tap">TAP BADGE</div><div class="bal"><span class="num"></span><span class="unit">USDC</span></div></div>
        <i class="underline"></i><span class="hint" aria-hidden="true"></span><span class="bot">BOT</span>
      </div>`,
    );
    this.#port = pick(root, ".port");
    this.#socket = pick(root, ".socket");
    this.#flash = pick(root, ".flash");
    this.#alarm = pick(root, ".alarm");
    this.#face = pick(root, ".face");
    this.#name = pick(root, ".name");
    this.#num = pick(root, ".num");
    this.#hint = pick(root, ".hint");
  }

  attributeChangedCallback(_name: string, _old: string | null, value: string | null): void {
    this.#hint.textContent = value ?? "";
  }

  set(seat: SeatState): void {
    const address = seat.badge?.address ?? null;
    const first = this.#address === undefined;
    // The player's ENS name once read from chain (`nova.gamebox.eth`), else the badge's own label.
    const name = seat.badge ? playerName(seat.badge, seat.ens) : "";
    if (this.#name.title !== name) {
      this.#name.replaceChildren(...nameParts(name));
      this.#name.title = name;
      requestAnimationFrame(() => fitName(this.#name));
    }
    // A balance not read from chain yet shows as an ellipsis.
    const balance = seat.balance === null ? "…" : seat.balance.toLocaleString("en-US", { maximumFractionDigits: 2 });
    setDigits(this.#num, seat.badge ? balance : "", !first && address === this.#address);
    this.setAttribute("aria-label", seat.badge ? `${seat.ens ?? seat.badge.name}, ${balance} USDC` : "empty seat, tap a badge");
    if (address === this.#address) return;
    this.#address = address;
    if (address) {
      this.#face.innerHTML = blockieLedSvg(address, 40);
      this.#port.classList.add("seated");
      if (!first) {
        void rez(this.#socket);
        void rez(this.#name);
      }
    } else if (first) {
      this.#port.classList.remove("seated");
    } else {
      void derez(this.#name).then(() => {
        if (this.#address !== null) return;
        this.#port.classList.remove("seated");
        this.#face.innerHTML = "";
      });
    }
  }

  /** The socket's bloom flashes once: a tap at this seat's station. */
  pulse(): void {
    motion(this.#flash, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: 260, easing: "ease-out" });
  }

  /** The module shakes and the socket flashes red once: the tap meant nothing here. */
  refuse(): void {
    motion(this.#port, [0, -5, 5, -3, 3, 0].map((x) => ({ translate: `${x}px 0` })), { duration: 220, easing: "ease-out" });
    // The flash shows even under reduced motion: it is the only sign the tap was refused.
    this.#alarm.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: 320, easing: "ease-out" });
  }
}

/** A long name is never cut short: its font shrinks until the whole name fits the port. */
function fitName(name: HTMLElement): void {
  name.style.removeProperty("--fit");
  if (name.clientWidth === 0 || name.scrollWidth <= name.clientWidth) return;
  name.style.setProperty("--fit", ((name.clientWidth - 1) / name.scrollWidth).toFixed(3));
}

/** `nova.gamebox.eth` → the badge's own label bright, the rest of the name quieter. */
function nameParts(name: string): Node[] {
  const dot = name.indexOf(".");
  if (dot < 0) return [document.createTextNode(name)];
  const rest = document.createElement("span");
  rest.textContent = name.slice(dot);
  return [document.createTextNode(name.slice(0, dot)), rest];
}
