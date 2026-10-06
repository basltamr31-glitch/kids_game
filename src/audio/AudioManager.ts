import { Synth, PENTATONIC, WARM_SCALE, scaleFrequency } from './Synth';
import type { SettingsData, DayPhase, Weather } from '../save/SaveSchema';
import { Rng } from '../core/Rng';

/**
 * The game's whole soundscape, generated at runtime.
 *
 * Three buses — music, sfx, ambience — each with its own volume so a parent can
 * turn the music off and keep the birds, which is what parents actually ask for.
 *
 * The music is a generative cue: a slow chord bed plus a sparse melody drawn
 * from a pentatonic scale, with per-phase mood settings. It never repeats
 * exactly and never resolves in a way that begs for attention, which is what
 * makes it bearable for the hundredth play session.
 */

export type SfxName =
  | 'tap'
  | 'confirm'
  | 'reward'
  | 'heart'
  | 'discovery'
  | 'sticker'
  | 'footstepGrass'
  | 'footstepWood'
  | 'footstepDirt'
  | 'footstepSnow'
  | 'pickup'
  | 'drop'
  | 'pour'
  | 'water'
  | 'milk'
  | 'egg'
  | 'door'
  | 'rustle'
  | 'sleep'
  | 'wake'
  | 'error';

export type AnimalVoice = 'moo' | 'baa' | 'cluck' | 'neigh' | 'bleat' | 'squeak' | 'woof';

interface Bus {
  gain: GainNode;
  target: number;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private synth: Synth | null = null;
  private master: GainNode | null = null;
  private buses: Record<'music' | 'sfx' | 'ambience', Bus> | null = null;

  private rng = new Rng('audio');
  private started = false;
  private muted = false;

  /* --- ambience --- */
  private wind: ReturnType<Synth['createNoiseBed']> | null = null;
  private rain: ReturnType<Synth['createNoiseBed']> | null = null;
  private stream: ReturnType<Synth['createNoiseBed']> | null = null;
  private birdTimer = 0;
  private gustTimer = 0;
  private currentWeather: Weather = 'sunny';

  /* --- music --- */
  private phase: DayPhase = 'morning';
  private nextChordAt = 0;
  private nextMelodyAt = 0;
  private chordIndex = 0;
  private musicEnabled = true;
  /** Audio-clock time until which the generative music stays silent. */
  private quietUntil = 0;

  private settings: SettingsData | null = null;

  /**
   * Audio contexts may only start from a user gesture. The game calls this on
   * the first tap; until then everything here is a silent no-op.
   */
  async start(): Promise<void> {
    if (this.started) return;
    try {
      const Ctor = window.AudioContext ?? (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      if (this.ctx.state === 'suspended') await this.ctx.resume();

      this.synth = new Synth(this.ctx);
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;

      // A gentle limiter stops any accidental stack of sounds from clipping —
      // important when the output is a phone speaker held near a child's ear.
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.knee.value = 12;
      limiter.ratio.value = 6;
      limiter.attack.value = 0.004;
      limiter.release.value = 0.18;

      this.master.connect(limiter);
      limiter.connect(this.ctx.destination);

      this.buses = {
        music: { gain: this.ctx.createGain(), target: 0.6 },
        sfx: { gain: this.ctx.createGain(), target: 0.85 },
        ambience: { gain: this.ctx.createGain(), target: 0.7 },
      };
      for (const b of Object.values(this.buses)) {
        b.gain.gain.value = 0;
        b.gain.connect(this.master);
      }

      this.startAmbience();
      this.started = true;
      if (this.settings) this.applySettings(this.settings);
    } catch (error) {
      // No audio is a degraded experience, never a broken one.
      console.warn('[Audio] unavailable', error);
      this.started = false;
    }
  }

  applySettings(settings: SettingsData): void {
    this.settings = settings;
    if (!this.buses) return;
    this.buses.music.target = settings.musicVolume;
    this.buses.sfx.target = settings.sfxVolume;
    this.buses.ambience.target = settings.ambienceVolume;
    this.musicEnabled = settings.musicVolume > 0.001;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.master.context.currentTime, 0.1);
    }
  }

  /** Called when the app goes to the background. */
  async suspend(): Promise<void> {
    try {
      await this.ctx?.suspend();
    } catch {
      /* ignore */
    }
  }

  async resume(): Promise<void> {
    try {
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
    } catch {
      /* ignore */
    }
  }

  /* ---------------- ambience ---------------- */

  private startAmbience(): void {
    if (!this.synth || !this.buses) return;
    const destination = this.buses.ambience.gain;

    this.wind = this.synth.createNoiseBed({
      destination,
      type: 'lowpass',
      frequency: 420,
      gain: 0.05,
    });
    this.rain = this.synth.createNoiseBed({
      destination,
      type: 'bandpass',
      frequency: 2400,
      q: 0.5,
      gain: 0,
    });
    this.stream = this.synth.createNoiseBed({
      destination,
      type: 'bandpass',
      frequency: 1500,
      q: 1.4,
      gain: 0,
    });
  }

  setWeather(weather: Weather): void {
    this.currentWeather = weather;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rainLevel = weather === 'rain' ? 0.16 : 0;
    const windLevel =
      weather === 'snow' ? 0.09 : weather === 'fog' ? 0.035 : weather === 'rain' ? 0.08 : 0.05;
    this.rain?.gain.gain.setTargetAtTime(rainLevel, t, 1.8);
    this.wind?.gain.gain.setTargetAtTime(windLevel, t, 2.2);
  }

  /** 0 = far from the stream, 1 = standing on the bank. */
  setWaterProximity(amount: number): void {
    if (!this.ctx) return;
    this.stream?.gain.gain.setTargetAtTime(amount * 0.13, this.ctx.currentTime, 0.6);
  }

  /* ---------------- voices ---------------- */

  /**
   * A character "talking" in pitched syllables, the way cartoon villagers do:
   * it reads as speech in any language and never says a wrong word. Used
   * when read-aloud is off, so the family still sounds like people.
   */
  babble(actor: string, text: string): void {
    if (!this.synth || !this.buses || this.muted) return;
    const base = actor === 'father' ? 150 : actor === 'mother' ? 250 : 340;
    const syllables = Math.max(2, Math.min(10, Math.ceil(text.length / 5)));
    const start = this.synth.now;
    for (let i = 0; i < syllables; i++) {
      const f = base * this.rng.range(0.86, 1.22) * (i === syllables - 1 ? 0.9 : 1);
      this.synth.tone({
        frequency: f,
        glideTo: f * this.rng.range(0.85, 1.1),
        type: 'triangle',
        destination: this.buses.sfx.gain,
        gain: 0.075,
        hold: 0.05,
        startAt: start + i * 0.105 + this.rng.range(0, 0.02),
        env: { attack: 0.01, decay: 0.05, sustain: 0.5, release: 0.06 },
        filter: 1900,
      });
    }
  }

  /**
   * The goodnight lullaby: a short, original tune in a slow three, over a
   * soft held chord, played once as the child falls asleep. The generative
   * melody steps aside while it plays.
   */
  playLullaby(): void {
    if (!this.synth || !this.buses || this.muted || !this.musicEnabled) return;
    const s = this.synth;
    const d = this.buses.music.gain;
    const beat = 0.62;
    // Semitones above C5, and length in beats. Two phrases, question and answer.
    const tune: [number, number][] = [
      [4, 1], [7, 1], [9, 1], [7, 2], [4, 1], [2, 1], [0, 2], [2, 1], [4, 1], [7, 1], [4, 3],
      [4, 1], [7, 1], [9, 1], [12, 2], [9, 1], [7, 1], [4, 2], [2, 1], [4, 1], [2, 1], [0, 3],
    ];
    const c5 = 523.25;
    let t = s.now + 0.3;
    for (const [semi, beats] of tune) {
      s.tone({
        frequency: c5 * Math.pow(2, semi / 12),
        type: 'sine',
        destination: d,
        gain: 0.09,
        hold: beats * beat * 0.8,
        startAt: t,
        env: { attack: 0.05, decay: 0.3, sustain: 0.55, release: 0.9 },
        vibrato: 5,
      });
      t += beats * beat;
    }
    const length = t - s.now;
    // A warm bed underneath: C, then F, then C again.
    const chords: number[][] = [[0, 4, 7], [5, 9, 12], [0, 4, 7]];
    chords.forEach((chord, i) => {
      for (const semi of chord) {
        s.tone({
          frequency: (c5 / 2) * Math.pow(2, semi / 12),
          type: 'triangle',
          destination: d,
          gain: 0.035,
          hold: (length / chords.length) * 0.85,
          startAt: s.now + 0.3 + (length / chords.length) * i,
          env: { attack: 1.2, decay: 0.5, sustain: 0.85, release: 1.6 },
          filter: 1100,
        });
      }
    });
    this.quietUntil = (this.ctx?.currentTime ?? 0) + length + 1;
  }

  /* ---------------- music ---------------- */

  setPhase(phase: DayPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    // Let the next chord land naturally rather than cutting.
    this.chordIndex = 0;
  }

  private musicMood(): {
    root: number;
    scale: number[];
    chordEvery: number;
    melodyEvery: number;
    padGain: number;
    melodyGain: number;
    octave: number;
  } {
    switch (this.phase) {
      case 'morning':
        return { root: -9, scale: PENTATONIC, chordEvery: 6, melodyEvery: 1.6, padGain: 0.055, melodyGain: 0.075, octave: 12 };
      case 'midday':
        return { root: -4, scale: PENTATONIC, chordEvery: 5, melodyEvery: 1.2, padGain: 0.05, melodyGain: 0.08, octave: 12 };
      case 'afternoon':
        return { root: -7, scale: WARM_SCALE, chordEvery: 6, melodyEvery: 1.5, padGain: 0.055, melodyGain: 0.07, octave: 12 };
      case 'evening':
        return { root: -12, scale: WARM_SCALE, chordEvery: 8, melodyEvery: 2.4, padGain: 0.06, melodyGain: 0.055, octave: 7 };
      default:
        return { root: -16, scale: PENTATONIC, chordEvery: 11, melodyEvery: 3.6, padGain: 0.05, melodyGain: 0.04, octave: 7 };
    }
  }

  private updateMusic(dt: number): void {
    if (!this.synth || !this.buses || !this.musicEnabled) return;
    if (this.ctx && this.ctx.currentTime < this.quietUntil) return;
    const mood = this.musicMood();
    const destination = this.buses.music.gain;

    this.nextChordAt -= dt;
    if (this.nextChordAt <= 0) {
      this.nextChordAt = mood.chordEvery;
      // Three-note pad, always consonant because it comes from the scale.
      const degrees = [0, 2, 4].map((d) => d + this.chordIndex);
      for (const degree of degrees) {
        this.synth.tone({
          frequency: scaleFrequency(mood.scale, degree, mood.root),
          type: 'triangle',
          destination,
          gain: mood.padGain,
          hold: mood.chordEvery * 0.75,
          env: { attack: 1.6, decay: 0.6, sustain: 0.85, release: 2.0 },
          filter: 1400,
        });
      }
      this.chordIndex = (this.chordIndex + this.rng.pick([1, 2, -1, 3])) % 7;
    }

    this.nextMelodyAt -= dt;
    if (this.nextMelodyAt <= 0) {
      this.nextMelodyAt = mood.melodyEvery * this.rng.range(0.7, 1.8);
      // Leave real silence between phrases; a busy melody becomes wallpaper.
      if (this.rng.bool(0.62)) {
        const degree = this.chordIndex + this.rng.int(0, 6);
        this.synth.tone({
          frequency: scaleFrequency(mood.scale, degree, mood.root + mood.octave),
          type: 'sine',
          destination,
          gain: mood.melodyGain,
          hold: this.rng.range(0.25, 0.7),
          env: { attack: 0.04, decay: 0.3, sustain: 0.5, release: 1.1 },
          vibrato: 4,
        });
        // Occasional soft second voice a third above.
        if (this.rng.bool(0.25)) {
          this.synth.tone({
            frequency: scaleFrequency(mood.scale, degree + 2, mood.root + mood.octave),
            type: 'sine',
            destination,
            gain: mood.melodyGain * 0.5,
            hold: 0.4,
            startAt: this.synth.now + 0.16,
            env: { attack: 0.05, decay: 0.3, sustain: 0.4, release: 0.9 },
          });
        }
      }
    }
  }

  /* ---------------- per-frame ---------------- */

  update(dt: number, hour: number): void {
    if (!this.started || !this.ctx || !this.buses) return;

    // Smooth the buses toward their targets so setting changes never click.
    const t = this.ctx.currentTime;
    for (const b of Object.values(this.buses)) {
      if (Math.abs(b.gain.gain.value - b.target) > 0.001) {
        b.gain.gain.setTargetAtTime(b.target, t, 0.25);
      }
    }

    if (!this.muted) {
      this.updateMusic(dt);
      this.updateBirds(dt, hour);
      this.updateGusts(dt);
    }
  }

  private updateBirds(dt: number, hour: number): void {
    if (!this.synth || !this.buses) return;
    // Birds are a dawn-and-morning thing; they go quiet at night and in rain.
    const activity =
      this.currentWeather === 'rain' || this.currentWeather === 'snow'
        ? 0.1
        : hour < 5 || hour > 20
          ? 0.05
          : hour < 10
            ? 1.0
            : hour < 18
              ? 0.55
              : 0.3;

    this.birdTimer -= dt * activity;
    if (this.birdTimer > 0) return;
    this.birdTimer = this.rng.range(2.5, 8);

    const destination = this.buses.ambience.gain;
    const base = this.rng.range(1500, 3100);
    const notes = this.rng.int(2, 4);
    for (let i = 0; i < notes; i++) {
      this.synth.tone({
        frequency: base * this.rng.range(0.85, 1.25),
        glideTo: base * this.rng.range(1.1, 1.7),
        type: 'sine',
        destination,
        gain: 0.05 * this.rng.range(0.6, 1),
        hold: 0.05,
        startAt: this.synth.now + i * this.rng.range(0.09, 0.2),
        env: { attack: 0.01, decay: 0.04, sustain: 0.3, release: 0.09 },
      });
    }
  }

  private updateGusts(dt: number): void {
    this.gustTimer -= dt;
    if (this.gustTimer > 0 || !this.wind || !this.ctx) return;
    this.gustTimer = this.rng.range(6, 16);
    const t = this.ctx.currentTime;
    const base = this.wind.gain.gain.value;
    // A gust is just a slow swell in the wind bed's cutoff and level.
    this.wind.gain.gain.setTargetAtTime(base * 2.1, t, 1.4);
    this.wind.gain.gain.setTargetAtTime(base, t + 3.0, 2.0);
    this.wind.filter.frequency.setTargetAtTime(760, t, 1.4);
    this.wind.filter.frequency.setTargetAtTime(420, t + 3.0, 2.0);
  }

  /* ---------------- sound effects ---------------- */

  play(name: SfxName, pitch = 1): void {
    if (!this.synth || !this.buses || this.muted) return;
    const d = this.buses.sfx.gain;
    const s = this.synth;

    switch (name) {
      case 'tap':
        s.tone({ frequency: 880 * pitch, type: 'sine', destination: d, gain: 0.16, hold: 0.02, env: { attack: 0.004, decay: 0.05, sustain: 0.2, release: 0.07 } });
        break;

      case 'confirm':
        // Rising two-note major third: universally reads as "yes".
        s.tone({ frequency: 660 * pitch, type: 'triangle', destination: d, gain: 0.2, hold: 0.05, env: { attack: 0.005, decay: 0.06, sustain: 0.5, release: 0.12 } });
        s.tone({ frequency: 880 * pitch, type: 'triangle', destination: d, gain: 0.2, hold: 0.07, startAt: s.now + 0.09, env: { attack: 0.005, decay: 0.07, sustain: 0.5, release: 0.18 } });
        break;

      case 'reward': {
        // Four-note arpeggio sparkle.
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((f, i) => {
          s.tone({ frequency: f * pitch, type: 'triangle', destination: d, gain: 0.17, hold: 0.06, startAt: s.now + i * 0.075, env: { attack: 0.005, decay: 0.08, sustain: 0.4, release: 0.3 } });
        });
        break;
      }

      case 'heart':
        s.tone({ frequency: 1046 * pitch, type: 'sine', destination: d, gain: 0.14, hold: 0.04, glideTo: 1320 * pitch, env: { attack: 0.006, decay: 0.07, sustain: 0.3, release: 0.22 } });
        break;

      case 'discovery': {
        const notes = [659.25, 830.61, 987.77, 1318.51, 1567.98];
        notes.forEach((f, i) => {
          s.tone({ frequency: f, type: 'sine', destination: d, gain: 0.13, hold: 0.05, startAt: s.now + i * 0.065, env: { attack: 0.004, decay: 0.09, sustain: 0.35, release: 0.45 } });
        });
        break;
      }

      case 'sticker':
        s.noise({ destination: d, gain: 0.12, duration: 0.1, frequency: 3000, sweepTo: 6000, type: 'bandpass', q: 0.8 });
        s.tone({ frequency: 1174, type: 'triangle', destination: d, gain: 0.16, hold: 0.09, startAt: s.now + 0.05, env: { attack: 0.006, decay: 0.1, sustain: 0.4, release: 0.3 } });
        break;

      case 'footstepGrass':
        s.noise({ destination: d, gain: 0.055, duration: 0.045, type: 'bandpass', frequency: 1700 * pitch, sweepTo: 800, q: 0.9 });
        break;
      case 'footstepDirt':
        s.noise({ destination: d, gain: 0.06, duration: 0.05, type: 'lowpass', frequency: 900 * pitch, sweepTo: 350, q: 0.7 });
        break;
      case 'footstepWood':
        s.noise({ destination: d, gain: 0.05, duration: 0.035, type: 'bandpass', frequency: 620 * pitch, q: 2.4 });
        s.tone({ frequency: 190 * pitch, type: 'sine', destination: d, gain: 0.05, hold: 0.015, env: { attack: 0.002, decay: 0.03, sustain: 0.1, release: 0.05 } });
        break;
      case 'footstepSnow':
        s.noise({ destination: d, gain: 0.05, duration: 0.07, type: 'bandpass', frequency: 3400 * pitch, sweepTo: 2000, q: 0.6 });
        break;

      case 'pickup':
        s.tone({ frequency: 520 * pitch, glideTo: 860 * pitch, type: 'sine', destination: d, gain: 0.14, hold: 0.04, env: { attack: 0.005, decay: 0.06, sustain: 0.3, release: 0.1 } });
        break;
      case 'drop':
        s.tone({ frequency: 420 * pitch, glideTo: 220 * pitch, type: 'sine', destination: d, gain: 0.14, hold: 0.04, env: { attack: 0.005, decay: 0.06, sustain: 0.3, release: 0.12 } });
        break;

      case 'pour':
      case 'water':
        s.noise({ destination: d, gain: 0.1, duration: 0.7, type: 'bandpass', frequency: 1100, sweepTo: 2200, q: 0.8, env: { attack: 0.12, decay: 0.2, sustain: 0.7, release: 0.35 } });
        break;

      case 'milk':
        // Rhythmic squirts into a metal pail.
        for (let i = 0; i < 6; i++) {
          s.noise({ destination: d, gain: 0.07, duration: 0.05, type: 'bandpass', frequency: 1800 - i * 90, q: 3.5, startAt: s.now + i * 0.28 });
        }
        break;

      case 'egg':
        s.noise({ destination: d, gain: 0.07, duration: 0.06, type: 'bandpass', frequency: 2400, q: 2.0 });
        s.tone({ frequency: 700, type: 'sine', destination: d, gain: 0.08, hold: 0.03, startAt: s.now + 0.04, env: { attack: 0.004, decay: 0.05, sustain: 0.2, release: 0.1 } });
        break;

      case 'door':
        s.tone({ frequency: 120, glideTo: 80, type: 'sawtooth', destination: d, gain: 0.07, hold: 0.25, filter: 400, env: { attack: 0.02, decay: 0.15, sustain: 0.5, release: 0.25 } });
        s.noise({ destination: d, gain: 0.05, duration: 0.3, type: 'lowpass', frequency: 700, sweepTo: 300 });
        break;

      case 'rustle':
        s.noise({ destination: d, gain: 0.07, duration: 0.3, type: 'highpass', frequency: 2600, q: 0.5, env: { attack: 0.03, decay: 0.1, sustain: 0.5, release: 0.2 } });
        break;

      case 'sleep':
        s.tone({ frequency: 392, type: 'sine', destination: d, gain: 0.1, hold: 0.5, glideTo: 261, env: { attack: 0.3, decay: 0.4, sustain: 0.6, release: 1.4 } });
        break;

      case 'wake': {
        const notes = [392, 523.25, 659.25];
        notes.forEach((f, i) => {
          s.tone({ frequency: f, type: 'triangle', destination: d, gain: 0.13, hold: 0.12, startAt: s.now + i * 0.16, env: { attack: 0.06, decay: 0.15, sustain: 0.5, release: 0.5 } });
        });
        break;
      }

      case 'error':
        // Deliberately soft and low. Nothing in this game should feel like a buzzer.
        s.tone({ frequency: 320, glideTo: 270, type: 'sine', destination: d, gain: 0.1, hold: 0.09, env: { attack: 0.01, decay: 0.08, sustain: 0.4, release: 0.15 } });
        break;
    }
  }

  /** An animal's voice. `base` comes from its content definition. */
  playAnimal(voice: AnimalVoice, base: number): void {
    if (!this.synth || !this.buses || this.muted) return;
    const d = this.buses.sfx.gain;
    const s = this.synth;
    const jitter = this.rng.range(0.94, 1.07);

    switch (voice) {
      case 'moo':
        // Long, falling, breathy. Two detuned saws through a low-pass.
        s.tone({ frequency: base * jitter, glideTo: base * 0.72, type: 'sawtooth', destination: d, gain: 0.14, hold: 0.55, filter: 620, vibrato: 12, env: { attack: 0.1, decay: 0.25, sustain: 0.75, release: 0.5 } });
        s.tone({ frequency: base * jitter * 1.01, glideTo: base * 0.71, type: 'sawtooth', destination: d, gain: 0.09, hold: 0.55, filter: 500, detune: 9, env: { attack: 0.14, decay: 0.25, sustain: 0.7, release: 0.55 } });
        s.noise({ destination: d, gain: 0.03, duration: 0.6, type: 'lowpass', frequency: 900, env: { attack: 0.12, decay: 0.2, sustain: 0.6, release: 0.4 } });
        break;

      case 'baa':
      case 'bleat': {
        // The characteristic wobble is fast vibrato with an amplitude tremor.
        const hold = voice === 'bleat' ? 0.3 : 0.42;
        s.tone({ frequency: base * jitter, glideTo: base * 0.86, type: 'sawtooth', destination: d, gain: 0.11, hold, filter: 1700, vibrato: 60, env: { attack: 0.03, decay: 0.1, sustain: 0.75, release: 0.2 } });
        s.tone({ frequency: base * jitter * 2, type: 'triangle', destination: d, gain: 0.04, hold, filter: 2600, vibrato: 60, env: { attack: 0.04, decay: 0.12, sustain: 0.6, release: 0.2 } });
        break;
      }

      case 'cluck': {
        // Short clipped chirps with a rising tail on the last one.
        const count = this.rng.int(2, 4);
        for (let i = 0; i < count; i++) {
          const last = i === count - 1;
          s.tone({
            frequency: base * jitter * (last ? 1.25 : 1),
            glideTo: last ? base * 1.9 : base * 0.8,
            type: 'square',
            destination: d,
            gain: 0.055,
            hold: last ? 0.11 : 0.035,
            filter: 2600,
            startAt: s.now + i * this.rng.range(0.1, 0.17),
            env: { attack: 0.004, decay: 0.04, sustain: 0.4, release: last ? 0.18 : 0.06 },
          });
        }
        break;
      }

      case 'neigh':
        s.tone({ frequency: base * 2, glideTo: base * 0.8, type: 'sawtooth', destination: d, gain: 0.12, hold: 0.5, filter: 2200, vibrato: 90, env: { attack: 0.04, decay: 0.2, sustain: 0.6, release: 0.4 } });
        break;

      case 'squeak':
        s.tone({ frequency: base * 3, glideTo: base * 4, type: 'sine', destination: d, gain: 0.07, hold: 0.05, env: { attack: 0.008, decay: 0.04, sustain: 0.3, release: 0.1 } });
        break;

      case 'woof':
        s.tone({ frequency: base, glideTo: base * 0.55, type: 'sawtooth', destination: d, gain: 0.13, hold: 0.09, filter: 1200, env: { attack: 0.006, decay: 0.06, sustain: 0.5, release: 0.18 } });
        break;
    }
  }

  /** Small wordless vocalisations for the child and parents. */
  playVoice(kind: 'happy' | 'wow' | 'laugh' | 'hello' | 'sleepy', adult: boolean): void {
    if (!this.synth || !this.buses || this.muted) return;
    const d = this.buses.sfx.gain;
    const s = this.synth;
    // Children sit higher; adults lower. No words, so nothing needs translating.
    const base = adult ? 210 : 340;

    switch (kind) {
      case 'happy':
        s.tone({ frequency: base, glideTo: base * 1.5, type: 'triangle', destination: d, gain: 0.11, hold: 0.12, filter: 2000, vibrato: 18, env: { attack: 0.02, decay: 0.08, sustain: 0.6, release: 0.18 } });
        break;
      case 'wow':
        s.tone({ frequency: base * 1.2, glideTo: base * 1.9, type: 'triangle', destination: d, gain: 0.11, hold: 0.22, filter: 2200, vibrato: 12, env: { attack: 0.06, decay: 0.1, sustain: 0.7, release: 0.3 } });
        break;
      case 'laugh':
        for (let i = 0; i < 3; i++) {
          s.tone({ frequency: base * (1.4 - i * 0.12), type: 'triangle', destination: d, gain: 0.09, hold: 0.05, filter: 2000, startAt: s.now + i * 0.14, env: { attack: 0.01, decay: 0.05, sustain: 0.5, release: 0.1 } });
        }
        break;
      case 'hello':
        s.tone({ frequency: base * 1.1, glideTo: base * 1.35, type: 'triangle', destination: d, gain: 0.1, hold: 0.16, filter: 1900, vibrato: 10, env: { attack: 0.04, decay: 0.1, sustain: 0.6, release: 0.22 } });
        break;
      case 'sleepy':
        s.tone({ frequency: base * 1.1, glideTo: base * 0.75, type: 'sine', destination: d, gain: 0.09, hold: 0.4, filter: 1400, env: { attack: 0.15, decay: 0.2, sustain: 0.6, release: 0.4 } });
        break;
    }
  }

  dispose(): void {
    this.wind?.stop();
    this.rain?.stop();
    this.stream?.stop();
    void this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}
