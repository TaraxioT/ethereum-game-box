// A built game's icon as a still. An icon.svg may animate (the agent writes pulsing glows, as the team's icons have),
// and an animated SVG in an <img> repaints its cartridge on every frame: on the Pi each repaint is a GPU raster of the
// rack, and Home fell to 20–30 fps while such a cartridge stood there. The still is the same SVG with its CSS
// animations and transitions stopped and its SMIL animation elements taken out, so it keeps the art's own unanimated
// look and stays vector-sharp at any scale. It comes back as a data URL: the page's CSP allows data: images, not blob:.
const SVG_NS = "http://www.w3.org/2000/svg";
const FREEZE = "*, *::before, *::after { animation: none !important; transition: none !important; }";
const SMIL = "animate, animateMotion, animateTransform, animateColor, set";

/** The icon at `url`, its animation stopped, as a data URL; rejects when it can't be fetched or isn't an SVG. */
export async function stillIcon(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`icon ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.namespaceURI !== SVG_NS || svg.localName !== "svg") throw new Error("icon is not an SVG");
  for (const node of svg.querySelectorAll(SMIL)) node.remove();
  const style = doc.createElementNS(SVG_NS, "style");
  style.textContent = FREEZE;
  svg.append(style);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(doc))}`;
}
