// The match's standing: a small lacquered tally in front of each Rolodex with the player's name and three round pips
// that light in the seat's colour as rounds are won, an engraved plate with the round number, and at the end a big
// engraved brass banner: PLAYER 1 WINS, PLAYER 2 WINS or DRAW.
import type { Rect } from "../../screen/shell/layout.ts";
import type { Seat } from "@egb/sdk";
import { el, place, play } from "../../screen/shell/dom.ts";

const PIPS = 3;

export interface StandingPlaces {
  readonly tallies: readonly [Rect, Rect];
  readonly round: Rect;
  readonly banner: Rect;
}

export interface Standing {
  /** Its parts, each placed on the stage. */
  readonly els: readonly HTMLElement[];
  /** Lights each seat's won rounds and shows the round number; `animate` pops a newly lit pip. */
  set(score: readonly [number, number], round: number, animate: boolean): void;
  /** The match is over: the banner names the winner, or DRAW for null. */
  finish(winner: Seat | null, animate: boolean): void;
}

export function createStanding(places: StandingPlaces): Standing {
  const pips: HTMLElement[][] = [];
  const tallies = places.tallies.map((r, seat) => {
    const tally = el("div", `sd-tally s${seat}`);
    place(tally, r);
    const row = el("span", "sd-tally-pips");
    const lights = Array.from({ length: PIPS }, () => el("i", "sd-pip"));
    row.append(...lights);
    pips.push(lights);
    tally.append(el("span", "sd-tally-name", `PLAYER ${seat + 1}`), row);
    return tally;
  });

  const plate = el("div", "sd-round");
  place(plate, places.round);
  const roundText = el("span", "", "ROUND 1");
  plate.append(roundText);

  const banner = el("div", "sd-banner");
  place(banner, places.banner);
  const bannerText = el("span", "sd-banner-text");
  banner.append(bannerText);

  return {
    els: [...tallies, plate, banner],
    set(score, round, animate) {
      roundText.textContent = `ROUND ${round}`;
      pips.forEach((lights, seat) => {
        const won = score[seat] ?? 0;
        lights.forEach((pip, i) => {
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
      bannerText.textContent = winner === null ? "DRAW" : `PLAYER ${winner + 1} WINS`;
      banner.dataset.winner = winner === null ? "draw" : String(winner);
      banner.classList.add("on");
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
  };
}
