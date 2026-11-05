// The voice port: speech-to-text for a player's answer, text-to-speech for the Designer's question. `mock` (the
// default) needs no network: it hears scripted lines and speaks captions. `elevenlabs` needs ELEVENLABS_API_KEY and
// spends credits, so it runs behind this Box's own monthly budgets. Nothing depends on voice: the Designer works fully
// by touch.

/** A spoken line: the words (always shown as a caption) and the clip to play, when one was made. */
export interface SpokenLine {
  readonly text: string;
  /** A clip file in the voice cache (served by the server through clipPath()); null: caption only. */
  readonly clip: string | null;
}

export interface VoiceStatus {
  readonly mode: "mock" | "elevenlabs";
  /** Why the Box is on mock when ElevenLabs was asked for (no key). */
  readonly reason: string | null;
  /** This month's use against the Box's caps (ElevenLabs only). */
  readonly tts: { readonly usedChars: number; readonly limitChars: number } | null;
  readonly stt: { readonly usedSeconds: number; readonly limitSeconds: number } | null;
}

interface VoiceBase {
  status(): VoiceStatus;
  /** The words in a recorded answer; null when nothing was heard (or it couldn't be transcribed). */
  transcribe(audio: Uint8Array, mime: string): Promise<string | null>;
  speak(text: string): Promise<SpokenLine>;
  /** The absolute path of a clip this port made, or null for any other name. */
  clipPath(file: string): string | null;
}

/** Scripted voice: each transcribe() hears the next scripted line. */
export interface MockVoice extends VoiceBase {
  readonly mode: "mock";
  /** Queue lines to be heard, one per transcribe(), in order. */
  script(lines: readonly string[]): void;
  pending(): number;
}

export interface ElevenLabsVoice extends VoiceBase {
  readonly mode: "elevenlabs";
}

export type VoicePort = MockVoice | ElevenLabsVoice;
