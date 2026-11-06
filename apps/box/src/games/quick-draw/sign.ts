// The flip-plate sign on its post: a weathered plank frame with nail heads, and a plate hung between two iron pins
// that turns over on them (rotateX) from its dark painted WAIT… face to its bright DRAW face. A decoy paints the dark
// face red with another word (DRAG, DRAT…) for a moment: never tap on red.
import { el, play } from "../../screen/shell/dom.ts";

export interface Sign {
  readonly el: HTMLElement;
  /** Turns the plate over to DRAW with a swing that settles; `instant` shows it already turned. */
  flip(instant?: boolean): Promise<void>;
  /** Back to WAIT…, unturned. */
  reset(): void;
  /** Paints another word on the unturned face (the paces counted out before the standoff), until `reset`. */
  say(word: string): void;
  /** The plate jumps on its pins: a tap came before the draw. */
  rattle(): void;
  /** Paints `word` in red on the unturned face and shakes it: a decoy, not the DRAW. `reset` takes it off. */
  decoy(word: string): void;
}

/** Hand-painted letters: each one sits a little off the line and off square, as a brush leaves them. */
const WOBBLE: readonly { readonly turn: number; readonly drop: number; readonly gap: number }[] = [
  { turn: -2.2, drop: 2, gap: 0.02 },
  { turn: 1.4, drop: -3, gap: 0.06 },
  { turn: -0.8, drop: 1, gap: 0.01 },
  { turn: 2.4, drop: -1, gap: 0.07 },
  { turn: -1.6, drop: 3, gap: 0.03 },
];

function painted(word: string): HTMLElement {
  const line = el("span", "qd-sign-word");
  line.setAttribute("aria-label", word);
  [...word].forEach((ch, i) => {
    const w = WOBBLE[i % WOBBLE.length] ?? { turn: 0, drop: 0, gap: 0 };
    const letter = el("span", "qd-sign-letter", ch);
    letter.setAttribute("aria-hidden", "true");
    letter.style.transform = `translateY(${w.drop}px) rotate(${w.turn}deg)`;
    letter.style.marginRight = `${w.gap}em`;
    line.append(letter);
  });
  return line;
}

function face(kind: "wait" | "draw", word: string): HTMLElement {
  const node = el("div", `qd-sign-face qd-sign-face--${kind}`);
  // The wear sits over the letters: chips and scuffs where the plank shows through the paint.
  node.append(painted(word), el("span", "qd-sign-wear"));
  return node;
}

const WAIT_WORD = "WAIT…";

export function createSign(): Sign {
  const root = el("div", "qd-sign");
  const post = el("div", "qd-sign-post qd-wood qd-wood--upright");
  post.append(el("span", "qd-sign-cap"));
  const board = el("div", "qd-sign-board qd-wood");
  for (const corner of ["tl", "tr", "bl", "br"]) board.append(el("span", `qd-sign-nail qd-sign-nail--${corner}`));
  for (const side of ["l", "r"]) board.append(el("span", `qd-sign-pin qd-sign-pin--${side}`));
  const slot = el("div", "qd-sign-slot");
  const plate = el("div", "qd-sign-plate");
  const waitFace = face("wait", WAIT_WORD);
  plate.append(waitFace, face("draw", "DRAW"));
  let word = WAIT_WORD;
  const paint = (next: string): void => {
    if (next === word) return;
    word = next;
    waitFace.firstElementChild?.replaceWith(painted(next));
  };
  slot.append(plate);
  board.append(slot);
  root.append(post, el("span", "qd-sign-foot"), board);

  let flipped = false;
  const cancel = (): void => {
    for (const a of plate.getAnimations()) a.cancel();
  };

  return {
    el: root,

    async flip(instant = false) {
      if (flipped) return;
      flipped = true;
      cancel();
      const end: Keyframe = { transform: "rotateX(180deg)" };
      if (instant) {
        plate.animate([end], { duration: 1, fill: "forwards" });
        return;
      }
      // Over the top, past it, back, and a last small swing on the pins.
      await play(plate, [
        { transform: "rotateX(0deg)" },
        { transform: "rotateX(204deg)", offset: 0.5 },
        { transform: "rotateX(168deg)", offset: 0.72 },
        { transform: "rotateX(186deg)", offset: 0.88 },
        end,
      ], { duration: 620, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)", fill: "forwards" });
    },

    reset() {
      flipped = false;
      cancel();
      waitFace.classList.remove("is-decoy");
      paint(WAIT_WORD);
    },

    say(next) {
      waitFace.classList.remove("is-decoy");
      paint(next);
      // The new word knocks the plate on its pins.
      void play(plate, [
        { transform: "rotateX(0deg)" },
        { transform: "rotateX(-12deg)", offset: 0.3 },
        { transform: "rotateX(5deg)", offset: 0.65 },
        { transform: "rotateX(0deg)" },
      ], { duration: 300, easing: "ease-out" });
    },

    decoy(next) {
      waitFace.classList.add("is-decoy");
      paint(next);
      void play(plate, [
        { transform: "rotateX(0deg) rotate(0deg)" },
        { transform: "rotateX(-16deg) rotate(-2deg)", offset: 0.25 },
        { transform: "rotateX(8deg) rotate(1.5deg)", offset: 0.55 },
        { transform: "rotateX(0deg) rotate(0deg)" },
      ], { duration: 260, easing: "ease-out" });
    },

    rattle() {
      void play(plate, [
        { transform: "rotateX(0deg)" },
        { transform: "rotateX(-22deg)", offset: 0.2 },
        { transform: "rotateX(14deg)", offset: 0.45 },
        { transform: "rotateX(-6deg)", offset: 0.7 },
        { transform: "rotateX(0deg)" },
      ], { duration: 520, easing: "ease-out" });
    },
  };
}
