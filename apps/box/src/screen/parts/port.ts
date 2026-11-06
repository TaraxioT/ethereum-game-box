// <egb-port seat="0|1">: a player's port in a top corner of the Box. A gunmetal socket holding a neon ring (Player 1
// orange, Player 2 cyan), a gunmetal tile whose LED matrix shows the badge's blockie in the seat's neon, the badge's
// name, and its balance on an amber seven-segment LCD with an EGB legend. Seat 0 reads rightwards from its ring at the
// left; seat 1 mirrors it, its ring at the outer right.
//
// Size: the module fills its box (designed at 380 × 96, the ring's centre 52 px in from its outer side and halfway
// down). `compact`: the in-game overlay, the module drawn at 70 % from its top outer corner.
//
// `set(seat)` draws a seat. Empty: a dark socket, the ring unlit, an engraved TAP BADGE where the name goes. When a
// badge arrives the ring powers on (a short neon flicker) and the tile fills; when the balance changes its digits roll.
// `pulse()`: the ring flashes once (a tap).
import type { SeatState } from "../link/types.ts";
import { blockieLedSvg } from "./blockie.ts";
import { motion, pick, shadow, sheet } from "./part.ts";
import type { EgbSeg } from "./seg.ts";

const styles = sheet(`
:host {
  display: block; position: relative; width: 380px; height: 96px; container-type: size;
  --seat: var(--p1); --seat-hi: var(--p1-hi);
}
:host([seat="1"]) { --seat: var(--p2); --seat-hi: var(--p2-hi); }
.port {
  --p: calc(100cqh / 96);
  position: absolute; inset: 0; display: flex; align-items: center; gap: calc(12 * var(--p)); padding: 0 calc(4 * var(--p));
  transform-origin: 0 0; transition: transform var(--t-move) var(--ease-out);
}
:host([seat="1"]) .port { flex-direction: row-reverse; transform-origin: 100% 0; }
:host([compact]) .port { transform: scale(0.7); }

/* The socket: a gunmetal ring lit from the top left round the neon ring and its dark well. */
.socket {
  position: relative; flex: none; width: calc(96 * var(--p)); height: calc(96 * var(--p)); border-radius: 50%;
  background:
    conic-gradient(from 270deg, transparent 0deg, rgb(255 255 255 / 0.2) 45deg, transparent 100deg, transparent 180deg, rgb(255 255 255 / 0.06) 225deg, transparent 280deg),
    linear-gradient(150deg, #9a91c8, #5e5590 30%, #3a3264 65%, #251e44);
  box-shadow: inset 0 2px 0 rgb(255 255 255 / 0.36), inset 0 -3px 5px rgb(10 6 26 / 0.5), 0 0 0 1.5px #0b0718, 0 10px 18px rgb(3 1 10 / 0.55);
}
.socket > i { position: absolute; border-radius: 50%; }
/* The well the ring sits in, sunk below the socket's face. */
.well { inset: calc(10 * var(--p)); background: #07040f; box-shadow: inset 0 3px 6px rgb(0 0 0 / 0.85), 0 1.5px 0 rgb(255 255 255 / 0.2); }
/* The ring unlit: a glass tube with a little of the seat's colour in it, and the dark centre it rings. */
.tube {
  inset: calc(15 * var(--p)); border: calc(7 * var(--p)) solid color-mix(in srgb, var(--seat) 26%, #2a2348);
  background: radial-gradient(circle at 50% 38%, #1c1534, #0b0817 75%);
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(0 0 0 / 0.5);
}
/* Contactless arcs engraved in the centre: where the badge goes. */
.nfc { inset: 32%; display: grid; place-items: center; }
.nfc svg { width: 100%; height: 100%; fill: none; stroke: #2c2547; stroke-width: 2.2; stroke-linecap: round; }
/* The ring lit: a pastel core in the seat's neon, a short glow on both its edges. */
.lit {
  inset: calc(15 * var(--p)); border: calc(7 * var(--p)) solid color-mix(in srgb, var(--seat) 72%, #fff);
  box-shadow:
    0 0 0 1.5px var(--seat), 0 0 8px color-mix(in srgb, var(--seat) 65%, transparent),
    inset 0 0 0 1.5px var(--seat), inset 0 0 8px color-mix(in srgb, var(--seat) 45%, transparent);
}
.flash { inset: calc(13 * var(--p)); border: calc(11 * var(--p)) solid var(--seat-hi); opacity: 0; box-shadow: 0 0 10px var(--seat); }
.port.empty .lit { opacity: 0; }

/* The tile: a gunmetal frame round a dark LED matrix. */
.tile {
  position: relative; flex: none; width: calc(66 * var(--p)); height: calc(66 * var(--p)); border-radius: calc(11 * var(--p));
  padding: calc(5 * var(--p));
  background: linear-gradient(170deg, #a49bd0, #5a5088 32%, #3a3262 68%, #2a2346);
  box-shadow: inset 0 1.5px 0 rgb(255 255 255 / 0.4), inset 0 -2px 0 rgb(0 0 0 / 0.45), 0 0 0 1.5px #0b0718, 0 8px 14px rgb(3 1 10 / 0.5);
}
.matrix {
  position: relative; width: 100%; height: 100%; border-radius: calc(6 * var(--p)); display: grid; place-items: center;
  background:
    radial-gradient(circle, color-mix(in srgb, var(--seat) 9%, transparent) 0 1.3px, transparent 1.7px) 50% 50% / calc(7 * var(--p)) calc(7 * var(--p)),
    linear-gradient(180deg, #1a1430, #0e0a1d);
  box-shadow: inset 0 2px 5px rgb(0 0 0 / 0.75), inset 0 0 0 1px rgb(0 0 0 / 0.6);
}
.face { width: calc(46 * var(--p)); height: calc(46 * var(--p)); }
.face svg { display: block; width: 100%; height: 100%; }
.face .c0 { fill: color-mix(in srgb, var(--seat) 10%, #120d24); }
.face .c1 { fill: var(--seat); }
.face .c2 { fill: var(--seat-hi); }
.port.empty .face { opacity: 0; }

/* The name over the balance. */
.info { display: flex; flex-direction: column; justify-content: center; gap: calc(7 * var(--p)); min-width: 0; flex: 1; align-items: flex-start; }
:host([seat="1"]) .info { align-items: flex-end; text-align: right; }
.name {
  max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  font: 600 max(14px, calc(20 * var(--p))) / 1.15 var(--body); color: var(--fg); text-shadow: 0 1px 2px rgb(7 4 15 / 0.7);
}
.name span { color: var(--fg-3); }
/* Empty: TAP BADGE engraved into the board where the name goes. */
.tap {
  display: none; font: 800 max(14px, calc(20 * var(--p))) / 1.15 var(--display); letter-spacing: 0.04em; color: #7d73ab;
  text-shadow: 0 -1px 0 rgb(0 0 0 / 0.75), 0 1px 0 rgb(255 255 255 / 0.12);
}
.port.empty .name { display: none; }
.port.empty .tap { display: block; }

/* The balance LCD: amber digits behind glass in a brass bezel, the EGB legend printed beside them. */
.lcd {
  position: relative; height: calc(38 * var(--p)); display: flex; align-items: center; gap: calc(7 * var(--p));
  padding: 0 calc(10 * var(--p)) 0 calc(9 * var(--p)); border-radius: calc(7 * var(--p));
  border: calc(2.5 * var(--p)) solid transparent;
  background:
    linear-gradient(180deg, #24160a, var(--lcd-amber-bg) 60%, #120a03) padding-box,
    linear-gradient(180deg, var(--brass-hi), var(--brass-mid) 50%, var(--brass-edge)) border-box;
  box-shadow: inset 0 2px 5px rgb(0 0 0 / 0.7), 0 0 0 1px #1a1004, 0 4px 8px rgb(3 1 10 / 0.5);
}
.lcd::after { content: ""; position: absolute; inset: 0 0 50% 0; border-radius: inherit; background: linear-gradient(180deg, rgb(255 255 255 / 0.08), transparent); pointer-events: none; }
egb-seg { font-size: calc(28 * var(--p)); }
.unit { font: 700 max(14px, calc(20 * var(--p))) / 1 var(--display); color: var(--lcd-amber); text-shadow: 0 0 6px rgb(255 181 71 / 0.45); }
.port.empty .unit { opacity: 0.18; text-shadow: none; }
`);

const NFC = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8.5a5 5 0 0 1 0 7"/><path d="M11.5 6a8.5 8.5 0 0 1 0 12"/><path d="M15 3.5a12 12 0 0 1 0 17"/></svg>`;

export class EgbPort extends HTMLElement {
  readonly #port: HTMLElement;
  readonly #lit: HTMLElement;
  readonly #flash: HTMLElement;
  readonly #face: HTMLElement;
  readonly #name: HTMLElement;
  readonly #seg: EgbSeg;
  /** The seated badge's address; undefined until the first `set`, which draws without animating. */
  #address: string | null | undefined;

  constructor() {
    super();
    const root = shadow(
      this,
      styles,
      `<div class="port empty">
        <div class="socket"><i class="well"></i><i class="tube"></i><i class="nfc">${NFC}</i><i class="lit"></i><i class="flash"></i></div>
        <div class="tile"><div class="matrix"><div class="face"></div></div></div>
        <div class="info"><div class="name"></div><div class="tap">TAP BADGE</div><div class="lcd"><span class="unit">EGB</span></div></div>
      </div>`,
    );
    this.#port = pick(root, ".port");
    this.#lit = pick(root, ".lit");
    this.#flash = pick(root, ".flash");
    this.#face = pick(root, ".face");
    this.#name = pick(root, ".name");
    this.#seg = document.createElement("egb-seg") as EgbSeg;
    this.#seg.setAttribute("digits", "5");
    pick(root, ".lcd").prepend(this.#seg);
  }

  set(seat: SeatState): void {
    const address = seat.badge?.address ?? null;
    const first = this.#address === undefined;
    if (address !== this.#address) {
      this.#address = address;
      this.#port.classList.toggle("empty", !seat.badge);
      this.#face.innerHTML = address ? blockieLedSvg(address, 46) : "";
      if (!first && address) this.#powerOn();
      if (!first && !address) motion(this.#lit, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: "linear" });
    }
    this.#name.replaceChildren(...nameParts(seat.badge?.name ?? ""));
    this.#name.title = seat.badge?.name ?? "";
    this.#seg.value = seat.badge ? String(seat.balance) : "";
    this.setAttribute("aria-label", seat.badge ? `${seat.badge.name}, ${seat.balance} EGB` : "empty seat, tap a badge");
  }

  /** The ring flashes once: a tap at this seat's station. */
  pulse(): void {
    motion(this.#flash, [{ opacity: 0, transform: "scale(0.96)" }, { opacity: 0.9, transform: "scale(1.02)", offset: 0.25 }, { opacity: 0, transform: "none" }], {
      duration: 420, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    });
  }

  /** The ring strikes like a neon tube, and the blockie lights on the tile after it. */
  #powerOn(): void {
    motion(this.#lit, [{ opacity: 0 }, { opacity: 0.8, offset: 0.18 }, { opacity: 0.15, offset: 0.32 }, { opacity: 0.9, offset: 0.5 }, { opacity: 0.55, offset: 0.62 }, { opacity: 1 }], {
      duration: 520, easing: "linear",
    });
    motion(this.#face, [{ opacity: 0, transform: "scale(0.9)" }, { opacity: 1, transform: "none" }], {
      duration: 360, delay: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "backwards",
    });
  }
}

/** `nova.gamebox.eth` → the badge's own label bright, the rest of the name quieter. */
function nameParts(name: string): Node[] {
  const dot = name.indexOf(".");
  if (dot < 0) return [document.createTextNode(name)];
  const rest = document.createElement("span");
  rest.textContent = name.slice(dot);
  return [document.createTextNode(name.slice(0, dot)), rest];
}
