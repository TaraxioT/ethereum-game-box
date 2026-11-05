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
  /** A low-pass at this cutoff, or one that sweeps from `from` to `to` over `over` seconds. */
  readonly lowpass?: number | { readonly from: number; readonly to: number; readonly over: number };
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
  if (t.lowpass) {
    const lp = v.ctx.createBiquadFilter();
    lp.type = "lowpass";
    if (typeof t.lowpass === "number") lp.frequency.setValueAtTime(t.lowpass, start);
    else {
      lp.frequency.setValueAtTime(t.lowpass.from, start);
      lp.frequency.exponentialRampToValueAtTime(t.lowpass.to, start + t.lowpass.over);
    }
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

const A3 = 220;
const E4 = 329.63;
const A4 = 440;
const CS5 = 554.37;
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;

// The launcher's cues (boot, tap, block, error, win, lose) lean toward a dark analogue synth: saws and squares
// through low-passes. seal, flip and tick belong to the games and keep their own sound.
const CUES: Readonly<Record<Cue, (v: Voice) => void>> = {
  tap(v) {
    tone(v, { freq: 1200, to: 1800, at: 0, dur: 0.045, gain: 0.18, type: "square", lowpass: 4000 });
  },
  block(v) {
    tone(v, { freq: 62, at: 0, dur: 0.14, gain: 0.3 });
    hiss(v, 0, 0.01, 0.08, "highpass", 3000);
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
    [A3, E4, A4, CS5, E5].forEach((freq, i, notes) =>
      tone(v, { freq, at: i * 0.09, dur: i === notes.length - 1 ? 0.6 : 0.16, gain: 0.12, type: "sawtooth", attack: 0.008, lowpass: 3000 }),
    );
  },
  lose(v) {
    tone(v, { freq: E4, at: 0, dur: 0.22, gain: 0.14, type: "sawtooth", attack: 0.01, lowpass: 1200 });
    tone(v, { freq: A3, at: 0.22, dur: 0.22, gain: 0.14, type: "sawtooth", attack: 0.01, lowpass: 1200 });
  },
  error(v) {
    for (const at of [0, 0.22])
      for (const freq of [98, 104]) tone(v, { freq, at, dur: 0.16, gain: 0.1, type: "sawtooth", attack: 0.004, lowpass: 900 });
  },
  boot(v) {
    const sweep = { from: 180, to: 2600, over: 1.6 };
    for (const [freq, gain] of [[55, 0.08], [55.4, 0.08], [110, 0.05]] as const)
      tone(v, { freq, at: 0, dur: 2.8, gain, type: "sawtooth", attack: 0.6, lowpass: sweep });
    tone(v, { freq: 1760, at: 1, dur: 0.6, gain: 0.025, attack: 0.15 });
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
