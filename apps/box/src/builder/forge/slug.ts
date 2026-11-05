// Ids for built games: a few words of the design plus a short random suffix, so two builds of the same design never
// collide and the folder name still says what the game is. Ids follow game.json's rule (lower-case words joined by
// `-`, at most 40 characters).
import { MANIFEST_LIMITS } from "@egb/sdk";

/** Words that say nothing about the game itself. */
const FILLER = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "by", "for", "with", "from", "into", "onto",
  "game", "games", "make", "build", "create", "me", "us", "please", "can", "you", "your", "we", "our", "i", "my",
  "where", "when", "who", "what", "which", "that", "this", "it", "its", "is", "are", "be", "should", "would", "will",
  "two", "player", "players", "both", "each", "one", "new", "simple", "little", "fun", "like", "about", "so", "has",
  "have", "then", "if", "than", "as",
]);

const MAX_WORDS = 4;
/** The base leaves room for `-` and the four-letter suffix inside the id limit. */
const MAX_BASE = MANIFEST_LIMITS.id - 5;
/** No 0/o/1/l: an id is read aloud and typed sometimes. */
const SUFFIX = "abcdefghijkmnpqrstuvwxyz23456789";

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A valid game id: the folder's name and the URL's. */
export function isGameId(id: string): boolean {
  return ID.test(id) && id.length <= MANIFEST_LIMITS.id;
}

function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !FILLER.has(w));
}

/** The meaningful words of `text` as a slug, e.g. "pirate-tap-race"; "game" when nothing is left. */
export function slugOf(text: string): string {
  let out = "";
  for (const w of words(text).slice(0, MAX_WORDS)) {
    const next = out ? `${out}-${w}` : w.slice(0, MAX_BASE);
    if (next.length > MAX_BASE) break;
    out = next;
  }
  return out || "game";
}

/** A fresh id for `text` that `taken` doesn't know yet. */
export function newGameId(text: string, taken: (id: string) => boolean, random: () => number = Math.random): string {
  const base = slugOf(text);
  for (let attempt = 0; attempt < 50; attempt++) {
    let suffix = "";
    for (let k = 0; k < 4; k++) suffix += SUFFIX[Math.floor(random() * SUFFIX.length)];
    const id = `${base}-${suffix}`;
    if (!taken(id)) return id;
  }
  throw new Error("couldn't find a free game id");
}
