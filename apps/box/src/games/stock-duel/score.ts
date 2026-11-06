// The match's standing, in the top band the game draws itself: a slab per player (a seat-colour square with P1 or
// P2, the badge's name, the stake, and a pip per round needed to win that lights as rounds are won), the round and
// the pot between them, and at the end a slab over the wheel naming the winner. A player's square pops when their
// tap lands; a tap that meant nothing shakes their slab.
import type { Rect } from "../../screen/shell/layout.ts";
import type { Seat } from "@egb/sdk";
import { el, fitFont, place, play } from "../../screen/shell/dom.ts";
import { ROUNDS_TO_WIN } from "./rules.ts";

export interface StandingPlaces {
  readonly plates: readonly [Rect, Rect];
  /** The round and the pot. */
  readonly mid: Rect;
  readonly banner: Rect;
}

/** A player as the band shows them: the badge's name (or `PLAYER n` with none) and its short label (`KAI`). */
export interface Player {
  readonly name: string;
  readonly label: string;
}

export interface Standing {
  /** Its parts, each placed on the stage. */
  readonly els: readonly HTMLElement[];
  /** Who sits in each seat and what each staked (USDC; null before a match has a stake). */
  players(players: readonly [Player, Player], stake: number | null): void;
  /** Lights each seat's won rounds and shows the round number; `animate` pops a newly lit pip. */
  set(score: readonly [number, number], round: number, animate: boolean): void;
  /** The match is over: the banner names the winner, or a draw for null. */
  finish(winner: Seat | null, animate: boolean): void;
  /** A tap at a seat's station: `accepted` pops its square, a refused one shakes its slab. */
  tap(seat: Seat, accepted: boolean): void;
}

export function createStanding(places: StandingPlaces): Standing {
  const plates = places.plates.map((r, seat) => {
    const plate = el("div", `sd-plate s${seat}`);
    place(plate, r);
    const avatar = el("div", "sd-avatar", `P${seat + 1}`);
    const name = el("b");
    const stake = el("span");
    const who = el("div", "sd-who");
    who.append(name, stake);
    const pips = Array.from({ length: ROUNDS_TO_WIN }, () => el("i", "sd-pip"));
    const row = el("div", "sd-pips");
    row.append(...pips);
    plate.append(avatar, who, row);
    return { plate, avatar, name, stake, pips };
  });

  const mid = el("div", "sd-mid");
  place(mid, places.mid);
  const roundText = el("div", "sd-round", "ROUND 1");
  const pot = el("div", "sd-pot");
  const potText = el("span");
  pot.append(el("i", "", "POT"), potText);
  mid.append(roundText, pot);

  const banner = el("div", "sd-banner");
  place(banner, places.banner);
  const bannerHead = el("b");
  const bannerLine = el("span");
  banner.append(bannerHead, bannerLine);

  let names: readonly [Player, Player] = [
    { name: "PLAYER 1", label: "PLAYER 1" },
    { name: "PLAYER 2", label: "PLAYER 2" },
  ];
  let score: readonly [number, number] = [0, 0];

  return {
    els: [...plates.map((p) => p.plate), mid, banner],
    players(players, stake) {
      names = players;
      plates.forEach((p, seat) => {
        const name = players[seat]?.name ?? "";
        if (p.name.textContent !== name) p.name.textContent = name;
        p.stake.replaceChildren(...(stake === null ? [] : ["STAKE ", el("em", "", `${stake} USDC`)]));
      });
      pot.hidden = stake === null;
      potText.textContent = stake === null ? "" : `${stake * 2} USDC`;
    },
    set(next, round, animate) {
      score = next;
      roundText.textContent = `ROUND ${round}`;
      plates.forEach(({ pips }, seat) => {
        const won = next[seat] ?? 0;
        pips.forEach((pip, i) => {
          const lit = i < won;
          if (lit === pip.classList.contains("lit")) return;
          pip.classList.toggle("lit", lit);
          if (lit && animate) {
            void play(pip, [{ transform: "scale(1.9)", opacity: 0.4 }, { transform: "scale(1)", opacity: 1 }], {
              duration: 460,
              easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
            });
          }
        });
      });
    },
    finish(winner, animate) {
      roundText.textContent = "FINAL";
      banner.className = `sd-banner on${winner === null ? "" : ` s${winner}`}`;
      bannerHead.textContent = winner === null ? "A DRAW" : `${names[winner].label} WINS`;
      bannerHead.style.fontSize = "";
      fitFont(bannerHead, places.banner.w - 40, Number.parseFloat(getComputedStyle(bannerHead).fontSize));
      bannerLine.textContent = winner === null ? `${score[0]} – ${score[1]} · both stakes go back` : `the match, ${Math.max(...score)} – ${Math.min(...score)}`;
      if (!animate) return;
      void play(
        banner,
        [
          { transform: "translateY(-40px) scale(1.12)", opacity: 0 },
          { transform: "translateY(4px) scale(0.98)", opacity: 1, offset: 0.7 },
          { transform: "translateY(0) scale(1)", opacity: 1 },
        ],
        { duration: 620, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    },
    tap(seat, accepted) {
      const p = plates[seat];
      if (!p) return;
      if (accepted) {
        void play(p.avatar, [{ transform: "scale(1.22)" }, { transform: "scale(1)" }], { duration: 320, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
        return;
      }
      void play(
        p.plate,
        [{ transform: "translateX(0)" }, { transform: "translateX(-8px)" }, { transform: "translateX(7px)" }, { transform: "translateX(-4px)" }, { transform: "translateX(0)" }],
        { duration: 320, easing: "ease-out" },
      );
    },
  };
}
