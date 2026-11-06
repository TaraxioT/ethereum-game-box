import { describe, expect, it } from "vitest";
import { FreshIds, RESEND_IDS, RESEND_MS } from "./fresh-ids.ts";

const ST = "e4ba70";

describe("FreshIds", () => {
  it("takes newer ids and ignores the latest again or an older one", () => {
    const ids = new FreshIds();
    expect(ids.fresh("tap", ST, 5, 0)).toBe(true);
    expect(ids.fresh("tap", ST, 6, 10)).toBe(true);
    expect(ids.fresh("tap", ST, 6, 20)).toBe(false);
    expect(ids.fresh("tap", ST, 5, 30)).toBe(false);
    expect(ids.fresh("tap", ST, 7, 40)).toBe(true);
  });

  it("keeps each station and each kind of line apart", () => {
    const ids = new FreshIds();
    expect(ids.fresh("tap", ST, 5, 0)).toBe(true);
    expect(ids.fresh("gone", ST, 5, 0)).toBe(true);
    expect(ids.fresh("tap", "df3d88", 5, 0)).toBe(true);
    expect(ids.fresh("gone", ST, 4, 0)).toBe(false);
  });

  it("compares across the u32 wrap", () => {
    const ids = new FreshIds();
    expect(ids.fresh("signed", ST, 0xffff_ffff, 0)).toBe(true);
    expect(ids.fresh("signed", ST, 1, 10)).toBe(true);
    expect(ids.fresh("signed", ST, 0xffff_fffe, 20)).toBe(false);
  });

  it("takes a restarted count: an id far behind, or an older one after RESEND_MS", () => {
    const ids = new FreshIds();
    expect(ids.fresh("tap", ST, 500, 0)).toBe(true);
    expect(ids.fresh("tap", ST, 500 - RESEND_IDS, 10)).toBe(true);
    expect(ids.fresh("tap", ST, 3, 20)).toBe(true);
    expect(ids.fresh("tap", ST, 1, 20 + RESEND_MS - 1)).toBe(false);
    expect(ids.fresh("tap", ST, 1, 20 + RESEND_MS)).toBe(true);
  });
});
