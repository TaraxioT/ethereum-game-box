// The site's shared state and its router: which page shows, the badge a visitor holds, what the Story has made, and
// which part of the page the current step points at.
import type { Badge } from "./badge.ts";
import { storedTestBadge } from "./badge.ts";
import { client, headBlock } from "./chain.ts";
import { type Directory, directory } from "./directory.ts";
import { failed, reading } from "./ui/dom.ts";

export type Page = (route: Route) => Promise<HTMLElement>;

export interface Route {
  /** The first path part: `""`, `lobby`, `players`, `champions`, `championships`, `boxes`, `agent`, `name`. */
  page: string;
  /** The rest: a name for the inspector or the lobby. */
  arg: string;
}

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  const slash = path.indexOf("/");
  return slash < 0 ? { page: path, arg: "" } : { page: path.slice(0, slash), arg: decodeURIComponent(path.slice(slash + 1)) };
}

export const state = {
  /** The badge the visitor claims and revokes with. */
  badge: storedTestBadge() as Badge | null,
  /** What the walkthrough made this run: its player label. */
  story: { label: null as string | null },
  /** The part of the page the current step points at (`data-focus` on elements). */
  focus: null as string | null,
};

/** The directory, read up to the latest block (asked fresh, so a write that just landed is in it). */
export async function dir(): Promise<Directory> {
  const head = await client.getBlockNumber({ cacheTime: 0 }).catch(() => headBlock());
  return directory(client, head);
}

const pages = new Map<string, Page>();
let root: HTMLElement;
let renderId = 0;

export function registerPage(page: string, render: Page): void {
  pages.set(page, render);
}

/** Draws the current route; a newer render overtakes an older one still reading. */
export async function render(keepScroll = false): Promise<void> {
  const id = ++renderId;
  const route = parseRoute(location.hash);
  for (const a of document.querySelectorAll<HTMLAnchorElement>("#nav a")) {
    a.classList.toggle("on", a.dataset.route === (route.page === "name" ? "__" : route.page));
  }
  const page = pages.get(route.page) ?? pages.get("")!;
  if (!keepScroll) root.replaceChildren(reading());
  try {
    const el = await page(route);
    if (id !== renderId) return;
    root.replaceChildren(el);
    applyFocus();
  } catch (err) {
    if (id === renderId) root.replaceChildren(failed(err));
  }
}

/** Goes to `hash`, or redraws if already there. Resolves once the page has drawn. */
export function go(hash: string): Promise<void> {
  if (location.hash === hash) return render(true);
  history.pushState(null, "", hash);
  return render();
}

/** Lights the elements the current step points at. */
export function setFocus(focus: string | null): void {
  state.focus = focus;
  applyFocus();
}

function applyFocus(): void {
  for (const el of document.querySelectorAll(".lit-focus")) el.classList.remove("lit-focus");
  if (!state.focus) return;
  const lit = [...document.querySelectorAll(`[data-focus~="${state.focus}"]`)];
  for (const el of lit) el.classList.add("lit-focus");
  lit[0]?.scrollIntoView({ block: "center", behavior: "smooth" });
}

export function mountRouter(el: HTMLElement): void {
  root = el;
  addEventListener("popstate", () => void render());
  addEventListener("hashchange", () => void render());
  // A countdown that reached zero: read the page again, so "expired" is the chain's answer. The chain moves on at the
  // first block past the expiry (blocks are 12 s apart), so it reads again until then.
  el.addEventListener("expired", () => {
    for (const ms of [2_000, 14_000, 26_000]) setTimeout(() => void render(true), ms);
  });
  void render();
}
