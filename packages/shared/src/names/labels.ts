// The label rule, the same one `GameBoxNames` checks on chain: 3 to 32 characters of `a-z`, `0-9` and `-`, with no
// hyphen at either end. Every label that passes is already ENS-normalised.

/** The parent of every Game Box name. */
export const PARENT_NAME = 'gamebox.eth';

export const LABEL_MIN_LENGTH = 3;
export const LABEL_MAX_LENGTH = 32;

/** Every pop-up Box's label starts with this; `GameBoxNames.registerPopup(label, ofBox, expiry)` adds it. */
export const POPUP_PREFIX = 'popup-';

/** Why `label` breaks the rule, in a few words for a person, or `null` if it is a valid label. */
export function labelProblem(label: string): string | null {
  if (label.length < LABEL_MIN_LENGTH) return `at least ${LABEL_MIN_LENGTH} characters`;
  if (label.length > LABEL_MAX_LENGTH) return `at most ${LABEL_MAX_LENGTH} characters`;
  if (!/^[a-z0-9-]+$/.test(label)) return 'only a-z, 0-9 and -';
  if (label.startsWith('-') || label.endsWith('-')) return 'no hyphen at the start or end';
  return null;
}

/** The full label of the pop-up `DemoLicences.openPopup(label)` opens. */
export function popupLabel(label: string): string {
  return `${POPUP_PREFIX}${label}`;
}

/** Why `openPopup(label)` would refuse `label`, or `null`. The rule applies to the full `popup-<label>`. */
export function popupLabelProblem(label: string): string | null {
  if (label.length === 0) return 'at least 1 character';
  if (label.startsWith('-')) return 'no hyphen at the start or end';
  return labelProblem(popupLabel(label));
}

/** `<label>.gamebox.eth`. */
export function fullName(label: string): string {
  return `${label}.${PARENT_NAME}`;
}

/** `champion.<game>.gamebox.eth`, the game's title. */
export function titleName(game: string): string {
  return `champion.${fullName(game)}`;
}
