// Push-to-talk recording: the microphone opens when the key goes down and closes when it comes up (its tracks are
// stopped, so the mic is never left live), and the take comes back as one compressed blob (webm/opus in Chromium).
// A take is cut at MAX_TAKE_MS, so a key held down or stuck never streams a long recording up.
export const MAX_TAKE_MS = 15_000;
/** Shorter than this is a tap on the key, not an answer: nothing is sent. */
export const MIN_TAKE_MS = 300;

export interface Recorder {
  /** Opens the mic and starts a take. Rejects when there is no mic or the page may not use it. */
  start(): Promise<void>;
  /** Ends the take: its audio, or null when it was too short or never started. */
  stop(): Promise<Blob | null>;
  readonly recording: boolean;
}

export const canRecord = (): boolean => typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

export function createRecorder(): Recorder {
  let take: { readonly recorder: MediaRecorder; readonly stream: MediaStream; readonly chunks: Blob[]; readonly at: number; readonly cut: ReturnType<typeof setTimeout> } | null = null;

  function release(stream: MediaStream): void {
    for (const track of stream.getTracks()) track.stop();
  }

  return {
    get recording() {
      return take !== null;
    },

    async start() {
      if (take) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.start();
      take = { recorder, stream, chunks, at: performance.now(), cut: setTimeout(() => recorder.state === "recording" && recorder.stop(), MAX_TAKE_MS) };
    },

    async stop() {
      const t = take;
      take = null;
      if (!t) return null;
      clearTimeout(t.cut);
      if (t.recorder.state !== "inactive") {
        await new Promise<void>((done) => {
          t.recorder.onstop = () => done();
          t.recorder.stop();
        });
      }
      release(t.stream);
      if (performance.now() - t.at < MIN_TAKE_MS || t.chunks.length === 0) return null;
      return new Blob(t.chunks, { type: t.recorder.mimeType || "audio/webm" });
    },
  };
}
