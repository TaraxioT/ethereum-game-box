import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fallbackIcon, ICON_MAX_BYTES, iconProblems, parseSvg } from "./icon.ts";
import { loadRecording } from "./sim.ts";

/** An icon with `style` as its stylesheet and `body` as its shapes. */
const icon = (style: string, body = `<g class="a"><circle cx="128" cy="128" r="40" fill="#fff"/></g>`) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><style>${style}</style>${body}</svg>`;
const REDUCED = "@media (prefers-reduced-motion: reduce) { .a { animation: none; } }";
const problems = (svg: string) => iconProblems(svg).join("\n");

describe("the icon check", () => {
  it("passes the fixture template's icon, the recorded game's and the fallback", () => {
    expect(iconProblems(readFileSync(new URL("./fixtures/tap-three/icon.svg", import.meta.url), "utf8"))).toEqual([]);
    const written = loadRecording("/g", "g").flatMap(({ msg }) => (Array.isArray(msg.message?.content) ? msg.message.content : []));
    const svg = written.find((b) => b.type === "tool_use" && (b.input as { file_path?: string }).file_path === "/g/icon.svg");
    expect(iconProblems(String((svg?.input as { content: string }).content))).toEqual([]);
    expect(iconProblems(fallbackIcon())).toEqual([]);
    expect(iconProblems(fallbackIcon({ plate: '"><script>x()</script>', accent: "url(https://x)" }))).toEqual([]);
    expect(fallbackIcon()).not.toMatch(/animation|<text/);
  });

  it("checks size, root, viewBox and namespace", () => {
    expect(problems(icon("", `<path d="M0 0${" L1 1".repeat(3000)}"/>`))).toMatch(/limit is 12 KB/);
    expect(ICON_MAX_BYTES).toBe(12_288);
    expect(problems(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>`)).toMatch(/viewBox="0 0 256 256"/);
    expect(problems(`<svg viewBox="0 0 256 256"></svg>`)).toMatch(/xmlns/);
    expect(problems(`<g/>`)).toMatch(/root element must be <svg>/);
    expect(problems(`<svg viewBox="0 0 256 256"><g></svg>`)).toMatch(/well-formed/);
    expect(problems(`<!DOCTYPE svg><svg viewBox="0 0 256 256"/>`)).toMatch(/DOCTYPE/);
  });

  it("refuses scripts, foreign objects, SMIL, filters, text and every external reference", () => {
    const cases: [string, RegExp][] = [
      [icon("", `<script>alert(1)</script>`), /no <script>/],
      [icon("", `<foreignObject><div/></foreignObject>`), /foreignObject/],
      [icon("", `<g><animateTransform attributeName="transform"/></g>`), /SMIL/],
      [icon("", `<set attributeName="fill" to="red"/>`), /SMIL/],
      [icon("", `<filter id="f"/>`), /no filters/],
      [icon("", `<image href="#a"/>`), /no <image>/],
      [icon("", `<a href="#x"><rect width="1" height="1"/></a>`), /no links/],
      [icon("", `<text x="1" y="1">A</text>`), /no <text>/],
      [icon("", `<rect width="1" height="1" onclick="x()"/>`), /event attributes/],
      [icon("", `<rect width="1" height="1" style="fill:red"/>`), /attribute style isn't allowed/],
      [icon("", `<use href="https://evil.example/x.svg#a"/>`), /href may only point inside/],
      [icon("", `<use xlink:href="#a"/>`), /xlink:href isn't allowed/],
      [icon("", `<rect width="1" height="1" fill="url(https://x/y)"/>`), /url\(\) may only point inside/],
      [icon("", `<rect width="1" height="1" fill="data:image/png"/>`), /no javascript: or data:/],
      [icon(".a { fill: url('http://x/y.png'); }"), /url\(\) may only point inside/],
      [icon("@import url(#x);"), /@import/],
      [icon(".a { filter: blur(2px); }"), /filter isn't allowed/],
      [icon(".a { mix-blend-mode: screen; }"), /mix-blend-mode isn't allowed/],
      [icon("", `<use href="#a" x="3"/>`), /<use> can't have x or y/],
      [icon("", `<svg/>`), /no nested <svg>/],
      [icon("").replace("<style></style>", "<style></style><style></style>"), /one <style>/],
    ];
    for (const [svg, want] of cases) expect(problems(svg), svg).toMatch(want);
  });

  it("lets only <g> groups animate, only transform and opacity, never via translate/rotate/scale", () => {
    const kf = (body: string) => `.a { animation: k 2s infinite; } @keyframes k { from { ${body} } to { ${body} } } ${REDUCED}`;
    expect(problems(icon(kf("fill: red;")))).toMatch(/animates fill: only transform and opacity/);
    expect(iconProblems(icon(kf("opacity: 0.5;")))).toEqual([]);
    expect(problems(icon(".a { rotate: 10deg; }"))).toMatch(/rotate isn't allowed.*use transform/);
    expect(problems(icon(".a { transition: fill 1s; }"))).toMatch(/transitions something other/);
    expect(iconProblems(icon(":host(.focused) .a { transform: scale(1.1); transition: transform 0.6s; }"))).toEqual([]);
    expect(problems(icon(`.p { animation: k 2s infinite; } @keyframes k { to { opacity: 0; } } ${REDUCED}`, `<path class="p" d="M0 0"/>`))).toMatch(/only <g> elements may animate/);
    expect(problems(icon(`.a { animation: k 2s infinite; } @keyframes k { to { opacity: 0; } } ${REDUCED}`, `<defs><g class="a"/></defs>`))).toMatch(/inside <defs>/);
    expect(problems(icon(`[data-x] { animation: k 2s infinite; } @keyframes k { to { opacity: 0.6; } } ${REDUCED}`))).toMatch(/#id, \.class or element names/);
    expect(problems(icon(`.a { animation: k 2s infinite; } @keyframes k { to { opacity: 0; } } ${REDUCED}`, `<g class="a" clip-path="url(#c)"/>`))).toMatch(/can't have clip-path/);
  });

  it("holds the budgets: groups, shapes, durations, flashes and reduced motion", () => {
    const groups = Array.from({ length: 7 }, (_, i) => `<g class="g${i}"><rect width="1" height="1"/></g>`).join("");
    const styles = Array.from({ length: 7 }, (_, i) => `.g${i} { animation: k 2s infinite; }`).join(" ");
    expect(problems(icon(`${styles} @keyframes k { to { opacity: 0.6; } } @media (prefers-reduced-motion: reduce) { g { animation: none; } }`, groups))).toMatch(/7 animated groups: at most 6/);
    expect(problems(icon("", `<rect width="1" height="1"/>`.repeat(151)))).toMatch(/151 drawn elements/);
    expect(problems(icon(`.a { animation: k 0.2s infinite; } @keyframes k { to { opacity: 0.6; } } ${REDUCED}`))).toMatch(/found 0\.2 s/);
    expect(problems(icon(`.a { animation: k 9000ms infinite; } @keyframes k { to { opacity: 0.6; } } ${REDUCED}`))).toMatch(/found 9 s/);
    expect(iconProblems(icon(`.a { animation: k 2s 10s infinite; } @keyframes k { to { opacity: 0.6; } } ${REDUCED}`))).toEqual([]);
    expect(problems(icon(`.a { animation: k 2s infinite; } @keyframes k { to { opacity: 0.6; } }`))).toMatch(/prefers-reduced-motion/);
    const flash = (t: string) => icon(`.a { animation: f ${t} infinite; } @keyframes f { 0% { opacity: 0; } 25% { opacity: 1; } 50% { opacity: 0; } 75% { opacity: 1; } 100% { opacity: 0; } } ${REDUCED}`);
    expect(problems(flash("0.6s"))).toMatch(/flashes/);
    expect(iconProblems(flash("2s"))).toEqual([]);
  });

  it("stops <use> copies from multiplying", () => {
    let body = `<defs><g id="l0"><circle cx="1" cy="1" r="1"/></g>`;
    for (let i = 1; i <= 15; i++) body += `<g id="l${i}">${`<use href="#l${i - 1}"/>`.repeat(10)}</g>`;
    body += `</defs><use href="#l15"/>`;
    expect(problems(icon("", body))).toMatch(/contains another <use>/);
    expect(problems(icon("", `<use id="u" href="#u"/>`))).toMatch(/contains another <use>/);
    expect(problems(icon("", `<use href="#nope"/>`))).toMatch(/points at no element/);
    const shapes = `<defs><g id="s">${`<rect width="1" height="1"/>`.repeat(20)}</g></defs>`;
    expect(iconProblems(icon("", `${shapes}${`<use href="#s"/>`.repeat(5)}`))).toEqual([]);
    expect(problems(icon("", `${shapes}${`<use href="#s"/>`.repeat(10)}`))).toMatch(/draws 2\d\d shapes once each <use> is copied/);
  });

  it("parses strictly", () => {
    const n = parseSvg(`<?xml version="1.0"?><!-- c --><svg a="x &amp; y" b='2'><style><![CDATA[.a{}]]></style></svg>`);
    expect(n.attrs.get("a")).toBe("x & y");
    expect(n.children[0]?.text).toBe(".a{}");
    expect(() => parseSvg(`<svg><g></svg>`)).toThrow(/doesn't close/);
    expect(() => parseSvg(`<svg a="1" a="2"/>`)).toThrow(/duplicate/);
    expect(() => parseSvg(`<svg/><svg/>`)).toThrow(/more than one root/);
    expect(() => parseSvg(`<?php x ?><svg/>`)).toThrow(/processing instructions/);
  });
});
