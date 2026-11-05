// The Forge's limits in one place: what one build may spend, and how much of it the Box keeps.

export const FORGE_MODEL = "claude-sonnet-5-5";
/** Agent turns in one build (the fix-up turns get their own budget of the same). */
export const MAX_TURNS = 40;
/** One build, start to installed. A Pi type-checks and bundles slowly; 8 minutes covers a full run and its fix-ups. */
export const TIMEOUT_MS = 8 * 60_000;
/** After the build's own limit (or a cancel), how long the parent waits before it kills the build's process group. */
export const KILL_GRACE_MS = 20_000;

/** Events kept per job (the first, then the latest): enough to replay a build on screen. */
export const MAX_EVENTS = 600;
/** Finished jobs kept on disk and listed; the oldest go first. */
export const MAX_JOBS_KEPT = 50;

/** Error lines the agent gets back from build_game: enough to fix things, not enough to drown its context. */
export const MAX_ERROR_LINES = 30;
/** The longest `say` shown (the agent's words). */
export const MAX_SAY_CHARS = 2_000;

/** A built game is small: its own files (not .reference), and the size of each. */
export const MAX_GAME_FILES = 40;
export const MAX_SOURCE_BYTES = 128 * 1024;

/** Each free-text field of a brief (theme, twist, voice, mechanic) as the agent sees it. */
export const MAX_BRIEF_TEXT = 200;
