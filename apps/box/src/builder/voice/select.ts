// Picks the voice from the env: `mock` unless EGB_VOICE=elevenlabs AND ELEVENLABS_API_KEY is set. Asking for
// ElevenLabs without the key stays on mock and says why, so a missing key never spends anything or breaks the
// Designer. Both are needed on purpose: a key in the env file alone never starts spending credits.
import { createElevenLabsVoice } from "./elevenlabs.ts";
import { createMockVoice } from "./mock.ts";
import type { VoicePort } from "./port.ts";

export interface VoiceDeps {
  /** Where clips and the budget files live: `$EGB_DATA/voice`. */
  readonly dir: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

const positive = (v: string | undefined): number | undefined => {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? n : undefined;
};

export function createVoice(env: Readonly<Record<string, string | undefined>>, deps: VoiceDeps): VoicePort {
  if (env.EGB_VOICE !== "elevenlabs") return createMockVoice();
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return createMockVoice("EGB_VOICE=elevenlabs needs ELEVENLABS_API_KEY: voice is mock.");
  const minutes = positive(env.EGB_VOICE_STT_MAX_MIN);
  const chars = positive(env.EGB_VOICE_TTS_MAX_CHARS);
  return createElevenLabsVoice({
    apiKey,
    dir: deps.dir,
    ...(env.EGB_VOICE_ID ? { voiceId: env.EGB_VOICE_ID } : {}),
    ...(chars ? { ttsMaxChars: Math.floor(chars) } : {}),
    ...(minutes ? { sttMaxSeconds: minutes * 60 } : {}),
    fetch: deps.fetch ?? fetch,
    now: deps.now ?? Date.now,
  });
}
