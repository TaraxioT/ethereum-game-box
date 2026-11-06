// What a stake or unstake writes in ENS, drawn as the path it takes: BoxLease (the GBX) calls GameBoxNames, which
// writes gamebox.eth's registry (`<label>`'s expiry) and the name's own resolver (its `status` text). Each card shows
// that contract's address and the value it holds now. When a value changes, a pulse runs from BoxLease to the card it
// reached, the card flashes and the old value is struck through. While a stake or unstake is being sent, the cards it
// will write wait with a pulse running to them. Visual only: the gate itself is the server's (server/lease.ts).
import type { AdminJob } from "../../server/admin-wire.ts";
import type { LeaseReply } from "../../server/lease-wire.ts";
import { calm, el } from "../shell/dom.ts";
import { gbxWord, spanWord } from "./lease-words.ts";

export type Part = "lease" | "names" | "registry" | "resolver";
export type CardState = "pass" | "fail" | "off";

export interface Card {
  readonly state: CardState;
  /** What it holds, e.g. `"suspended"`. */
  readonly value: string;
  /** A note under it, e.g. `TTL 363D`. */
  readonly note: string;
}

const PARTS: readonly Part[] = ["lease", "names", "registry", "resolver"];

/** The four cards at chain time `now`. */
export function ensCards(reply: LeaseReply, now: number): Record<Part, Card> {
  const s = reply.status;
  if (!s) {
    const off: Card = { state: "off", value: "…", note: "" };
    return { lease: off, names: off, registry: off, resolver: off };
  }
  const staked = s.endsAt !== null && s.endsAt > now;
  const named = s.standing !== "none";
  return {
    lease: { state: staked ? "pass" : "fail", value: gbxWord(staked ? s.stake : "0"), note: staked && s.endsAt ? `ENDS IN ${spanWord(s.endsAt - now)}` : "EMPTY" },
    names: { state: named ? "pass" : "off", value: "LICENSOR", note: "→ ENS" },
    registry: !named
      ? { state: "fail", value: "NOT REGISTERED", note: `${s.label} HAS NO NAME` }
      : { state: s.expiry > now ? "pass" : "fail", value: dateWord(s.expiry), note: s.expiry > now ? `TTL ${spanWord(s.expiry - now)}` : "EXPIRED" },
    resolver: !named
      ? { state: "off", value: "—", note: "MADE ON FIRST STAKE" }
      : { state: s.standing === "active" ? "pass" : "fail", value: `"${s.standing}"`, note: s.standing === "active" ? "BoxCheck LETS IT SIGN" : "BoxCheck REFUSES IT" },
  };
}

/** The line under the map. */
export function ensVerdict(reply: LeaseReply, now: number): { online: boolean; words: string } {
  const s = reply.status;
  if (!s) return { online: false, words: "READING SEPOLIA…" };
  if (reply.gate === "open") return { online: true, words: "ONLINE · STATUS ACTIVE · GBX STAKED" };
  if (s.standing === "none") return { online: false, words: "OFFLINE · NO NAME ON GAMEBOX.ETH" };
  if (s.standing !== "active") return { online: false, words: `OFFLINE · RESOLVER STATUS "${s.standing.toUpperCase()}"` };
  if (s.expiry <= now) return { online: false, words: "OFFLINE · NAME EXPIRED ON THE REGISTRY" };
  return { online: false, words: "OFFLINE · NO GBX STAKED" };
}

/** The cards the running stake or unstake will write. */
export function pendingWrites(reply: LeaseReply): Set<Part> {
  const job: AdminJob | undefined = reply.jobs[0];
  const s = reply.status;
  if (!job || job.status !== "running" || !s) return new Set();
  if (job.what.startsWith("stake")) {
    const parts: Part[] = ["lease", "names", "registry"];
    if (s.standing !== "active") parts.push("resolver");
    return new Set(parts);
  }
  return new Set(["lease", "names", "resolver"]);
}

/** `NOV 7 2027`. */
function dateWord(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).replace(",", "").toUpperCase();
}

const short = (address: string | null): string => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "NOT MADE YET");

const GLYPHS = "0123456789ABCDEF#%/<>";

/** Sets `node`'s text with a short decode: random glyphs settling left to right into the new text. */
function decode(node: HTMLElement, text: string): void {
  if (node.dataset.text === text) return;
  node.dataset.text = text;
  if (calm()) {
    node.textContent = text;
    return;
  }
  const start = performance.now();
  const frame = (t: number): void => {
    if (node.dataset.text !== text) return;
    const settled = Math.floor(((t - start) / 420) * text.length);
    node.textContent = [...text].map((c, i) => (i < settled || c === " " ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join("");
    if (settled < text.length) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Restarts a CSS animation keyed on `className`. */
function replay(node: Element, className: string): void {
  node.classList.remove(className);
  void (node as HTMLElement).offsetWidth;
  node.classList.add(className);
}

interface CardNode {
  readonly node: HTMLElement;
  readonly address: HTMLElement;
  readonly value: HTMLElement;
  readonly old: HTMLElement;
  readonly note: HTMLElement;
}

function card(part: Part, title: string, field: string): CardNode {
  const node = el("div", `ens-card ens-${part}`);
  const row = el("div", "ens-card-row");
  const value = el("span", "ens-card-value");
  const old = el("span", "ens-card-old");
  row.append(el("span", "ens-card-field", field), value, old);
  const foot = el("div", "ens-card-foot");
  const note = el("span", "ens-card-note");
  const address = el("span", "ens-card-address");
  foot.append(note, address);
  node.append(el("span", "ens-card-title", title), row, foot);
  return { node, address, value, old, note };
}

const SVG = "http://www.w3.org/2000/svg";

/** A wire as an SVG path: a dim line, a lit line, and a packet that runs along it. */
function wire(d: string): SVGSVGElement & { paths: SVGGElement[] } {
  const svg = document.createElementNS(SVG, "svg") as SVGSVGElement & { paths: SVGGElement[] };
  svg.setAttribute("viewBox", "0 0 40 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("ens-wire");
  svg.paths = d.split("|").map((path, i) => {
    const g = document.createElementNS(SVG, "g");
    g.classList.add("ens-path");
    g.dataset.i = String(i);
    for (const cls of ["ens-path-base", "ens-path-packet"]) {
      const p = document.createElementNS(SVG, "path");
      p.setAttribute("d", path);
      p.setAttribute("pathLength", "100");
      p.setAttribute("vector-effect", "non-scaling-stroke");
      p.classList.add(cls);
      g.append(p);
    }
    svg.append(g);
    return g;
  });
  return svg;
}

export interface EnsMap {
  readonly node: HTMLElement;
  draw(reply: LeaseReply, now: number): void;
}

export function ensMap(): EnsMap {
  const node = el("div", "ens-map");
  const cards: Record<Part, CardNode> = {
    lease: card("lease", "BoxLease", "stake"),
    names: card("names", "GameBoxNames", "role"),
    registry: card("registry", "REGISTRY · gamebox.eth", "expiry"),
    resolver: card("resolver", "RESOLVER", 'text "status"'),
  };
  const first = wire("M0 50 L40 50");
  const fan = wire("M0 50 C20 50 20 25 40 25|M0 50 C20 50 20 75 40 75");
  const records = el("div", "ens-records");
  records.append(cards.registry.node, cards.resolver.node);
  const flow = el("div", "ens-flow");
  flow.append(cards.lease.node, first, cards.names.node, fan, records);
  const line = el("div", "ens-verdict");
  const words = el("span", "ens-verdict-words");
  line.append(el("i", "ens-verdict-mark"), words);
  node.append(el("span", "lease-label", "WHAT THE LEASE WRITES IN ENS"), flow, line);

  /** The wire segments leading to each part. */
  const route: Record<Part, Element[]> = {
    lease: [cards.lease.node],
    names: [cards.lease.node, first.paths[0]!, cards.names.node],
    registry: [cards.lease.node, first.paths[0]!, cards.names.node, fan.paths[0]!, cards.registry.node],
    resolver: [cards.lease.node, first.paths[0]!, cards.names.node, fan.paths[1]!, cards.resolver.node],
  };

  let seen: Record<Part, string> | null = null;
  let resolverTitle = "";

  function write(part: Part): void {
    route[part].forEach((item, step) => {
      (item as HTMLElement).style.setProperty("--step", String(step));
      replay(item, "ens-write");
    });
  }

  return {
    node,
    draw(reply, now) {
      const s = reply.status;
      const next = ensCards(reply, now);
      const pending = pendingWrites(reply);
      const addresses: Record<Part, string | null> = {
        lease: s?.ens.lease ?? null,
        names: s?.ens.names ?? null,
        registry: s?.ens.registry ?? null,
        resolver: s?.ens.resolver ?? null,
      };
      const title = s ? `RESOLVER · ${s.name}` : "RESOLVER";
      if (title !== resolverTitle) {
        resolverTitle = title;
        cards.resolver.node.querySelector(".ens-card-title")!.textContent = title;
      }
      const lit = new Set<Element>();
      for (const part of PARTS) {
        const shown = cards[part];
        const c = next[part];
        shown.node.dataset.state = c.state;
        shown.address.textContent = s ? short(addresses[part]) : "";
        // Notes count down by the minute; only the value counts as a write.
        decode(shown.note, c.note);
        const before = seen?.[part];
        if (before !== undefined && before !== c.value && before !== "…") {
          shown.old.textContent = before;
          replay(shown.old, "ens-struck");
          write(part);
        }
        decode(shown.value, c.value);
        if (pending.has(part)) for (const item of route[part]) lit.add(item);
      }
      first.paths[0]!.dataset.state = next.names.state;
      fan.paths[0]!.dataset.state = next.registry.state;
      fan.paths[1]!.dataset.state = next.resolver.state;
      for (const item of [...Object.values(cards).map((c) => c.node), ...first.paths, ...fan.paths]) {
        item.classList.toggle("ens-pending", lit.has(item));
      }
      seen = Object.fromEntries(PARTS.map((part) => [part, next[part].value])) as Record<Part, string>;
      const said = ensVerdict(reply, now);
      node.dataset.online = String(said.online);
      decode(words, said.words);
    },
  };
}
