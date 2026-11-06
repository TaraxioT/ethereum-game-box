# packages/sdk/src/bundle

`@egb/sdk/bundle`: the game bundle format, with its one reader and its one packer. It runs unchanged on the Box, in a
Worker and in a browser. It uses WebCrypto for the hash, with no Node and no DOM. A browser needs a secure context for
WebCrypto: `https`, or `localhost`.

A bundle is a zip of `index.html`, `manifest.json` and any assets the page uses by relative path. Its identity is the
sha256 of the zip, as `0x` hex. Its code is untrusted: it runs only in the kiosk's sandboxed frame, and never in Node.

| Module | Holds |
|---|---|
| `format.ts` | `BundleManifest`, `bundleManifestProblems()`, `nameProblem()`, `BUNDLE_LIMITS`, `BundleRefused`, and `judgeFiles()`, the checks the reader and the packer share |
| `read.ts` | `readBundle(zip)`: the manifest, the files and the hash, or a `BundleRefused` saying why not |
| `pack.ts` | `packBundle(files)`: a map of names to bytes as the one zip shape, and the shape's fixed fields |
| `index.ts` | The entry: everything above except the internals |

## What a bundle may hold

- **At most:** 16 MB a zip, 64 files, and 120 bytes a name.
- **Names:** `manifest.json`, or lower-case ASCII paths ending in `.html`, `.css`, `.js`, `.png`, `.jpg`, `.webp`,
  `.svg`, `.woff2` or `.mp3`. Folders are fine; `..`, dotfiles, capitals and backslashes aren't.
- **The manifest:** the fields in plan section 6 and no others, with its layout free. A repeated key is refused, so
  nobody can read one set of instructions while the parser takes another.
- **Its words:** `title` and `blurb` are printable ASCII on one line, the stations' own alphabet. `verifier.instructions`
  is printable ASCII and newlines, with at most 4 spaces or newlines in a row. The team's review is the only control on
  what the judge is told, so what a reader sees must be all there is: no invisible or right-to-left characters, no
  look-alikes, and no words pushed out of sight. That covers how the words look, not what they say, so they still need
  reading to the end. `minutes` is the match's time limit, 1 to 30.

## The one shape

The reader accepts what the packer writes and nothing else, so a zip from any other tool is refused:

- Names are sorted by byte. Every field is fixed: no timestamps, no extras, no comments, mode 0644.
- Entries tile the file from byte 0 to the directory, with no gaps, overlaps or trailing bytes.
- Every file is stored, never compressed. A compressed file is refused at its header, before a byte is inflated, so a
  zip bomb costs nothing. Then each file's CRC is checked.

**Why nothing is compressed.** Deflate has many valid spellings, so the reader could prove a stream was the packer's only
by compressing the files again. That took 2.2 s for each MB of a crafted text, in one synchronous call on the thread that
runs the taps and the screen, and it needed a compressor pinned for good, since a new version would refuse every bundle
already published. Stored, a file has one spelling and a read is one pass over the zip. The price is size: text isn't
smaller in the zip, so a game that is mostly text downloads two to four times larger.

Measured on a Mac under Node 26: the full 16 MB of that crafted text reads in 0.11 s, with about 50 MB of memory on top of
the zip. A pinned hash in `pack.test.ts` fails if the packer's bytes ever change.

## Tests

The tests live in `packages/sdk/test/bundle/`, with Node's types: `tsconfig.json` keeps `src/` free of them.

| File | Covers |
|---|---|
| `hostile.test.ts` | Every hostile zip, each the good bundle with one thing wrong and refused for that reason. Any one byte changed, cut or added |
| `pack.test.ts` | Packing twice to one hash, the pinned hash, the limits to the byte, what the packer refuses |
| `format.test.ts` | Every manifest and name refusal |
| `tap-rush.test.ts` | The sample: its folder, its instructions worked by hand, and its page |
| `raw-zip.ts` | A zip writer that does as it is told, for the hostile zips |
