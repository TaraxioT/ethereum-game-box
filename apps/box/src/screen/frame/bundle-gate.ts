// The kiosk's gate on a store bundle's page: what it may say, and how much. The page is code nobody can trust and the
// host script in it is only a convenience, so a game can post anything by hand. Everything is decided here, on the
// kiosk's side: a message that isn't exactly a FromBundle, or that a rate or the log's budget doesn't cover, is dropped.
// Nothing a page can say makes a tap, reads a badge or moves money: the words for those don't exist.
import { BUNDLE_LIMITS, LOG_LIMITS, SMALL_CHARS, printable, type FromBundle } from "@egb/sdk";
import { parseFromFrame } from "./channel.ts";
import { MAX_ERRORS } from "./runtime.ts";

const NAME = new RegExp(`^[\\x20-\\x7e]{1,${LOG_LIMITS.eventName}}$`);

const bytes = (text: string): number => new TextEncoder().encode(text).byteLength;

/** `value` as plain JSON, within the log's cap on one event's data; undefined for anything else. */
function eventData(value: unknown): { readonly data: unknown } | undefined {
  try {
    const text = JSON.stringify(value) as string | undefined;
    if (text === undefined || bytes(text) > LOG_LIMITS.eventDataBytes) return undefined;
    return { data: JSON.parse(text) };
  } catch {
    // Cycles, BigInts, and nesting too deep to walk.
    return undefined;
  }
}

/** A FromBundle, cut to its caps, or null for anything else. `seats` is how many seats the match has. */
export function parseFromBundle(data: unknown, seats: number): FromBundle | null {
  const plain = parseFromFrame(data);
  if (plain) return plain;
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  const keys = Object.keys(m).length;
  const seat = typeof m.seat === "number" && Number.isInteger(m.seat) && m.seat >= 0 && m.seat < seats ? m.seat : null;
  if (m.t === "end" && keys === 1) return { t: "end" };
  if (m.t === "buzz" && keys === 2 && seat !== null) return { t: "buzz", seat };
  if (m.t === "station" && keys === 3 && seat !== null && typeof m.text === "string") return { t: "station", seat, text: printable(m.text, SMALL_CHARS) };
  if (m.t === "event" && keys === 3 && typeof m.name === "string" && NAME.test(m.name)) {
    const clean = eventData(m.data);
    if (clean) return { t: "event", name: m.name, data: clean.data };
  }
  return null;
}

/** Says whether one more fits: `perSecond` on average, `burst` at most at once. */
function bucket(perSecond: number, burst: number, now: () => number): () => boolean {
  let tokens = burst;
  let at = now();
  return () => {
    const t = now();
    tokens = Math.min(burst, tokens + ((t - at) / 1000) * perSecond);
    at = t;
    if (tokens < 1) return false;
    tokens--;
    return true;
  };
}

/** What an event costs the log, written as the Box writes it. */
function entryBytes(name: string, data: unknown): number {
  return bytes(JSON.stringify({ src: "game", t: "event", at: Number.MAX_SAFE_INTEGER, name, data }));
}

/** Takes what a frame posted and answers the message to act on, or null to drop it. */
export type BundleGate = (data: unknown) => FromBundle | null;

/** A gate for one match. `now` is in ms, from a clock that only moves forward. */
export function createBundleGate(seats: number, now: () => number): BundleGate {
  const { eventRate, eventBurst, stationRate, stationBurst, buzzRate, buzzBurst, eventEntries, eventBytes } = BUNDLE_LIMITS;
  const eventRoom = bucket(eventRate, eventBurst, now);
  const stationRoom = Array.from({ length: seats }, () => bucket(stationRate, stationBurst, now));
  const buzzRoom = Array.from({ length: seats }, () => bucket(buzzRate, buzzBurst, now));
  let ready = false;
  let ended = false;
  let errors = 0;
  let entries = 0;
  let spent = 0;

  function admits(message: FromBundle): boolean {
    switch (message.t) {
      case "ready":
        if (ready) return false;
        ready = true;
        return true;
      case "error":
        return errors++ < MAX_ERRORS;
      case "event": {
        const cost = entryBytes(message.name, message.data);
        if (entries >= eventEntries || spent + cost > eventBytes) return false;
        entries++;
        spent += cost;
        return true;
      }
      case "station":
        return stationRoom[message.seat]?.() ?? false;
      case "buzz":
        return buzzRoom[message.seat]?.() ?? false;
      case "end":
        ended = true;
        return true;
    }
  }

  return (data) => {
    if (ended) return null;
    // Reading an event's data is the one cost a flood could run up, so the rate comes first.
    if (typeof data === "object" && data !== null && (data as { t?: unknown }).t === "event" && !eventRoom()) return null;
    const message = parseFromBundle(data, seats);
    return message && admits(message) ? message : null;
  };
}
