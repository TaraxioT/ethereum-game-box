// The builder's event stream read back, frame by frame: the screen's builder link and the server's tests both read it
// with this, so a test sees exactly what the screen sees. builder-stream.ts writes the frames (`event: <name>`,
// `data: <json>`, a blank line; `: ping` comments between). No DOM, no Node: fetch's streams only.
import type { BuilderEventName, BuilderEvents } from "./builder-wire.ts";

export type BuilderFrameListener = <K extends BuilderEventName>(event: K, data: BuilderEvents[K]) => void;

/** A reader for the stream's text as it arrives, in any pieces: `onFrame` hears each whole frame once, in order. */
export function createFrameReader(onFrame: BuilderFrameListener): (text: string) => void {
  let buffer = "";
  return (text) => {
    buffer += text;
    for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1] as BuilderEventName | undefined;
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (event && data) onFrame(event, JSON.parse(data) as never);
    }
  };
}

/** Reads a stream's body to its end (or until it is aborted, which rejects), frame by frame. */
export async function readFrames(body: ReadableStream<Uint8Array<ArrayBuffer>>, onFrame: BuilderFrameListener): Promise<void> {
  const read = createFrameReader(onFrame);
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    read(value);
  }
}
