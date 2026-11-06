// The ENS card under each port: whoever taps a station on Attract or Home is named for a few seconds (waking the Box,
// taking a seat); the pages after name them in their own panels. Their ENS name (`nova.gamebox.eth`), read from chain;
// the titles they hold and the championships they lead, each as its own ENS name resolving to them
// (`champion.stockduel.gamebox.eth → nova.gamebox.eth`); or, for a badge with no name yet, its label and where to claim one.
import { badgeLabel } from "../../core/badges.ts";
import { gameOfLabel } from "../../core/catalogue.ts";
import { honoursOf } from "../../core/honours.ts";
import type { BoxEvent, BoxState, Phase, Seat } from "../../core/types.ts";
import { el, place } from "./dom.ts";
import type { Layout } from "./layout.ts";

/** Where a tap shows the card: Attract and Home, where nothing else names the player (Join, Stake, the result and the
 *  lobby name them in their own panels, and inside a game a tap is a move). */
const NAMED_HERE: ReadonlySet<Phase> = new Set(["attract", "home"]);

/** How long a card stays after its tap. */
export const TAG_MS = 4_500;
const GAP = 6;

export interface EnsTags {
  readonly els: readonly HTMLElement[];
  update(state: BoxState, event: BoxEvent, now: number): void;
}

/** `stockduel` (the second label of `champion.stockduel.gamebox.eth`) as the game's title. */
const gameWord = (name: string): string => {
  const label = name.split(".")[1] ?? "";
  return (gameOfLabel(label)?.title ?? label).toUpperCase();
};

export function createEnsTags(layout: Layout): EnsTags {
  const tags = layout.ports.map((p, i) => {
    const tag = el("div", "ens-tag");
    tag.dataset.seat = String(i);
    tag.dataset.side = p.side;
    tag.hidden = true;
    place(tag, { x: p.module.x, y: p.module.y + p.module.h + GAP, w: p.module.w, h: 0 });
    return tag;
  });
  const hideAt: [number, number] = [0, 0];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function draw(state: BoxState, seat: Seat, now: number): void {
    const tag = tags[seat];
    const card = state.taps[seat];
    if (!tag) return;
    if (!card || now >= hideAt[seat] || !NAMED_HERE.has(state.phase)) {
      tag.hidden = true;
      return;
    }
    tag.hidden = false;
    const head = el("div", "ens-tag-name");
    if (card.ens) {
      const dot = card.ens.indexOf(".");
      head.append(el("b", "", card.ens.slice(0, dot)), el("span", "", card.ens.slice(dot)));
    } else {
      head.append(el("b", "", badgeLabel(card.badge).toLowerCase()), el("span", "", card.read ? " · no ENS name yet" : " · reading ENS…"));
    }
    const rows = honoursOf(card.ens, state.boards, now).map((h) => {
      const row = el("div", "ens-tag-honour");
      row.dataset.kind = h.kind;
      row.append(
        el("span", "ens-tag-kind", h.kind === "title" ? `♛ ${gameWord(h.name)} CHAMPION${h.count > 1 ? ` ×${h.count}` : ""}` : `★ LEADS ${gameWord(h.name)} CUP · ${h.count} PTS`),
        el("span", "ens-tag-map", `${h.name} → ${card.ens ?? ""}`),
      );
      return row;
    });
    const hint = !card.ens && card.read ? [el("div", "ens-tag-hint", "CLAIM A NAME IN THE LOBBY")] : [];
    tag.replaceChildren(head, ...rows, ...hint);
  }

  function schedule(state: BoxState, now: number): void {
    clearTimeout(timer);
    const next = Math.min(...hideAt.filter((at) => at > now));
    if (Number.isFinite(next)) timer = setTimeout(() => ([0, 1] as const).forEach((s) => draw(state, s, Date.now())), next - now + 20);
  }

  return {
    els: tags,
    update(state, event, now) {
      if (event.type === "tap" && state.taps[event.seat]) hideAt[event.seat] = now + TAG_MS;
      ([0, 1] as const).forEach((s) => draw(state, s, now));
      schedule(state, now);
    },
  };
}
