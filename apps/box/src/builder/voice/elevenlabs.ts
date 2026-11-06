// ElevenLabs: Flash v2.5 text-to-speech into a content-addressed clip cache (a repeated question costs nothing), and
// Scribe speech-to-text for a recorded answer. Every call reserves its cost against the Box's monthly caps first
// (budget.ts) and is refused, quietly, when it wouldn't fit: the screen shows a caption, or the player taps a key. The
// key travels only in a header; logs carry the HTTP status, never the key or the request.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createBudget } from "./budget.ts";
import type { ElevenLabsVoice, SpokenLine } from "./port.ts";

const API = "https://api.elevenlabs.io";
export const TTS_MODEL = "eleven_flash_v2_5";
export const STT_MODEL = "scribe_v2";
const TTS_FORMAT = "mp3_44100_64";
/** Charlie, a stock voice: warm, game-show. */
export const DEFAULT_VOICE_ID = "IKne3meq5aSn9XLyUdCD";
/** The free tier's 10,000 credits are shared: text-to-speech gets 6,000 characters, listening the rest. */
export const DEFAULT_TTS_MAX_CHARS = 6000;
export const DEFAULT_STT_MAX_SECONDS = 40 * 60;
/** The longest line voiced; a question is far shorter. */
export const TTS_MAX_CHARS = 300;
const TTS_TIMEOUT_MS = 8000;
const STT_TIMEOUT_MS = 15_000;
/** Under this a clip is a click, not speech (ElevenLabs refuses under 100 ms anyway). */
const STT_MIN_BYTES = 1000;
const STT_MAX_BYTES = 2 * 1024 * 1024;
/** Compressed clips (webm/opus) carry no duration we parse: assume this many bytes a second. */
const COMPRESSED_BYTES_PER_SECOND = 6000;
/** Only names we make: a sha256 hex digest and .mp3 (no slashes, no dots, no case tricks). */
const CLIP = /^[0-9a-f]{64}\.mp3$/;

export interface ElevenLabsOptions {
  readonly apiKey: string;
  /** Clips and the budget files live here. */
  readonly dir: string;
  readonly voiceId?: string;
  readonly ttsMaxChars?: number;
  readonly sttMaxSeconds?: number;
  readonly fetch: typeof fetch;
  readonly now: () => number;
}

/** Seconds of audio in a clip: exact for PCM WAV, an estimate for anything else. */
export function clipSeconds(audio: Uint8Array, mime: string): number {
  if (audio.length >= 44 && mime.includes("wav") && String.fromCharCode(...audio.subarray(0, 4)) === "RIFF") {
    const byteRate = new DataView(audio.buffer, audio.byteOffset, audio.byteLength).getUint32(28, true);
    if (byteRate > 0) return (audio.length - 44) / byteRate;
  }
  return audio.length / COMPRESSED_BYTES_PER_SECOND;
}

export const clipName = (voice: string, text: string): string =>
  `${createHash("sha256").update(JSON.stringify([voice, TTS_MODEL, text])).digest("hex")}.mp3`;

export function createElevenLabsVoice(o: ElevenLabsOptions): ElevenLabsVoice {
  mkdirSync(o.dir, { recursive: true });
  const voice = o.voiceId || DEFAULT_VOICE_ID;
  const chars = createBudget(o.dir, "chars", o.ttsMaxChars ?? DEFAULT_TTS_MAX_CHARS, o.now);
  const seconds = createBudget(o.dir, "seconds", o.sttMaxSeconds ?? DEFAULT_STT_MAX_SECONDS, o.now);
  const inflight = new Map<string, Promise<SpokenLine>>();
  const call = (path: string, init: { body: string | FormData; headers?: Record<string, string>; timeoutMs: number }) =>
    o.fetch(`${API}${path}`, {
      method: "POST",
      headers: { "xi-api-key": o.apiKey, ...init.headers },
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs),
    });

  async function synthesize(text: string, file: string): Promise<SpokenLine> {
    const caption = { text, clip: null };
    try {
      const res = await call(`/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${TTS_FORMAT}`, {
        headers: { "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: TTS_MODEL }),
        timeoutMs: TTS_TIMEOUT_MS,
      });
      if (!res.ok) {
        console.warn(`[voice] text-to-speech refused: HTTP ${res.status}`);
        return caption;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!bytes.length) return caption;
      const path = join(o.dir, file);
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, path);
      // Spent only once a clip exists: a failed call isn't billed.
      chars.spend(text.length);
      return { text, clip: file };
    } catch (err) {
      console.warn(`[voice] text-to-speech failed: ${(err as Error).name}`);
      return caption;
    } finally {
      chars.release(text.length);
    }
  }

  return {
    mode: "elevenlabs",

    status: () => ({
      mode: "elevenlabs",
      reason: null,
      tts: { usedChars: chars.used(), limitChars: chars.limit },
      stt: { usedSeconds: Math.round(seconds.used()), limitSeconds: seconds.limit },
    }),

    async speak(raw) {
      const text = raw.trim();
      if (!text || text.length > TTS_MAX_CHARS) return { text, clip: null };
      const file = clipName(voice, text);
      if (existsSync(join(o.dir, file))) return { text, clip: file };
      const pending = inflight.get(file);
      if (pending) return pending;
      if (!chars.reserve(text.length)) {
        console.warn("[voice] the text-to-speech budget is spent: caption only");
        return { text, clip: null };
      }
      const job = synthesize(text, file).finally(() => inflight.delete(file));
      inflight.set(file, job);
      return job;
    },

    async transcribe(audio, mime) {
      if (audio.length < STT_MIN_BYTES || audio.length > STT_MAX_BYTES) return null;
      const type = mime.split(";")[0]!.trim() || "audio/webm";
      const cost = clipSeconds(audio, type);
      if (!seconds.reserve(cost)) {
        console.warn("[voice] the speech-to-text budget is spent: keys only");
        return null;
      }
      const ext = type.includes("wav") ? "wav" : type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
      const form = new FormData();
      form.set("model_id", STT_MODEL);
      form.set("language_code", "en");
      form.set("tag_audio_events", "false");
      form.set("file", new Blob([audio as Uint8Array<ArrayBuffer>], { type }), `answer.${ext}`);
      try {
        const res = await call("/v1/speech-to-text", { body: form, timeoutMs: STT_TIMEOUT_MS });
        if (!res.ok) {
          console.warn(`[voice] speech-to-text refused: HTTP ${res.status}`);
          return null;
        }
        // Billed whether or not anyone spoke: count it as soon as the call succeeded.
        seconds.spend(cost);
        const j = (await res.json()) as { text?: unknown };
        const text = typeof j.text === "string" ? j.text.trim() : "";
        return text || null;
      } catch (err) {
        console.warn(`[voice] speech-to-text failed: ${(err as Error).name}`);
        return null;
      } finally {
        seconds.release(cost);
      }
    },

    clipPath: (file) => (CLIP.test(file) ? join(o.dir, file) : null),
  };
}
