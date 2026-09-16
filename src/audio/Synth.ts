/**
 * Low-level procedural sound synthesis.
 *
 * WHY SYNTHESIS INSTEAD OF AUDIO FILES
 * A children's farm game needs a lot of sound: birds, wind, footsteps on four
 * surfaces, three animal voices with per-animal pitch, doors, water, rustling,
 * and a whole day's worth of music. As files that is 20-40 MB and a licensing
 * paper trail. Synthesised, it is this file, it is original work, it never
 * loads, it never pops, and every cow can have its own voice for free.
 *
 * Everything here is built from three primitives: an oscillator, a filtered
 * noise burst, and an ADSR envelope.
 */

export interface EnvelopeSpec {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export class Synth {
  readonly ctx: AudioContext;
  private noiseBuffer: AudioBuffer;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.noiseBuffer = makeNoiseBuffer(ctx, 2);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /** Applies a standard ADSR to a gain node and schedules its teardown. */
  envelope(
    gain: GainNode,
    peak: number,
    env: EnvelopeSpec,
    startAt: number,
    holdFor: number,
  ): number {
    const g = gain.gain;
    const endOfSustain = startAt + env.attack + env.decay + holdFor;
    g.cancelScheduledValues(startAt);
    g.setValueAtTime(0.0001, startAt);
    g.exponentialRampToValueAtTime(Math.max(0.0001, peak), startAt + env.attack);
    g.exponentialRampToValueAtTime(
      Math.max(0.0001, peak * env.sustain),
      startAt + env.attack + env.decay,
    );
    g.setValueAtTime(Math.max(0.0001, peak * env.sustain), endOfSustain);
    g.exponentialRampToValueAtTime(0.0001, endOfSustain + env.release);
    return endOfSustain + env.release;
  }

  /** A single pitched note. */
  tone(options: {
    frequency: number;
    type?: OscillatorType;
    destination: AudioNode;
    gain?: number;
    env?: Partial<EnvelopeSpec>;
    hold?: number;
    startAt?: number;
    /** Glide to this frequency across the note. */
    glideTo?: number;
    detune?: number;
    /** Optional low-pass cutoff. */
    filter?: number;
    /** Vibrato depth in cents. */
    vibrato?: number;
  }): void {
    const ctx = this.ctx;
    const start = options.startAt ?? ctx.currentTime;
    const env: EnvelopeSpec = {
      attack: 0.012,
      decay: 0.08,
      sustain: 0.6,
      release: 0.2,
      ...options.env,
    };
    const hold = options.hold ?? 0.12;

    const osc = ctx.createOscillator();
    osc.type = options.type ?? 'sine';
    osc.frequency.setValueAtTime(options.frequency, start);
    if (options.glideTo) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(1, options.glideTo),
        start + env.attack + env.decay + hold,
      );
    }
    if (options.detune) osc.detune.setValueAtTime(options.detune, start);

    const gain = ctx.createGain();
    let node: AudioNode = osc;

    if (options.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(options.filter, start);
      filter.Q.value = 0.8;
      node.connect(filter);
      node = filter;
    }
    node.connect(gain);
    gain.connect(options.destination);

    let lfo: OscillatorNode | null = null;
    if (options.vibrato) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = options.vibrato;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.detune);
      lfo.start(start);
    }

    const stopAt = this.envelope(gain, options.gain ?? 0.3, env, start, hold);
    osc.start(start);
    osc.stop(stopAt + 0.02);
    if (lfo) lfo.stop(stopAt + 0.02);
    osc.onended = () => {
      gain.disconnect();
      osc.disconnect();
    };
  }

  /** A filtered noise burst — footsteps, rustles, water, wing flaps. */
  noise(options: {
    destination: AudioNode;
    gain?: number;
    duration?: number;
    startAt?: number;
    type?: BiquadFilterType;
    frequency?: number;
    /** Sweep the filter to this frequency. */
    sweepTo?: number;
    q?: number;
    env?: Partial<EnvelopeSpec>;
  }): void {
    const ctx = this.ctx;
    const start = options.startAt ?? ctx.currentTime;
    const duration = options.duration ?? 0.12;

    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = options.type ?? 'bandpass';
    filter.frequency.setValueAtTime(options.frequency ?? 1200, start);
    if (options.sweepTo) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(40, options.sweepTo),
        start + duration,
      );
    }
    filter.Q.value = options.q ?? 1.2;

    const gain = ctx.createGain();
    source.connect(filter);
    filter.connect(gain);
    gain.connect(options.destination);

    const env: EnvelopeSpec = {
      attack: 0.005,
      decay: 0.03,
      sustain: 0.5,
      release: 0.08,
      ...options.env,
    };
    const stopAt = this.envelope(gain, options.gain ?? 0.25, env, start, duration);
    source.start(start);
    source.stop(stopAt + 0.02);
    source.onended = () => {
      gain.disconnect();
      filter.disconnect();
      source.disconnect();
    };
  }

  /** A continuously looping filtered-noise bed (wind, rain, stream). */
  createNoiseBed(options: {
    destination: AudioNode;
    type?: BiquadFilterType;
    frequency?: number;
    q?: number;
    gain?: number;
  }): { gain: GainNode; filter: BiquadFilterNode; stop: () => void } {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = options.type ?? 'lowpass';
    filter.frequency.value = options.frequency ?? 600;
    filter.Q.value = options.q ?? 0.7;

    const gain = ctx.createGain();
    gain.gain.value = options.gain ?? 0;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(options.destination);
    source.start();

    return {
      gain,
      filter,
      stop: () => {
        try {
          source.stop();
        } catch {
          /* already stopped */
        }
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
      },
    };
  }
}

function makeNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Brown-ish noise: less harsh than white, much better for wind and rain.
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.2;
  }
  return buffer;
}

/* ------------------------------------------------------------------ */
/* Musical helpers                                                     */
/* ------------------------------------------------------------------ */

/** Semitone offsets for a major pentatonic scale — nothing in it can clash. */
export const PENTATONIC = [0, 2, 4, 7, 9];
/** Lydian-ish set for the warmer evening cues. */
export const WARM_SCALE = [0, 2, 4, 7, 9, 11];

export function noteToFrequency(semitonesFromA4: number): number {
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

/** Degree within a scale, wrapping into higher octaves. */
export function scaleFrequency(scale: number[], degree: number, rootSemitone: number): number {
  const octave = Math.floor(degree / scale.length);
  const index = ((degree % scale.length) + scale.length) % scale.length;
  return noteToFrequency(rootSemitone + scale[index] + octave * 12);
}
