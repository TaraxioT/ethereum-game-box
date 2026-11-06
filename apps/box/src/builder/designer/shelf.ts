// The shelf: the template games the Designer offers. The Forge discovers them from `forge.template` in each game's
// game.json and hands the Designer this port; Quick Draw is the default.

export interface ShelfTemplate {
  /** The game's id (its folder). */
  readonly id: string;
  /** The key's label: `forge.label`. */
  readonly label: string;
  /** `forge.default`: the template a new brief starts from. */
  readonly default: boolean;
  /**
   * The core loop, in a sentence, when the template fixes it: the Designer then settles the mechanic with the
   * template and never asks it. Absent: the player picks one.
   */
  readonly mechanic?: string;
}

export interface ShelfPort {
  /** The templates now, default first. Read on every question, so a newly installed template shows at once. */
  templates(): readonly ShelfTemplate[];
}

/** The template a fresh brief starts from: the shelf's default, else its first, else Quick Draw. */
export function defaultTemplate(templates: readonly ShelfTemplate[]): string {
  return (templates.find((t) => t.default) ?? templates[0])?.id ?? "quick-draw";
}

/** Default first, then the shelf's own order. */
export function ordered(templates: readonly ShelfTemplate[]): ShelfTemplate[] {
  return [...templates.filter((t) => t.default), ...templates.filter((t) => !t.default)];
}
