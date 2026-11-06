// Times for a person: a licence's expiry and a Box's last heartbeat, relative to now.

/** `in 29 days`, `3 min ago`: `then` and `now` in unix seconds. */
export function relative(then: number, now: number): string {
  const delta = then - now;
  const span = Math.abs(delta);
  const [n, unit] =
    span < 60 ? [span, "s"]
    : span < 3_600 ? [Math.floor(span / 60), "min"]
    : span < 86_400 ? [Math.floor(span / 3_600), "h"]
    : [Math.floor(span / 86_400), Math.floor(span / 86_400) === 1 ? "day" : "days"];
  return delta >= 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}

/** `2026-12-06 14:05 UTC`. */
export function utc(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
