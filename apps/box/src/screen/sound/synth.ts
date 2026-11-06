// The instruments every sound is played on. One AudioContext, one bus into a compressor (so stacked sounds never
// clip), a second of white noise to filter, and five voices built from oscillators: a tone, a noise burst, a struck
// bell (inharmonic partials), soft brass (detuned saws through a low-pass) and a thump (a pitched body that drops).
// A sound layers them: a body, a texture and a voice.

export interface ToneSpec {
  readonly type?: OscillatorType;
  readonly freq: number;
  /** Glides to this frequency over the tone. */
  readonly to?: number;
  readonly dur: number;
  readonly gain: number;
  readonly attack?: number;
  /** A low-pass at this cutoff. */
  readonly lowpass?: number;
  /** In cents. */
  readonly detune?: number;
}

export interface NoiseSpec {
  readonly dur: number;
  readonly gain: number;
  readonly filter: BiquadFilterType;
  readonly freq: number;
  /** Sweeps the filter to this frequency over the burst. */
  readonly to?: number;
  readonly q?: number;
  readonly attack?: number;
}

export class Synth {
  readonly ctx: AudioContext;
  /** Where every sound goes: the compressor's input. Its gain is the mute. */
  readonly bus: GainNode;
  private readonly noiseBuffer: AudioBuffer;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 6;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    this.bus = ctx.createGain();
    this.bus.connect(comp).connect(ctx.destination);
    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  tone(dest: AudioNode, at: number, o: ToneSpec): void {
    const osc = this.ctx.createOscillator();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.freq, at);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, at + o.dur);
    if (o.detune) osc.detune.value = o.detune;
    const env = this.envelope(at, o.dur, o.gain, o.attack ?? 0.004);
    if (o.lowpass) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = o.lowpass;
      osc.connect(lp).connect(env);
    } else osc.connect(env);
    env.connect(dest);
    osc.start(at);
    osc.stop(at + o.dur + 0.02);
  }

  noise(dest: AudioNode, at: number, o: NoiseSpec): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = o.filter;
    filter.frequency.setValueAtTime(o.freq, at);
    if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, at + o.dur);
    filter.Q.value = o.q ?? 0.8;
    const env = this.envelope(at, o.dur, o.gain, o.attack ?? 0.003);
    src.connect(filter).connect(env).connect(dest);
    src.start(at, Math.random() * 0.5);
    src.stop(at + o.dur + 0.02);
  }

  /** A struck bell: the note and two inharmonic partials that die away faster. */
  bell(dest: AudioNode, at: number, freq: number, gain: number, dur: number): void {
    this.tone(dest, at, { freq, dur, gain, attack: 0.002 });
    this.tone(dest, at, { freq: freq * 2.76, dur: dur * 0.5, gain: gain * 0.35, attack: 0.002 });
    this.tone(dest, at, { freq: freq * 5.4, dur: dur * 0.25, gain: gain * 0.15, attack: 0.002 });
  }

  /** Soft brass: two detuned saws through a low-pass over a triangle an octave down. */
  brass(dest: AudioNode, at: number, freq: number, gain: number, dur: number): void {
    this.tone(dest, at, { type: "sawtooth", freq, dur, gain, attack: 0.02, lowpass: 2600, detune: -6 });
    this.tone(dest, at, { type: "sawtooth", freq, dur, gain: gain * 0.7, attack: 0.02, lowpass: 2600, detune: 7 });
    this.tone(dest, at, { type: "triangle", freq: freq / 2, dur, gain: gain * 0.5, attack: 0.02 });
  }

  /** A pitched body that drops: the weight under a hit. */
  thump(dest: AudioNode, at: number, from: number, to: number, gain: number, dur: number): void {
    this.tone(dest, at, { freq: from, to, dur, gain, attack: 0.002 });
  }

  private envelope(at: number, dur: number, gain: number, attack: number): GainNode {
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    return env;
  }
}
