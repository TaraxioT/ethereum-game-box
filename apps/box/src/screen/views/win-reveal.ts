// The win reveal: once the result is paid and read back from chain, what the winner won comes up over the result
// screen, one card at a time (`win-words.ts`): the pot paid, the title, the cup. Each card bursts in (a ring of light,
// turning rays, sparks off its emblem), prints its headline letter by letter (the USDC counts up), lights the line saying
// who it now resolves to like a key to press, then prints what it means line by line, with a bar running down the time
// it holds. A tap goes on to the next; after the last the shade lifts. Under reduced motion each card shows at once.
// Only transform and opacity move (`win-reveal.css`).
import "./win-reveal.css";
import type { Rect } from "../shell/layout.ts";
import { el, fitFont, place } from "../shell/dom.ts";
import type { Sound } from "./view.ts";
import type { WinCard, WinKind } from "./win-words.ts";

/** How long each card holds before the next, by what it carries (a title and a cup have more to read). */
const HOLD_MS: Readonly<Record<WinKind, number>> = { usdc: 4_600, title: 7_000, cup: 7_000 };
/** The headline's letters print this far apart, and start this long after the card bursts in. */
const LETTER_MS = 26;
const PRINT_AT_MS = 420;
/** The card's size, centred on the stage. */
const CARD = { w: 860, h: 440 };
const SPARKS = 18;
const EMBLEM: Readonly<Record<WinKind, string>> = { usdc: "$", title: "♛", cup: "★" };
const CUE: Readonly<Record<WinKind, "count" | "round-won" | "bell">> = { usdc: "count", title: "round-won", cup: "bell" };

export interface WinReveal {
  readonly el: HTMLElement;
  /** Shows `cards` one after another, replacing any still showing. */
  show(cards: readonly WinCard[]): void;
  dispose(): void;
}

export function createWinReveal(area: Rect, sound: Sound, calm: boolean): WinReveal {
  const root = el("div", "win-reveal");
  root.hidden = true;
  place(root, area);
  const stage = el("div", "win-stage");
  place(stage, { x: (area.w - CARD.w) / 2, y: (area.h - CARD.h) / 2 + 20, w: CARD.w, h: CARD.h });
  root.append(el("div", "win-shade"), stage);

  let queue: readonly WinCard[] = [];
  let at = 0;
  let timers: ReturnType<typeof setTimeout>[] = [];
  const later = (ms: number, run: () => void): void => void timers.push(setTimeout(run, calm ? 0 : ms));
  const clear = (): void => {
    for (const t of timers) clearTimeout(t);
    timers = [];
  };

  function next(): void {
    clear();
    const card = queue[at++];
    if (!card) {
      root.classList.add("leaving");
      later(420, () => {
        root.hidden = true;
        root.classList.remove("leaving");
        stage.replaceChildren();
      });
      return;
    }
    root.hidden = false;
    root.dataset.kind = card.kind;
    root.dataset.seat = String(card.seat);
    stage.replaceChildren(...burst(), draw(card, at, queue.length));
    sound.play(CUE[card.kind]);
    later(HOLD_MS[card.kind], next);
  }

  /** The ring, the rays and the sparks behind a card. */
  function burst(): HTMLElement[] {
    const sparks = el("div", "win-sparks");
    for (let i = 0; i < SPARKS; i++) {
      const spark = el("i");
      spark.style.setProperty("--a", `${(360 / SPARKS) * i + (i % 3) * 7}deg`);
      spark.style.setProperty("--d", `${220 + ((i * 53) % 160)}px`);
      spark.style.setProperty("--t", `${(i % 4) * 40}ms`);
      sparks.append(spark);
    }
    return [el("div", "win-rays"), el("div", "win-ring"), sparks];
  }

  function draw(card: WinCard, step: number, of: number): HTMLElement {
    const box = el("div", "win-card");
    const big = el("div", "win-big");
    const to = el("div", "win-to");
    to.append(el("span", "win-to-text", card.to), el("i", "win-to-glow"));
    const facts = el("ul", "win-facts");
    const bar = el("i", "win-bar");
    bar.style.animationDuration = `${HOLD_MS[card.kind]}ms`;
    const foot = el("div", "win-foot");
    foot.append(el("span", "", of > 1 ? `${step} / ${of}` : ""), el("span", "", step < of ? "TAP FOR NEXT ›" : "TAP TO CLOSE"));
    box.append(el("div", "win-emblem", EMBLEM[card.kind]), el("div", "win-kicker", card.kicker), big, to, facts, foot, bar);

    // The headline: the USDC counts up; a name prints letter by letter, then a sheen runs across it.
    const printed = card.kind === "usdc" ? PRINT_AT_MS + 700 : PRINT_AT_MS + card.big.length * LETTER_MS;
    if (card.kind === "usdc") countUp(big, card.big);
    else {
      big.append(
        ...[...card.big].map((ch, i) => {
          const letter = el("span", "win-letter", ch);
          letter.style.animationDelay = `${PRINT_AT_MS + i * LETTER_MS}ms`;
          return letter;
        }),
        el("i", "win-sheen"),
      );
      big.style.setProperty("--sheen-at", `${printed + 80}ms`);
    }
    to.style.animationDelay = `${printed + 120}ms`;
    facts.append(
      ...card.facts.map((text, i) => {
        const li = el("li", "", text);
        li.style.animationDelay = `${printed + 520 + i * 260}ms`;
        return li;
      }),
    );
    // Fitted once the card is on the stage, so the headline and every line stay inside it.
    requestAnimationFrame(() => {
      fitFont(big, CARD.w - 96, card.kind === "usdc" ? 76 : 46);
      fitFont(to, CARD.w - 120, 26);
      for (const li of facts.children) fitFont(li as HTMLElement, CARD.w - 96, 17);
    });
    return box;
  }

  /** `+40 USDC`, counting up from `+0 USDC`. */
  function countUp(node: HTMLElement, text: string): void {
    const match = /^(\D*)(\d+)(.*)$/.exec(text);
    if (!match || calm) {
      node.textContent = text;
      return;
    }
    const [, head = "", digits = "0", tail = ""] = match;
    const end = Number(digits);
    node.textContent = `${head}0${tail}`;
    const frames = 18;
    for (let f = 1; f <= frames; f++) later(PRINT_AT_MS + (f * 640) / frames, () => (node.textContent = `${head}${Math.round((end * f) / frames)}${tail}`));
  }

  root.addEventListener("click", (e) => {
    e.stopPropagation();
    next();
  });

  return {
    el: root,
    show(cards) {
      if (cards.length === 0) return;
      queue = cards;
      at = 0;
      root.classList.remove("leaving");
      next();
    },
    dispose: clear,
  };
}
