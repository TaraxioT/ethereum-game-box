// A QR code as inline SVG: dark modules on a light plate with a quiet zone, so a phone camera reads it on the dark
// site. One path, one module per unit.
import { encode } from "uqr";

const SVG = "http://www.w3.org/2000/svg";

/** The SVG path of a module matrix: one `h1v1h-1z` square per dark module, offset by `border`. */
export function qrPath(modules: readonly (readonly boolean[])[], border: number): string {
  let d = "";
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x + border} ${y + border}h1v1h-1z`;
    });
  });
  return d;
}

/** `text` as a QR code, `size` CSS pixels square. */
export function qrCode(text: string, size = 168): SVGSVGElement {
  const border = 3;
  const { data } = encode(text, { ecc: "M", border: 0 });
  const side = data.length + border * 2;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${side} ${side}`);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `QR code: ${text}`);
  svg.classList.add("qr");
  const plate = document.createElementNS(SVG, "rect");
  plate.setAttribute("width", String(side));
  plate.setAttribute("height", String(side));
  plate.setAttribute("fill", "#f4fbff");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", qrPath(data, border));
  path.setAttribute("fill", "#021018");
  svg.append(plate, path);
  return svg;
}
