// Countdowns and relative times, pure: every caller passes `now` (unix seconds), so tests use fake timers.
import { FOREVER } from "./registry.ts";

/** Unix seconds now. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** What a countdown to `expiry` shows at `now`. */
export type Countdown =
  | { state: "forever" }
  | { state: "running"; text: string; seconds: number }
  | { state: "expired" };

/** `07:42` under an hour, `3:07:42` under a day, `29d 14:06:51` beyond; `expired` at zero. */
export function countdown(expiry: bigint | number, now: number): Countdown {
  if (BigInt(expiry) >= FOREVER) return { state: "forever" };
  const seconds = Number(expiry) - now;
  if (seconds <= 0) return { state: "expired" };
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = seconds % 60;
  const text = d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return { state: "running", text, seconds };
}

/** `12 s ago`, `4 min ago`, `3 h ago`, `2 d ago`. A time a little ahead (clock skew) reads as `just now`. */
export function ago(then: number, now: number): string {
  const s = now - then;
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3_600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3_600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

/** A unix time as a short UTC date and time. */
export function when(seconds: bigint | number): string {
  return new Date(Number(seconds) * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
