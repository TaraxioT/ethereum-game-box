// The Box's one track: a quiet loop while people gather round it. It fades in and out over 0.8 s, sinks under a
// spoken clip, and is paused (not left playing silently) once it has faded out or while the Box is muted. A track
// that can't load or play leaves the Box silent; nothing here throws.

/** The loop's volume: under the cues, never over them. */
export const MUSIC_VOLUME = 0.18;
/** How far it sinks while the Box speaks. */
export const DUCKED = 0.3;
export const FADE_MS = 800;
const STEP_MS = 50;

export interface Music {
  /** On fades the loop in; off fades it out, then pauses it. Safe to call on every change. */
  want(on: boolean): void;
  /** Sinks the loop under a voice clip, and brings it back up. */
  duck(on: boolean): void;
  setMuted(muted: boolean): void;
  /** Retries a start the browser blocked (call it on a gesture). */
  unlock(): void;
}

export function createMusic(url: string, muted: boolean): Music {
  let track: HTMLAudioElement | null = null;
  let wanted = false;
  let ducked = false;
  let fade: ReturnType<typeof setInterval> | null = null;

  const target = (): number => (wanted && !muted ? MUSIC_VOLUME * (ducked ? DUCKED : 1) : 0);

  function stopFade(): void {
    if (fade) clearInterval(fade);
    fade = null;
  }

  function sync(): void {
    try {
      if (!track) {
        if (!wanted) return;
        track = new Audio(url);
        track.loop = true;
        track.preload = "auto";
        track.volume = 0;
      }
      const audio = track;
      stopFade();
      if (muted) {
        audio.pause();
        audio.volume = 0;
        return;
      }
      const goal = target();
      if (goal > 0 && audio.paused) void audio.play().catch(() => undefined);
      const step = (MUSIC_VOLUME / FADE_MS) * STEP_MS;
      fade = setInterval(() => {
        const v = audio.volume;
        const next = v < goal ? Math.min(goal, v + step) : Math.max(goal, v - step);
        audio.volume = next;
        if (next !== goal) return;
        stopFade();
        if (goal === 0) audio.pause();
      }, STEP_MS);
    } catch {
      // No media element here: the Box runs without its music.
    }
  }

  return {
    want(on) {
      if (on === wanted) return;
      wanted = on;
      sync();
    },
    duck(on) {
      if (on === ducked) return;
      ducked = on;
      sync();
    },
    setMuted(next) {
      muted = next;
      sync();
    },
    unlock() {
      if (wanted && !muted && track?.paused) sync();
    },
  };
}
