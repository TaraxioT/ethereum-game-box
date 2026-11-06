// The QR code after a claim: it points at the name in the ENS app, and its path draws one square per dark module.
import { encode } from "uqr";
import { describe, expect, it } from "vitest";

import { ensAppLink } from "./config.ts";
import { qrPath } from "./ui/qr.ts";

describe("the claim's QR code", () => {
  it("links the name's page in the ENS app on Sepolia", () => {
    expect(ensAppLink("judge-k3x9.gamebox.eth")).toBe("https://sepolia.app.ens.domains/judge-k3x9.gamebox.eth");
  });

  it("draws each dark module as a unit square, inside the quiet zone", () => {
    const path = qrPath(
      [
        [true, false],
        [false, true],
      ],
      3,
    );
    expect(path).toBe("M3 3h1v1h-1zM4 4h1v1h-1z");
  });

  it("encodes a name's link into a square matrix with as many squares as dark modules", () => {
    const { data, size } = encode(ensAppLink("judge-k3x9.gamebox.eth"), { ecc: "M", border: 0 });
    expect(data.length).toBe(size);
    expect(data.every((row) => row.length === size)).toBe(true);
    const dark = data.flat().filter(Boolean).length;
    expect(qrPath(data, 3).split("M").length - 1).toBe(dark);
  });
});
