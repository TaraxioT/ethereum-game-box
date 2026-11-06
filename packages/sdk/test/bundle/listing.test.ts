// A listing is the reader's result and the zip's size, with nothing else from the manifest.
import { describe, expect, it } from "vitest";
import { listingOf, packBundle, readBundle } from "../../src/bundle/index.ts";
import { goodFiles, MANIFEST } from "./fixture.ts";

describe("listingOf", () => {
  it("holds the store's fields and no others", async () => {
    const zip = packBundle(goodFiles());
    const bundle = await readBundle(zip);
    const { id, title, blurb, players, stakes } = MANIFEST;
    expect(listingOf(bundle, zip.length)).toEqual({ id, title, blurb, players, stakes, icon: null, hash: bundle.hash, size: zip.length });
  });
});
