// The brief so far as engraved plates screwed to the board, one per field in the Designer's order: gunmetal once
// settled, brass for the question being asked, a dim blank for one still open. A field that fills presses its plate
// in and says which it was, so the page can send a packet into the core.
import type { DesignerStep, GameBrief } from "../../builder/types.ts";
import type { EgbPlate } from "../parts/plate.ts";
import { el, play } from "../shell/dom.ts";

type Field = Exclude<DesignerStep, "confirm">;

const FIELDS: readonly { readonly field: Field; readonly label: string }[] = [
  { field: "template", label: "STARTS FROM" },
  { field: "mechanic", label: "HOW IT SCORES" },
  { field: "theme", label: "WHERE" },
  { field: "twist", label: "THE TWIST" },
  { field: "stakes", label: "STAKES" },
  { field: "voice", label: "CALLED BY" },
  { field: "title", label: "TITLE" },
];

/** A field's value as the plate prints it; null while it is open. */
function valueOf(brief: GameBrief, field: Field): string | null {
  switch (field) {
    case "template":
      return brief.template.replace(/-/g, " ");
    case "stakes":
      return brief.stakes ? `${brief.stakes.join(" · ")} EGB` : null;
    default:
      return brief[field];
  }
}

export interface BriefPlates {
  readonly el: HTMLElement;
  /**
   * Draws the brief with `asking` the field being asked (null: none, as on the Build screen). Returns the indexes of
   * fields that filled or changed since the last draw (none on the first).
   */
  set(brief: GameBrief, asking: DesignerStep | null, animate: boolean): number[];
}

export function createBriefPlates(): BriefPlates {
  const root = el("div", "brief");
  root.append(el("div", "brief-head", "THE BRIEF"));
  const rows = FIELDS.map(({ label }) => {
    const plate = document.createElement("egb-plate") as EgbPlate;
    plate.classList.add("brief-plate");
    const name = el("span", "brief-label", label);
    const value = el("span", "brief-value");
    plate.append(name, value);
    root.append(plate);
    return { plate, value };
  });
  let last: (string | null)[] | null = null;

  return {
    el: root,
    set(brief, asking, animate) {
      const values = FIELDS.map(({ field }) => valueOf(brief, field));
      const changed = last ? values.flatMap((v, i) => (v !== null && v !== last![i] ? [i] : [])) : [];
      last = values;
      FIELDS.forEach(({ field }, i) => {
        const { plate, value } = rows[i]!;
        const text = values[i];
        value.textContent = text ?? "—";
        plate.setAttribute("variant", field === asking ? "brass" : "metal");
        plate.toggleAttribute("open", text === null && field !== asking);
      });
      if (animate) {
        changed.forEach((i, n) =>
          void play(rows[i]!.plate, [{ transform: "translateX(-14px)", opacity: 0.3 }, { transform: "none", opacity: 1 }], {
            duration: 320, delay: n * 110, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "backwards",
          }),
        );
      }
      return changed;
    },
  };
}
