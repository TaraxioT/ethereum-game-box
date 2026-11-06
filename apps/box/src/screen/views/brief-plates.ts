// The brief so far as panels of light, one per field in the Designer's order: at rest once settled, lit with its bloom
// for the question being asked, faint for one still open. A field that fills flickers its panel and says which it was,
// so the page can send a packet into the core.
import type { DesignerStep, GameBrief } from "../../builder/types.ts";
import { el } from "../shell/dom.ts";
import { flicker } from "../shell/rez.ts";

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
      return brief.stakes ? `${brief.stakes.join(" · ")} USDC` : null;
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
    const plate = document.createElement("egb-panel");
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
        plate.toggleAttribute("lit", field === asking);
        plate.toggleAttribute("open", text === null && field !== asking);
      });
      if (animate) changed.forEach((i, n) => flicker(rows[i]!.plate, n * 110));
      return changed;
    },
  };
}
