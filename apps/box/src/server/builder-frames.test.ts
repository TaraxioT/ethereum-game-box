// The builder stream's reader, shared by the screen and the server's tests: whole frames, in order, however the text
// is cut up on the way, with the stream's comments skipped. (The builder route tests read the real stream with it.)
import { describe, expect, it } from "vitest";
import { createFrameReader, readFrames } from "./builder-frames.ts";

const TEXT = [
  'event: hello\ndata: {"designer":null}\n\n',
  ": ping\n\n",
  'event: forge\ndata: {"type":"say","job":"j1","at":1,"text":"a\\n\\nb"}\n\n',
  "event: forge\ndata: ",
].join("");

describe("the builder stream's reader", () => {
  it("hears each whole frame once, in order, from text cut anywhere, and skips comments", () => {
    for (const size of [1, 3, 7, TEXT.length]) {
      const heard: [string, unknown][] = [];
      const read = createFrameReader((event, data) => heard.push([event, data]));
      for (let i = 0; i < TEXT.length; i += size) read(TEXT.slice(i, i + size));
      expect(heard, `pieces of ${size}`).toEqual([
        ["hello", { designer: null }],
        ["forge", { type: "say", job: "j1", at: 1, text: "a\n\nb" }],
      ]);
    }
  });

  it("reads a fetch body to its end", async () => {
    const bytes = new TextEncoder().encode(TEXT);
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 10));
        controller.enqueue(bytes.slice(10));
        controller.close();
      },
    });
    const heard: string[] = [];
    await readFrames(body, (event) => void heard.push(event));
    expect(heard).toEqual(["hello", "forge"]);
  });
});
