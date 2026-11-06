// Values that change by the second without a read: a countdown to an expiry and a relative time. One shared ticker
// drives them all. A countdown that reaches zero fires `expired` (bubbling), and its page reads the name again, so
// "expired" on screen is always the chain's answer and never the clock's guess.
import { ago, countdown, nowSeconds } from "../time.ts";

const ticking = new Set<{ tick(now: number): void }>();
let timer: ReturnType<typeof setInterval> | null = null;

function join(el: { tick(now: number): void }): void {
  ticking.add(el);
  el.tick(nowSeconds());
  timer ??= setInterval(() => {
    const now = nowSeconds();
    for (const item of ticking) item.tick(now);
  }, 1_000);
}

function leave(el: { tick(now: number): void }): void {
  ticking.delete(el);
  if (ticking.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** `<gb-countdown expiry="1730000000">`: `07:42`, `never` for a forever name, `expired` at zero. */
export class GbCountdown extends HTMLElement {
  private fired = false;

  connectedCallback(): void {
    join(this);
  }

  disconnectedCallback(): void {
    leave(this);
  }

  tick(now: number): void {
    const view = countdown(BigInt(this.getAttribute("expiry") ?? "0"), now);
    this.dataset.state = view.state;
    if (view.state === "running") this.dataset.ran = "1";
    this.textContent = view.state === "forever" ? "never" : view.state === "expired" ? "expired" : view.text;
    // Only a countdown seen running fires: one drawn already at zero is the page's answer, not news.
    if (view.state === "running") this.fired = false;
    else if (view.state === "expired" && this.fired === false && this.dataset.ran === "1") {
      this.fired = true;
      this.dispatchEvent(new CustomEvent("expired", { bubbles: true }));
    }
  }
}

/** `<gb-ago at="1730000000">`: `12 s ago`, refreshed every second. */
export class GbAgo extends HTMLElement {
  connectedCallback(): void {
    join(this);
  }

  disconnectedCallback(): void {
    leave(this);
  }

  tick(now: number): void {
    const at = Number(this.getAttribute("at") ?? "0");
    this.textContent = at > 0 ? ago(at, now) : "never";
  }
}

export function registerLive(): void {
  if (!customElements.get("gb-countdown")) customElements.define("gb-countdown", GbCountdown);
  if (!customElements.get("gb-ago")) customElements.define("gb-ago", GbAgo);
}

/** A countdown element for `expiry`. */
export function countdownEl(expiry: bigint | number): HTMLElement {
  const el = document.createElement("gb-countdown");
  el.setAttribute("expiry", String(expiry));
  return el;
}

/** A relative-time element for unix seconds `at`. */
export function agoEl(at: number): HTMLElement {
  const el = document.createElement("gb-ago");
  el.setAttribute("at", String(at));
  return el;
}
