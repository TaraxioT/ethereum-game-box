// The mock voice: no network, no credits. It "hears" the next scripted line whatever audio it is given, and speaks
// every line as a caption only. The Designer scripts it with the answers a player would give (designer/script.ts).
import type { MockVoice } from "./port.ts";

export function createMockVoice(reason: string | null = null): MockVoice {
  const lines: string[] = [];
  return {
    mode: "mock",
    status: () => ({ mode: "mock", reason, tts: null, stt: null }),
    script(batch) {
      for (const line of batch) if (line.trim()) lines.push(line.trim());
    },
    pending: () => lines.length,
    transcribe: async () => lines.shift() ?? null,
    speak: async (text) => ({ text, clip: null }),
    clipPath: () => null,
  };
}
