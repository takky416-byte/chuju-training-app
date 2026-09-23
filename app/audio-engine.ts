export type BgmStyle = "focus" | "playful" | "challenge";
export type SoundEffect = "correct" | "combo" | "wrong" | "timeout" | "next" | "finish";
export type AudioVolume = "low" | "medium" | "high";

const BGM_LEVELS: Record<AudioVolume, number> = {
  low: 0.05,
  medium: 0.09,
  high: 0.14,
};

const EFFECT_LEVELS: Record<AudioVolume, number> = {
  low: 0.1,
  medium: 0.18,
  high: 0.28,
};

type Track = {
  bpm: number;
  wave: OscillatorType;
  notes: number[];
  beats: number[];
};

const TRACKS: Record<BgmStyle, Track> = {
  focus: {
    bpm: 72,
    wave: "sine",
    notes: [261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 349.23],
    beats: [2, 1, 1, 2, 2, 1, 1, 2],
  },
  playful: {
    bpm: 104,
    wave: "triangle",
    notes: [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880, 783.99],
    beats: [1, 1, 1, 1, 1, 1, 1, 1],
  },
  challenge: {
    bpm: 120,
    wave: "square",
    notes: [220, 329.63, 246.94, 369.99, 261.63, 392, 246.94, 369.99],
    beats: [0.5, 0.5, 1, 1, 0.5, 0.5, 1, 1],
  },
};

export class StudyAudioEngine {
  private context: AudioContext | null = null;
  private bgmGain: GainNode | null = null;
  private bgmTimer: number | null = null;
  private nextNoteAt = 0;
  private noteIndex = 0;
  private currentStyle: BgmStyle | null = null;
  private bgmVolume: AudioVolume = "medium";
  private effectVolume: AudioVolume = "medium";

  private getContext() {
    if (typeof window === "undefined") return null;
    if (!this.context) {
      const AudioContextConstructor = window.AudioContext
        ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) return null;
      this.context = new AudioContextConstructor();
    }
    return this.context;
  }

  async resume() {
    const context = this.getContext();
    if (context?.state === "suspended") await context.resume();
  }

  async startBgm(style: BgmStyle) {
    await this.resume();
    const context = this.getContext();
    if (!context) return;
    this.stopBgm();
    this.currentStyle = style;
    this.noteIndex = 0;
    this.nextNoteAt = context.currentTime + 0.04;
    this.bgmGain = context.createGain();
    this.bgmGain.gain.setValueAtTime(BGM_LEVELS[this.bgmVolume], context.currentTime);
    this.bgmGain.connect(context.destination);
    this.scheduleBgm();
    this.bgmTimer = window.setInterval(() => this.scheduleBgm(), 180);
  }

  stopBgm() {
    if (this.bgmTimer !== null) window.clearInterval(this.bgmTimer);
    this.bgmTimer = null;
    if (this.bgmGain && this.context) {
      this.bgmGain.gain.cancelScheduledValues(this.context.currentTime);
      this.bgmGain.gain.setTargetAtTime(0, this.context.currentTime, 0.025);
      window.setTimeout(() => this.bgmGain?.disconnect(), 160);
    }
    this.bgmGain = null;
    this.currentStyle = null;
  }

  setBgmVolume(volume: AudioVolume) {
    this.bgmVolume = volume;
    if (this.bgmGain && this.context) {
      this.bgmGain.gain.setTargetAtTime(BGM_LEVELS[volume], this.context.currentTime, 0.035);
    }
  }

  setEffectVolume(volume: AudioVolume) {
    this.effectVolume = volume;
  }

  async playEffect(effect: SoundEffect) {
    await this.resume();
    const context = this.getContext();
    if (!context) return;
    const patterns: Record<SoundEffect, Array<[number, number, number]>> = {
      correct: [[659.25, 0, 0.09], [783.99, 0.08, 0.09], [987.77, 0.16, 0.15]],
      combo: [[659.25, 0, 0.08], [783.99, 0.07, 0.08], [987.77, 0.14, 0.1], [1318.51, 0.22, 0.2]],
      wrong: [[220, 0, 0.13], [174.61, 0.12, 0.2]],
      timeout: [[392, 0, 0.1], [293.66, 0.1, 0.1], [196, 0.2, 0.25]],
      next: [[440, 0, 0.06], [587.33, 0.055, 0.09]],
      finish: [[523.25, 0, 0.12], [659.25, 0.1, 0.12], [783.99, 0.2, 0.12], [1046.5, 0.3, 0.32]],
    };
    patterns[effect].forEach(([frequency, delay, duration]) => {
      this.playTone(
        frequency,
        context.currentTime + delay,
        duration,
        effect === "wrong" || effect === "timeout" ? "triangle" : "sine",
        EFFECT_LEVELS[this.effectVolume],
      );
    });
  }

  dispose() {
    this.stopBgm();
    void this.context?.close();
    this.context = null;
  }

  private scheduleBgm() {
    const context = this.context;
    const output = this.bgmGain;
    const style = this.currentStyle;
    if (!context || !output || !style) return;
    const track = TRACKS[style];
    const beatSeconds = 60 / track.bpm;
    while (this.nextNoteAt < context.currentTime + 0.75) {
      const beatLength = track.beats[this.noteIndex % track.beats.length];
      const duration = Math.min(beatSeconds * beatLength * 0.78, 1.2);
      this.playTone(track.notes[this.noteIndex % track.notes.length], this.nextNoteAt, duration, track.wave, style === "challenge" ? 0.42 : 0.7, output);
      this.nextNoteAt += beatSeconds * beatLength;
      this.noteIndex += 1;
    }
  }

  private playTone(frequency: number, startAt: number, duration: number, wave: OscillatorType, level: number, output?: AudioNode) {
    const context = this.context;
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(level, startAt + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain);
    gain.connect(output ?? context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.02);
  }
}
