// The music loop on a stand-in audio element and fake timers: it fades, sinks under a voice, and pauses when it's
// faded out or muted. Nothing here makes a sound.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMusic, DUCKED, FADE_MS, MUSIC_VOLUME } from "./music.ts";

class FakeAudio {
  static made: FakeAudio[] = [];
  volume = 1;
  paused = true;
  loop = false;
  preload = "";
  constructor(readonly src: string) {
    FakeAudio.made.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

const track = (): FakeAudio => {
  const made = FakeAudio.made.at(-1);
  if (!made) throw new Error("no track");
  return made;
};

describe("the music", () => {
  beforeEach(() => {
    FakeAudio.made = [];
    vi.useFakeTimers();
    vi.stubGlobal("Audio", FakeAudio);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("loads nothing until it is wanted, then loops and fades in to its quiet level", () => {
    const music = createMusic("loop.mp3", false);
    expect(FakeAudio.made).toHaveLength(0);
    music.want(true);
    expect(track().loop).toBe(true);
    expect(track().paused).toBe(false);
    expect(track().volume).toBe(0);
    vi.advanceTimersByTime(FADE_MS / 2);
    expect(track().volume).toBeGreaterThan(0);
    expect(track().volume).toBeLessThan(MUSIC_VOLUME);
    vi.advanceTimersByTime(FADE_MS);
    expect(track().volume).toBeCloseTo(MUSIC_VOLUME);
  });

  it("fades out and then pauses", () => {
    const music = createMusic("loop.mp3", false);
    music.want(true);
    vi.advanceTimersByTime(FADE_MS * 2);
    music.want(false);
    expect(track().paused).toBe(false);
    vi.advanceTimersByTime(FADE_MS * 2);
    expect(track().volume).toBe(0);
    expect(track().paused).toBe(true);
  });

  it("sinks under a voice clip and comes back up", () => {
    const music = createMusic("loop.mp3", false);
    music.want(true);
    vi.advanceTimersByTime(FADE_MS * 2);
    music.duck(true);
    vi.advanceTimersByTime(FADE_MS * 2);
    expect(track().volume).toBeCloseTo(MUSIC_VOLUME * DUCKED);
    expect(track().paused).toBe(false);
    music.duck(false);
    vi.advanceTimersByTime(FADE_MS * 2);
    expect(track().volume).toBeCloseTo(MUSIC_VOLUME);
  });

  it("is paused, not silent, while muted, and starts again unmuted", () => {
    const music = createMusic("loop.mp3", true);
    music.want(true);
    expect(track().paused).toBe(true);
    music.setMuted(false);
    expect(track().paused).toBe(false);
    music.setMuted(true);
    expect(track().paused).toBe(true);
  });
});
