// CORS: a browser may call only from the site's origin (and from localhost in dev). Requests with no `Origin` (the
// demo Box, scripts) are not browsers, and pass.

/** Whether `origin` is in the comma-separated `allowed` list. `http://localhost:*` matches any localhost port. */
export function originAllowed(origin: string, allowed: string): boolean {
  return allowed
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((entry) =>
      entry.endsWith(':*') ? new RegExp(`^${escape(entry.slice(0, -2))}(:\\d+)?$`).test(origin) : entry === origin,
    );
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}
