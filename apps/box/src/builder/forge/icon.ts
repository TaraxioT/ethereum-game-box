// The icon check: every built game ships `icon.svg`, the art on its cartridge. A generated icon must not run code,
// load anything, or repaint every frame on the Pi, so this is the gate before install; an icon that fails gets one
// more turn, then the Box writes `fallbackIcon()` instead. A bad icon never fails a game.
//
// The rules, in short: at most 12 KB; viewBox 0 0 256 256; allowlisted elements and attributes; one <style>; no
// scripts, SMIL, filters, masks, foreignObject, images, text, links, event attributes or external url()/href;
// animation only by CSS @keyframes on <g> elements outside defs and clip paths, only `transform` and `opacity`, at
// most 6 animated groups, durations 0.6–8 s, no opacity flashes faster than 3 a second, and a prefers-reduced-motion
// block that stops it; at most 150 drawn elements, and a <use> may not copy another <use> (nested copies multiply).

export const ICON_FILE = "icon.svg";
export const ICON_MAX_BYTES = 12 * 1024;
const MAX_ANIMATED_GROUPS = 6;
const MAX_DRAWN = 150;
const MAX_EXPANDED = 200;

const ELEMENTS = new Set([
  "svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "defs", "linearGradient",
  "radialGradient", "stop", "clipPath", "use", "style", "title", "desc",
]);
const DRAWN = new Set(["path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "use"]);
/** Resources: nothing inside them may animate (it can't be composited). */
const RESOURCES = new Set(["defs", "clipPath", "linearGradient", "radialGradient"]);
const ATTRIBUTES = new Set([
  "id", "class", "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "width", "height",
  "points", "transform", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "stroke-opacity", "stroke-dasharray", "opacity", "offset", "stop-color", "stop-opacity",
  "gradientUnits", "gradientTransform", "spreadMethod", "clip-path", "href", "viewBox", "xmlns",
]);
const BANNED: Readonly<Record<string, string>> = {
  script: "no <script>",
  foreignObject: "no <foreignObject>",
  animate: "no SMIL (<animate>): animate <g> elements with CSS @keyframes",
  animateTransform: "no SMIL (<animateTransform>): animate <g> elements with CSS @keyframes",
  animateMotion: "no SMIL (<animateMotion>)",
  set: "no SMIL (<set>)",
  filter: "no filters",
  mask: "no masks",
  pattern: "no patterns",
  image: "no <image>: draw it with shapes",
  a: "no links (<a>)",
  iframe: "no <iframe>",
  text: "no <text>: draw letters as paths (the icon can't rely on fonts)",
  tspan: "no <tspan>",
  symbol: "no <symbol>",
  marker: "no <marker>",
};
/** What a rule in the icon's <style> may set. */
const CSS_PROPS = new Set(["transform", "transform-box", "transform-origin", "opacity", "transition", "fill", "stroke"]);
const KEYFRAME_PROPS = new Set(["transform", "opacity", "animation-timing-function", "offset"]);

export interface SvgNode {
  readonly name: string;
  readonly attrs: Map<string, string>;
  readonly children: SvgNode[];
  text: string;
  readonly parent: SvgNode | null;
}

const ENTITIES: Readonly<Record<string, string>> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (whole, e: string) => {
    const named = ENTITIES[e.toLowerCase()];
    if (named) return named;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** A strict little XML reader for one SVG: elements, attributes, text, comments, CDATA. No DOCTYPE, no entities. */
export function parseSvg(src: string): SvgNode {
  const stack: SvgNode[] = [];
  let root: SvgNode | null = null;
  let i = 0;
  const top = () => stack[stack.length - 1];
  while (i < src.length) {
    if (src.startsWith("<?", i)) {
      const end = src.indexOf("?>", i);
      if (end < 0) throw new Error("unclosed <?…?>");
      if (!/^<\?xml\s/i.test(src.slice(i, end))) throw new Error("no processing instructions");
      i = end + 2;
    } else if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i);
      if (end < 0) throw new Error("unclosed comment");
      i = end + 3;
    } else if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i);
      if (end < 0) throw new Error("unclosed CDATA");
      const t = top();
      if (t) t.text += src.slice(i + 9, end);
      i = end + 3;
    } else if (src.startsWith("<!", i)) {
      throw new Error("no DOCTYPE or entity declarations");
    } else if (src.startsWith("</", i)) {
      const end = src.indexOf(">", i);
      if (end < 0) throw new Error("unclosed end tag");
      const name = src.slice(i + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) throw new Error(`</${name}> doesn't close <${open?.name ?? "anything"}>`);
      i = end + 1;
    } else if (src[i] === "<") {
      const m = /^<([A-Za-z_][\w:.-]*)/.exec(src.slice(i, i + 200));
      if (!m || !m[1]) throw new Error(`bad tag at character ${i}`);
      const node: SvgNode = { name: m[1], attrs: new Map(), children: [], text: "", parent: top() ?? null };
      i += m[0].length;
      for (;;) {
        while (/\s/.test(src[i] ?? "")) i++;
        if (src.startsWith("/>", i)) {
          i += 2;
          break;
        }
        if (src[i] === ">") {
          i++;
          stack.push(node);
          break;
        }
        const a = /^([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(src.slice(i, i + 20_000));
        if (!a || !a[1]) throw new Error(`bad attribute in <${node.name}>`);
        if (node.attrs.has(a[1])) throw new Error(`duplicate attribute ${a[1]} in <${node.name}>`);
        node.attrs.set(a[1], decode(a[3] ?? a[4] ?? ""));
        i += a[0].length;
      }
      if (node.parent) node.parent.children.push(node);
      else if (root) throw new Error("more than one root element");
      else root = node;
    } else {
      const next = src.indexOf("<", i);
      const chunk = src.slice(i, next < 0 ? src.length : next);
      const t = top();
      if (t) t.text += decode(chunk);
      else if (chunk.trim()) throw new Error("text outside the root element");
      i = next < 0 ? src.length : next;
    }
  }
  const unclosed = top();
  if (unclosed) throw new Error(`<${unclosed.name}> is never closed`);
  if (!root) throw new Error("empty file");
  return root;
}

// ---- CSS ---------------------------------------------------------------------------------------------------------

interface CssRule {
  readonly selector: string;
  readonly body: string;
  readonly media: string | null;
}

function declarations(body: string): [string, string][] {
  return body
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const at = d.indexOf(":");
      return at < 0 ? [d.toLowerCase(), ""] : [d.slice(0, at).trim().toLowerCase(), d.slice(at + 1).trim()];
    });
}

/** Top-level rules, @keyframes, and rules inside @media: enough for one icon's stylesheet. */
function parseCss(css: string): { keyframes: Map<string, string>; rules: CssRule[] } {
  const keyframes = new Map<string, string>();
  const rules: CssRule[] = [];
  const blocks = (text: string, media: string | null) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      for (; j < text.length && depth > 0; j++) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
      }
      const body = text.slice(open + 1, j - 1);
      const kf = /^@(?:-webkit-)?keyframes\s+([\w-]+)/i.exec(head);
      if (kf?.[1]) keyframes.set(kf[1], body);
      else if (/^@media/i.test(head)) blocks(body, head);
      else rules.push({ selector: head, body: head.startsWith("@") ? "" : body, media });
      i = j;
    }
  };
  blocks(css, null);
  return { keyframes, rules };
}

/** Seconds in a CSS time list ("2s", "600ms"). */
function times(v: string): number[] {
  return [...v.matchAll(/(-?\d*\.?\d+)(ms|s)\b/g)].map((m) => Number(m[1]) / (m[2] === "ms" ? 1000 : 1));
}

/** How many times opacity jumps by more than 0.5 between neighbouring keyframes in one cycle. */
function opacityJumps(body: string): number {
  const stops: { at: number; o: number }[] = [];
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const o = declarations(m[2] ?? "").find(([p]) => p === "opacity");
    if (!o) continue;
    for (const sel of (m[1] ?? "").split(",")) {
      const t = sel.trim();
      const at = t === "from" ? 0 : t === "to" ? 100 : parseFloat(t);
      if (Number.isFinite(at)) stops.push({ at, o: Number(o[1]) });
    }
  }
  stops.sort((a, b) => a.at - b.at);
  let jumps = 0;
  for (let k = 1; k < stops.length; k++) if (Math.abs((stops[k]?.o ?? 0) - (stops[k - 1]?.o ?? 0)) > 0.5) jumps++;
  return jumps;
}

/**
 * The elements a selector's last part names (`.a`, `#b`, `g`, `g.a`, `:host(.focused) .a`), or null for one it can't
 * resolve (`*`, attribute selectors, other pseudo-classes).
 */
function select(selector: string, all: readonly SvgNode[], ids: ReadonlyMap<string, SvgNode>): SvgNode[] | null {
  const last = selector.trim().replace(/:host\((?:\.focused|\.pressed)\)\s*/g, "").split(/[\s>+~]+/).filter(Boolean).pop() ?? "";
  if (!last || !/^[\w-]*(?:[.#][\w-]+)*$/.test(last)) return null;
  const id = /#([\w-]+)/.exec(last)?.[1];
  if (id) return ids.has(id) ? [ids.get(id)!] : [];
  const classes = [...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1] ?? "");
  const tag = /^[a-zA-Z][\w-]*/.exec(last)?.[0];
  return all.filter((n) => (!tag || n.name === tag) && classes.every((c) => (n.attrs.get("class") ?? "").split(/\s+/).includes(c)));
}

function isInside(n: SvgNode, names: ReadonlySet<string>): boolean {
  for (let p = n.parent; p; p = p.parent) if (names.has(p.name)) return true;
  return false;
}

// ---- the check ---------------------------------------------------------------------------------------------------

/** What's wrong with an icon, in short sentences the agent can act on. Empty when it passes. */
export function iconProblems(svg: string): string[] {
  const errors: string[] = [];
  const fail = (m: string) => {
    if (!errors.includes(m)) errors.push(m);
  };
  const bytes = Buffer.byteLength(svg, "utf8");
  if (bytes > ICON_MAX_BYTES) fail(`icon.svg is ${(bytes / 1024).toFixed(1)} KB: the limit is 12 KB`);

  let root: SvgNode;
  try {
    root = parseSvg(svg);
  } catch (e) {
    return [...errors, `icon.svg isn't well-formed XML: ${(e as Error).message}`];
  }
  if (root.name !== "svg") return [...errors, "the root element must be <svg>"];
  if ((root.attrs.get("viewBox") ?? "").trim().replace(/[\s,]+/g, " ") !== "0 0 256 256") fail('the root <svg> needs viewBox="0 0 256 256"');
  if (root.attrs.get("xmlns") !== "http://www.w3.org/2000/svg") fail('the root <svg> needs xmlns="http://www.w3.org/2000/svg"');

  const all: SvgNode[] = [];
  const walk = (n: SvgNode) => {
    all.push(n);
    n.children.forEach(walk);
  };
  walk(root);

  const ids = new Map<string, SvgNode>();
  const localRef = /^#[\w-]+$/;
  const checkUrls = (text: string) => {
    for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
      if (!localRef.test((m[2] ?? "").trim())) fail(`url() may only point inside the icon (#id), not "${(m[2] ?? "").slice(0, 40)}"`);
    }
  };
  for (const n of all) {
    const banned = BANNED[n.name];
    if (banned) fail(banned);
    else if (!ELEMENTS.has(n.name)) fail(`<${n.name}> isn't allowed`);
    if (n.name === "svg" && n !== root) fail("no nested <svg>");
    for (const [k, v] of n.attrs) {
      if (/^on/i.test(k)) fail(`no event attributes (${k})`);
      else if (!ATTRIBUTES.has(k)) fail(`the attribute ${k} isn't allowed (on <${n.name}>)`);
      if (k === "href" && !localRef.test(v.trim())) fail(`href may only point inside the icon (#id), not "${v.slice(0, 40)}"`);
      if (/url\(/i.test(v)) checkUrls(v);
      if (/javascript:|data:/i.test(v)) fail(`no javascript: or data: values (${k})`);
    }
    if (n.name === "use" && (n.attrs.has("x") || n.attrs.has("y"))) fail("<use> can't have x or y (wrap it in a <g> with a transform)");
    const id = n.attrs.get("id");
    if (id) ids.set(id, n);
  }
  if (all.filter((n) => n.name === "style").length > 1) fail("use one <style> element");
  const drawn = all.filter((n) => DRAWN.has(n.name)).length;
  if (drawn > MAX_DRAWN) fail(`${drawn} drawn elements: at most ${MAX_DRAWN}`);

  // A <use> copies its target, so nested uses multiply (15 levels of 10 is ~10^15 copies from 150 elements).
  const shapes = (n: SvgNode): number => (DRAWN.has(n.name) && n.name !== "use" ? 1 : 0) + n.children.reduce((s, c) => s + shapes(c), 0);
  const hasUse = (n: SvgNode): boolean => n.name === "use" || n.children.some(hasUse);
  let expanded = all.filter((n) => DRAWN.has(n.name) && n.name !== "use").length;
  for (const n of all) {
    if (n.name !== "use") continue;
    const ref = (n.attrs.get("href") ?? "").trim();
    if (!localRef.test(ref)) continue;
    const target = ids.get(ref.slice(1));
    if (!target) fail(`<use href="${ref.slice(0, 40)}"> points at no element`);
    else if (hasUse(target)) fail("a <use> can't point at something that contains another <use> (copy the shapes instead)");
    else expanded += shapes(target);
  }
  if (expanded > MAX_EXPANDED) fail(`the icon draws ${expanded} shapes once each <use> is copied: at most ${MAX_EXPANDED}`);

  // The stylesheet.
  const css = all
    .filter((n) => n.name === "style")
    .map((n) => n.text)
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@import|@font-face|expression\s*\(|javascript:/i.test(css)) fail("no @import, @font-face or scripts in CSS");
  checkUrls(css);
  const { keyframes, rules } = parseCss(css);
  for (const [name, body] of keyframes) {
    for (const m of body.matchAll(/\{([^{}]*)\}/g)) {
      for (const [prop] of declarations(m[1] ?? "")) {
        if (!KEYFRAME_PROPS.has(prop)) fail(`@keyframes ${name} animates ${prop}: only transform and opacity may animate`);
      }
    }
  }
  const animated = new Set<SvgNode>();
  let loops = false;
  let stopsForReducedMotion = false;
  for (const r of rules) {
    const where = `"${r.selector.slice(0, 40)}"`;
    const decls = declarations(r.body);
    for (const [p] of decls) {
      if (CSS_PROPS.has(p) || p.startsWith("animation")) continue;
      const hint = p === "translate" || p === "rotate" || p === "scale" ? ": use transform" : "";
      fail(`${p} isn't allowed in the icon's CSS (${where})${hint}; rules may set animation*, transform, transform-origin, transform-box, opacity, transition, fill and stroke`);
    }
    if (r.media && /prefers-reduced-motion\s*:\s*reduce/i.test(r.media)) {
      if (decls.some(([p, v]) => (p === "animation" || p === "animation-name") && /^none\b/i.test(v))) stopsForReducedMotion = true;
      continue;
    }
    const anim = decls.find(([p]) => p === "animation" || p === "animation-name");
    const trans = decls.find(([p]) => p === "transition" || p === "transition-property");
    if (trans && !trans[1].split(",").every((part) => /^(transform|opacity|none|\d)/.test(part.trim()))) fail(`${where} transitions something other than transform or opacity`);
    if (!anim && !trans) continue;
    if (anim && /^none\b/i.test(anim[1])) continue;
    if (anim) loops = true;
    // In the shorthand the first time is the duration; a second one is the delay.
    const durations = decls.flatMap(([p, v]) =>
      p === "animation" ? v.split(",").flatMap((part) => times(part).slice(0, 1)) : p === "animation-duration" ? times(v) : [],
    );
    for (const t of durations) if (t < 0.6 || t > 8) fail(`animation durations must be 0.6–8 s (found ${t} s in ${where})`);
    if (anim) {
      const names = anim[0] === "animation-name" ? anim[1].split(",").map((x) => x.trim()) : anim[1].split(",").map((part) => part.trim().split(/\s+/).find((w) => keyframes.has(w)) ?? "");
      names.forEach((name, k) => {
        const jumps = opacityJumps(keyframes.get(name) ?? "");
        const t = durations[k] ?? durations[0];
        if (jumps && t && jumps / t > 6) fail(`@keyframes ${name} flashes (opacity jumps over 0.5) faster than 3 times a second`);
      });
    }
    for (const sel of r.selector.split(",")) {
      const targets = select(sel, all, ids);
      if (targets === null) {
        fail(`animated selectors must be #id, .class or element names (with :host(.focused) or :host(.pressed)), not "${sel.trim().slice(0, 40)}"`);
        continue;
      }
      for (const t of targets) {
        if (t.name !== "g") fail(`only <g> elements may animate ("${sel.trim().slice(0, 40)}" matches a <${t.name}>)`);
        if (isInside(t, RESOURCES)) fail(`nothing inside <defs>, <clipPath> or gradients may animate ("${sel.trim().slice(0, 40)}")`);
        if (t.attrs.has("clip-path")) fail(`an animated group can't have clip-path ("${sel.trim().slice(0, 40)}")`);
        animated.add(t);
      }
    }
  }
  if (animated.size > MAX_ANIMATED_GROUPS) fail(`${animated.size} animated groups: at most ${MAX_ANIMATED_GROUPS}`);
  if (loops && !stopsForReducedMotion) fail("add @media (prefers-reduced-motion: reduce) { … { animation: none; } } so the icon can hold still");
  return errors;
}

const HEX = /^#[0-9a-fA-F]{3,8}$/;

/** The plain icon the Box writes when a game's own still fails after its extra turn: a ring and a dot, no motion. */
export function fallbackIcon(colors: { readonly plate?: string; readonly accent?: string } = {}): string {
  const plate = colors.plate && HEX.test(colors.plate) ? colors.plate : "#160b2b";
  const accent = colors.accent && HEX.test(colors.accent) ? colors.accent : "#ad8fff";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">`,
    `<rect width="256" height="256" fill="${plate}"/>`,
    `<circle cx="128" cy="128" r="64" fill="none" stroke="${accent}" stroke-width="14"/>`,
    `<circle cx="128" cy="128" r="22" fill="${accent}"/>`,
    `</svg>`,
    "",
  ].join("\n");
}
