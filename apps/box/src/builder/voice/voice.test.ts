// No test here reaches ElevenLabs: every ElevenLabs voice gets a fetch that records the call and answers itself.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createBudget } from "./budget.ts";
import { clipSeconds, createElevenLabsVoice } from "./elevenlabs.ts";
import { createMockVoice } from "./mock.ts";
import { createVoice } from "./select.ts";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "egb-voice-"));
const NOV = Date.UTC(2026, 10, 6);

/** A fetch that never leaves the process: it records each call and answers with `reply`. */
function offline(reply: (url: string) => Response = () => new Response(new Uint8Array([1, 2, 3]))) {
  const calls: string[] = [];
  const fetchFn = (async (url: string) => {
    calls.push(url);
    return reply(url);
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

/** A 16-bit mono PCM WAV of `seconds` at 16 kHz. */
function wav(seconds: number): Uint8Array {
  const data = Math.round(seconds * 16000 * 2);
  const b = new Uint8Array(44 + data);
  const v = new DataView(b.buffer);
  b.set([0x52, 0x49, 0x46, 0x46]);
  v.setUint32(28, 32000, true);
  return b;
}

describe("picking the voice", () => {
  it("is mock by default, and never ElevenLabs without the key", () => {
    const f = offline();
    expect(createVoice({}, { dir: tmp(), fetch: f.fetchFn }).mode).toBe("mock");
    expect(createVoice({ ELEVENLABS_API_KEY: "k" }, { dir: tmp(), fetch: f.fetchFn }).mode).toBe("mock");
    const asked = createVoice({ EGB_VOICE: "elevenlabs" }, { dir: tmp(), fetch: f.fetchFn });
    expect(asked.mode).toBe("mock");
    expect(asked.status().reason).toMatch(/needs ELEVENLABS_API_KEY/);
    expect(createVoice({ EGB_VOICE: "elevenlabs", ELEVENLABS_API_KEY: "  " }, { dir: tmp(), fetch: f.fetchFn }).mode).toBe("mock");
    expect(createVoice({ EGB_VOICE: "elevenlabs", ELEVENLABS_API_KEY: "k" }, { dir: tmp(), fetch: f.fetchFn }).mode).toBe("elevenlabs");
    expect(f.calls).toEqual([]);
  });

  it("takes the caps from the env", () => {
    const v = createVoice({ EGB_VOICE: "elevenlabs", ELEVENLABS_API_KEY: "k", EGB_VOICE_TTS_MAX_CHARS: "100", EGB_VOICE_STT_MAX_MIN: "2" }, { dir: tmp(), fetch: offline().fetchFn, now: () => NOV });
    expect(v.status()).toEqual({ mode: "elevenlabs", reason: null, tts: { usedChars: 0, limitChars: 100 }, stt: { usedSeconds: 0, limitSeconds: 120 } });
  });
});

describe("the mock voice", () => {
  it("hears its script in order and speaks captions only", async () => {
    const v = createMockVoice();
    v.script(["one", " ", "two"]);
    expect(v.pending()).toBe(2);
    expect(await v.transcribe(new Uint8Array(), "audio/wav")).toBe("one");
    expect(await v.transcribe(new Uint8Array(), "audio/wav")).toBe("two");
    expect(await v.transcribe(new Uint8Array(), "audio/wav")).toBeNull();
    expect(await v.speak("Who calls the game?")).toEqual({ text: "Who calls the game?", clip: null });
  });
});

describe("the budget guard", () => {
  it("refuses what wouldn't fit, counts holds in flight, persists, and restarts each month", async () => {
    const dir = tmp();
    let now = NOV;
    const b = createBudget(dir, "chars", 100, () => now);
    expect(b.reserve(60)).toBe(true);
    expect(b.reserve(50)).toBe(false); // 60 held + 50 > 100
    await b.spend(60);
    b.release(60);
    expect(b.used()).toBe(60);
    expect(createBudget(dir, "chars", 100, () => now).used()).toBe(60);
    expect(JSON.parse(readFileSync(path.join(dir, "tts-usage.json"), "utf8"))).toEqual({ period: "2026-11", used: 60 });
    expect(b.reserve(41)).toBe(false);
    expect(b.reserve(40)).toBe(true);
    now = Date.UTC(2026, 11, 1);
    expect(b.used()).toBe(0);
  });

  it("counts a total it can't read as the whole cap spent, until the month turns; an old month's as nothing", async () => {
    const dir = tmp();
    let now = NOV;
    writeFileSync(path.join(dir, "tts-usage.json"), '{"period":"2026-11","us');
    const torn = createBudget(dir, "chars", 100, () => now);
    expect(torn.used()).toBe(100);
    expect(torn.reserve(1)).toBe(false);
    now = Date.UTC(2026, 11, 1);
    expect(torn.used()).toBe(0);
    await torn.spend(5);
    expect(createBudget(dir, "chars", 100, () => now).used()).toBe(5);
    writeFileSync(path.join(dir, "stt-usage.json"), JSON.stringify({ period: "2026-11", used: 80 }));
    expect(createBudget(dir, "seconds", 100, () => now).used()).toBe(0);
    writeFileSync(path.join(dir, "stt-usage.json"), JSON.stringify({ period: "2026-12", used: "lots" }));
    expect(createBudget(dir, "seconds", 100, () => now).used()).toBe(100);
    // Saved whole: no temp file is left beside the totals.
    expect(readdirSync(dir).sort()).toEqual(["stt-usage.json", "tts-usage.json"]);
  });

  it("ElevenLabs speech stops at the cap: no request once the characters are spent", async () => {
    const f = offline();
    const v = createElevenLabsVoice({ apiKey: "k", dir: tmp(), ttsMaxChars: 30, fetch: f.fetchFn, now: () => NOV });
    const first = await v.speak("What's the twist?"); // 17 characters
    expect(first.clip).toMatch(/^[0-9a-f]{64}\.mp3$/);
    expect(await v.speak("What's the twist?")).toEqual(first); // cached: free
    expect(await v.speak("Who calls the game?")).toEqual({ text: "Who calls the game?", clip: null }); // 17 + 19 > 30
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatch(/^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/IKne3meq5aSn9XLyUdCD\?/);
    expect(v.clipPath(first.clip!)).toBe(path.join(path.dirname(v.clipPath(first.clip!)!), first.clip!));
    expect(v.clipPath("../tts-usage.json")).toBeNull();
  });

  it("ElevenLabs listening stops at the cap: no request for a clip that would go past it", async () => {
    const f = offline(() => new Response(JSON.stringify({ text: " Deep space. " })));
    const v = createElevenLabsVoice({ apiKey: "k", dir: tmp(), sttMaxSeconds: 5, fetch: f.fetchFn, now: () => NOV });
    expect(clipSeconds(wav(3), "audio/wav")).toBe(3);
    expect(await v.transcribe(wav(3), "audio/wav")).toBe("Deep space.");
    expect(await v.transcribe(wav(3), "audio/wav")).toBeNull(); // 3 + 3 > 5
    expect(await v.transcribe(new Uint8Array(10), "audio/wav")).toBeNull(); // a click, not speech
    expect(f.calls).toEqual(["https://api.elevenlabs.io/v1/speech-to-text"]);
    expect(v.status().stt).toEqual({ usedSeconds: 3, limitSeconds: 5 });
  });

  it("a refused call isn't billed", async () => {
    const f = offline(() => new Response("{}", { status: 401 }));
    const v = createElevenLabsVoice({ apiKey: "k", dir: tmp(), fetch: f.fetchFn, now: () => NOV });
    expect((await v.speak("Hello")).clip).toBeNull();
    expect(await v.transcribe(wav(2), "audio/wav")).toBeNull();
    expect(v.status()).toMatchObject({ tts: { usedChars: 0 }, stt: { usedSeconds: 0 } });
  });
});
