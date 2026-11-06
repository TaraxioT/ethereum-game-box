// The Box's sounds: every one synthesized on the spot (catalogue.ts) through one bus and compressor (synth.ts), and
// the one music loop (music.ts). The kiosk's Chromium lets audio start without a touch; a normal browser keeps it
// locked until the first gesture, which unlocks both. Muting is remembered (localStorage `gamebox-muted=1`) and
// silences the cues and pauses the music. The same sound for the same seat again within 25 ms is dropped, so a moment
// heard twice (a replayed event) sounds once. Nothing here ever throws into a caller: with no audio, the Box is silent.
import type { Sound } from "../views/view.ts";
import { soundEntry, type SoundName, type SoundOptions } from "./catalogue.ts";
import { createMusic } from "./music.ts";
import { Synth } from "./synth.ts";
import musicUrl from "./digital-dividend.mp3?url";

const MUTED_KEY = "gamebox-muted";
const GESTURES = ["pointerdown", "keydown", "touchstart"] as const;
/** How far a seat's sound leans to its side. */
const PAN = 0.55;
const DEDUPE_MS = 25;
/** A sound whose context took longer than this to start is stale: it isn't played late. */
const LATE_MS = 200;

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
  } catch {
    // Storage blocked (a private window): the setting lasts for this visit.
  }
}

export function createSound(): Sound {
  let muted = readMuted();
  let synth: Synth | null = null;
  let failed = false;
  const last = new Map<string, number>();
  const music = createMusic(musicUrl, muted);

  function context(): Synth | null {
    if (synth || failed) return synth;
    try {
      const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
      if (!Ctor) throw new Error("no WebAudio");
      synth = new Synth(new Ctor({ latencyHint: "interactive" }));
      synth.bus.gain.value = muted ? 0 : 1;
    } catch {
      failed = true;
    }
    return synth;
  }

  function render(s: Synth, name: SoundName, options: SoundOptions, volume: number): void {
    try {
      const entry = soundEntry(name);
      if (!entry) return;
      const out = s.ctx.createGain();
      out.gain.value = Math.max(0, Math.min(1, volume));
      if (options.seat === 0 || options.seat === 1) {
        const pan = s.ctx.createStereoPanner();
        pan.pan.value = options.seat === 0 ? -PAN : PAN;
        out.connect(pan).connect(s.bus);
      } else out.connect(s.bus);
      entry.play(s, out, s.ctx.currentTime + 0.005, options);
    } catch {
      // A sound that can't play is silence, never an error on screen.
    }
  }

  const unlock = (): void => {
    const s = context();
    if (s && s.ctx.state === "suspended") void s.ctx.resume().catch(() => undefined);
    music.unlock();
  };
  for (const type of GESTURES) window.addEventListener(type, unlock, { capture: true, passive: true });

  return {
    play(name, options = {}) {
      if (muted) return;
      try {
        const key = `${name}:${options.seat ?? "-"}`;
        const at = performance.now();
        if (at - (last.get(key) ?? -Infinity) < DEDUPE_MS) return;
        last.set(key, at);
        const s = context();
        if (!s) return;
        const volume = options.volume ?? 1;
        if (s.ctx.state === "running") return render(s, name, options, volume);
        // Not started yet (no gesture, or the kiosk's first sound): start it, and play only if that was quick, so a
        // late start doesn't fire a pile of stale sounds at once.
        s.ctx.resume().then(
          () => {
            if (performance.now() - at < LATE_MS) render(s, name, options, volume);
          },
          () => undefined,
        );
      } catch {
        // Silence.
      }
    },
    music(on) {
      music.want(on);
    },
    duck(on) {
      music.duck(on);
    },
    get muted() {
      return muted;
    },
    setMuted(next) {
      muted = next;
      writeMuted(next);
      try {
        if (synth) synth.bus.gain.setTargetAtTime(next ? 0 : 1, synth.ctx.currentTime, 0.02);
      } catch {
        // Silence.
      }
      music.setMuted(next);
    },
  };
}
