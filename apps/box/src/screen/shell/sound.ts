// The Box's sounds: every cue synthesized on the spot with WebAudio, no files. The AudioContext is made on the
// first user gesture (browsers keep audio locked until one); until then, and while muted, cues are silent. Muting
// is remembered (localStorage `gamebox-muted`). Nothing here ever throws into the caller.
import type { Cue } from "../link/types.ts";
import type { Sound } from "../views/view.ts";

const MUTED_KEY = "gamebox-muted";
const GESTURES = ["pointerdown", "keydown", "touchstart"] as const;

interface Voice {
  readonly ctx: AudioContext;
  readonly out: AudioNode;
  readonly noise: AudioBuffer;
}

interface Tone {
  readonly freq: number;
  /** Glides to this frequency over the note. */
  readonly to?: number;
  readonly at: number;
  readonly dur: number;
  readonly gain: number;
  readonly type?: OscillatorType;
  readonly attack?: number;
  /** A low-pass that opens with the note (brass). */
  readonly bright?: number;
}

function envelope(v: Voice, at: number, dur: number, gain: number, attack: number): GainNode {
  const g = v.ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  g.connect(v.out);
  return g;
}

function tone(v: Voice, t: Tone): void {
  const start = v.ctx.currentTime + t.at;
  const osc = v.ctx.createOscillator();
  osc.type = t.type ?? "sine";
  osc.frequency.setValueAtTime(t.freq, start);
  if (t.to) osc.frequency.exponentialRampToValueAtTime(t.to, start + t.dur);
  const amp = envelope(v, start, t.dur, t.gain, t.attack ?? 0.004);
  if (t.bright) {
    const lp = v.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(t.bright * 0.35, start);
    lp.frequency.exponentialRampToValueAtTime(t.bright, start + Math.min(0.06, t.dur / 2));
    lp.frequency.exponentialRampToValueAtTime(t.bright * 0.5, start + t.dur);
    osc.connect(lp).connect(amp);
  } else {
    osc.connect(amp);
  }
  osc.start(start);
  osc.stop(start + t.dur + 0.02);
}

/** A burst of filtered noise: clicks, ticks, the flick of a card. */
function hiss(v: Voice, at: number, dur: number, gain: number, type: BiquadFilterType, freq: number): void {
  const start = v.ctx.currentTime + at;
  const src = v.ctx.createBufferSource();
  src.buffer = v.noise;
  const filter = v.ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, start);
  filter.Q.value = type === "bandpass" ? 1.4 : 0.7;
  src.connect(filter).connect(envelope(v, start, dur, gain, 0.002));
  src.start(start, Math.random() * 0.5);
  src.stop(start + dur + 0.02);
}

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;

const CUES: Readonly<Record<Cue, (v: Voice) => void>> = {
  tap(v) {
    tone(v, { freq: 2100, to: 1300, at: 0, dur: 0.035, gain: 0.22 });
    hiss(v, 0, 0.02, 0.18, "bandpass", 3600);
  },
  block(v) {
    tone(v, { freq: 196, to: 150, at: 0, dur: 0.1, gain: 0.2 });
    hiss(v, 0, 0.03, 0.05, "lowpass", 900);
  },
  seal(v) {
    tone(v, { freq: C5, at: 0, dur: 1.1, gain: 0.14, type: "triangle", attack: 0.008 });
    tone(v, { freq: G5, at: 0.012, dur: 0.9, gain: 0.08, attack: 0.008 });
    tone(v, { freq: C6, at: 0.02, dur: 0.6, gain: 0.04, attack: 0.008 });
  },
  flip(v) {
    hiss(v, 0, 0.05, 0.22, "highpass", 2400);
    hiss(v, 0.045, 0.03, 0.12, "bandpass", 4200);
  },
  tick(v) {
    tone(v, { freq: 1250, at: 0, dur: 0.02, gain: 0.1, type: "triangle", attack: 0.001 });
    hiss(v, 0, 0.012, 0.07, "bandpass", 3800);
  },
  win(v) {
    [C5, E5, G5, C6].forEach((freq, i) =>
      tone(v, { freq, at: i * 0.09, dur: i === 3 ? 0.55 : 0.2, gain: 0.16, type: "sawtooth", attack: 0.012, bright: 2600 }),
    );
  },
  lose(v) {
    tone(v, { freq: 392, to: 380, at: 0, dur: 0.24, gain: 0.16, type: "triangle", attack: 0.01 });
    tone(v, { freq: 293.66, to: 277, at: 0.26, dur: 0.45, gain: 0.16, type: "triangle", attack: 0.01 });
  },
  error(v) {
    tone(v, { freq: 110, at: 0, dur: 0.09, gain: 0.12, type: "square", bright: 520 });
    tone(v, { freq: 110, at: 0.14, dur: 0.09, gain: 0.12, type: "square", bright: 520 });
  },
  boot(v) {
    tone(v, { freq: 110, to: 220, at: 0, dur: 1.3, gain: 0.14, attack: 0.55 });
    tone(v, { freq: 165, to: 330, at: 0.05, dur: 1.25, gain: 0.06, attack: 0.55 });
  },
};

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

function makeVoice(): Voice | null {
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctor) return null;
  const ctx = new Ctor();
  const out = ctx.createGain();
  out.gain.value = 0.6;
  out.connect(ctx.destination);
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return { ctx, out, noise };
}

export function createSound(): Sound {
  let muted = readMuted();
  let voice: Voice | null = null;

  const unlock = (): void => {
    try {
      voice ??= makeVoice();
      if (!voice) return release();
      if (voice.ctx.state === "running") return release();
      voice.ctx.resume().then(release, () => undefined);
    } catch {
      release();
    }
  };

  function release(): void {
    for (const type of GESTURES) window.removeEventListener(type, unlock, true);
  }

  for (const type of GESTURES) window.addEventListener(type, unlock, { capture: true, passive: true });

  return {
    play(cue) {
      if (muted || !voice || voice.ctx.state !== "running") return;
      try {
        CUES[cue](voice);
      } catch {
        // A cue that can't play is silence, never an error on screen.
      }
    },
    get muted() {
      return muted;
    },
    setMuted(next) {
      muted = next;
      writeMuted(next);
    },
  };
}
