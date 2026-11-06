// How the lease screens say time and GBX: the stake slider's stops, a lease's length in words, a running clock, GBX
// grouped in thousands, and a time of day. Pure, so they're tested on their own.

/** Where the stake slider stops: hours for a demo, then days and weeks. */
const STOPS = [1, 2, 3, 4, 6, 8, 12, 24, 48, 72, 168, 336, 720] as const;

/** The slider's stops within `[min, max]`, both ends always among them. */
export function hourStops(min: number, max: number): number[] {
  const inside = new Set<number>([min, ...STOPS.filter((h) => h > min && h < max), max]);
  return [...inside].sort((a, b) => a - b);
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "S"}`;

/** `3 HOURS`, `2 DAYS`, `1 WEEK`. */
export function hoursWord(hours: number): string {
  if (hours % 168 === 0) return plural(hours / 168, "WEEK");
  if (hours % 24 === 0) return plural(hours / 24, "DAY");
  return plural(hours, "HOUR");
}

const two = (n: number): string => String(n).padStart(2, "0");

/** `02:59:41`; past a day, `3D 04:00:00`. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86_400);
  const time = `${two(Math.floor((s % 86_400) / 3_600))}:${two(Math.floor((s % 3_600) / 60))}:${two(s % 60)}`;
  return days ? `${days}D ${time}` : time;
}

/** `999,985,000 GBX` from a decimal string; fractions to two places. */
export function gbxWord(amount: string): string {
  return `${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })} GBX`;
}

/** `14:32` on the Box's clock, from unix seconds; with the date when it isn't today. */
export function timeOfDay(unix: number, today = new Date()): string {
  const at = new Date(unix * 1000);
  const hm = `${two(at.getHours())}:${two(at.getMinutes())}`;
  return at.toDateString() === today.toDateString()
    ? hm
    : `${at.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()} ${hm}`;
}
