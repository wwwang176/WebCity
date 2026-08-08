export enum SoundType {
  BUILD = 'build',
  DEMOLISH = 'demolish',
  ZONE = 'zone',
  MILESTONE = 'milestone',
  DISASTER = 'disaster',
  CLICK = 'click',
}

/** Audio tuning constants — adjust without reading implementation */
export const AUDIO = {
  VOLUME: { MASTER: 0.5, MUSIC: 0.3, SFX: 0.7 },
  BGM: {
    GAIN: 0.08,
    CHORD_INTERVAL_MS: 4000,
    CHORDS: [
      [261.63, 329.63, 392.00], // C major
      [293.66, 349.23, 440.00], // Dm
      [246.94, 311.13, 369.99], // Bm (as Am)
      [261.63, 329.63, 392.00], // C major repeat
    ],
  },
  SFX: {
    [SoundType.BUILD]:    { freq: 440, wave: 'sine'     as OscillatorType, gain: 0.3, dur: 0.2 },
    [SoundType.DEMOLISH]: { freq: 200, wave: 'sawtooth' as OscillatorType, gain: 0.3, dur: 0.3 },
    [SoundType.ZONE]:     { freq: 523, wave: 'triangle' as OscillatorType, gain: 0.2, dur: 0.15 },
    [SoundType.MILESTONE]:{ freq: 660, wave: 'sine'     as OscillatorType, gain: 0.4, dur: 0.5 },
    [SoundType.DISASTER]: { freq: 150, wave: 'square'   as OscillatorType, gain: 0.5, dur: 0.8 },
    [SoundType.CLICK]:    { freq: 800, wave: 'sine'     as OscillatorType, gain: 0.1, dur: 0.05 },
  },
  AMBIENT: {
    GAIN: 0.04,
    POP_SCALE_MAX: 1000,
    POP_GAIN_MIN: 0.3,
    POP_GAIN_RANGE: 0.7,
    BIRD_CHANCE: 0.3,
    BIRD_INTERVAL_BASE_MS: 3000,
    BIRD_INTERVAL_RANGE_MS: 4000,
    BIRD_FREQ_BASE: 2000,
    BIRD_FREQ_RANGE: 2000,
    BIRD_DOUBLE_CHANCE: 0.5,
    TRAFFIC_VEHICLE_THRESHOLD: 5,
    TRAFFIC_INTERVAL_MS: 5000,
    TRAFFIC_FREQ_BASE: 80,
    TRAFFIC_FREQ_RANGE: 40,
    TRAFFIC_VEHICLE_SCALE: 50,
    TRAFFIC_GAIN: 0.15,
    TRAFFIC_DURATION: 1.5,
    NOISE_WALK_STEP: 0.02,
    NOISE_DECAY: 1.02,
    NOISE_SCALE: 3.5,
  },
} as const;

export class AudioManager {
  private audioContext: AudioContext | null = null;
  private masterVolume: number = AUDIO.VOLUME.MASTER;
  private musicVolume: number = AUDIO.VOLUME.MUSIC;
  private sfxVolume: number = AUDIO.VOLUME.SFX;
  private muted = false;
  private sfxMuted = false;
  private musicMuted = false;
  private bgmOscillators: OscillatorNode[] = [];
  private bgmGainNode: GainNode | null = null;
  private bgmPlaying = false;
  private bgmIntervalId: ReturnType<typeof setInterval> | null = null;

  // Ambient environment
  private ambientGainNode: GainNode | null = null;
  private ambientNoiseNode: AudioBufferSourceNode | null = null;
  private ambientPlaying = false;
  private birdIntervalId: ReturnType<typeof setInterval> | null = null;
  private trafficIntervalId: ReturnType<typeof setInterval> | null = null;
  private ambientPopulation = 0;
  private ambientVehicles = 0;

  init(): void {
    try {
      this.audioContext = new AudioContext();
    } catch {
      // Audio not supported
    }
    this.startBGM();
  }

  startBGM(): void {
    if (this.bgmPlaying) return;
    const ctx = this.getContext();
    if (!ctx) return;

    this.bgmPlaying = true;

    const chords = AUDIO.BGM.CHORDS;
    const bgmVolume = this.masterVolume * this.musicVolume * AUDIO.BGM.GAIN;

    // Create a master gain for BGM
    this.bgmGainNode = ctx.createGain();
    this.bgmGainNode.gain.value = (this.muted || this.musicMuted) ? 0 : bgmVolume;
    this.bgmGainNode.connect(ctx.destination);

    let chordIndex = 0;

    const playChord = () => {
      // Stop previous oscillators
      this.stopBGMOscillators();

      const chord = chords[chordIndex % chords.length]!;

      for (const freq of chord) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(this.bgmGainNode!);
        osc.start();
        this.bgmOscillators.push(osc);
      }

      // Add a subtle sub-bass
      const subOsc = ctx.createOscillator();
      subOsc.type = 'sine';
      subOsc.frequency.value = chord[0]! / 2; // one octave below root
      subOsc.connect(this.bgmGainNode!);
      subOsc.start();
      this.bgmOscillators.push(subOsc);

      chordIndex++;
    };

    // Play first chord immediately and then cycle every 4 seconds
    playChord();
    this.bgmIntervalId = setInterval(playChord, AUDIO.BGM.CHORD_INTERVAL_MS);
  }

  stopBGM(): void {
    this.stopBGMOscillators();
    if (this.bgmIntervalId !== null) {
      clearInterval(this.bgmIntervalId);
      this.bgmIntervalId = null;
    }
    if (this.bgmGainNode) {
      this.bgmGainNode.disconnect();
      this.bgmGainNode = null;
    }
    this.bgmPlaying = false;
  }

  private stopBGMOscillators(): void {
    for (const osc of this.bgmOscillators) {
      try { osc.stop(); } catch { /* already stopped */ }
    }
    this.bgmOscillators = [];
  }

  private getContext(): AudioContext | null {
    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume();
    }
    return this.audioContext;
  }

  playSfx(type: SoundType): void {
    if (this.muted || this.sfxMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const volume = this.masterVolume * this.sfxVolume;
    const sfx = AUDIO.SFX[type];
    osc.frequency.value = sfx.freq;
    osc.type = sfx.wave;
    gain.gain.setValueAtTime(volume * sfx.gain, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + sfx.dur);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + sfx.dur);
  }

  // ===== Ambient Environment Audio =====

  startAmbient(): void {
    if (this.ambientPlaying) return;
    const ctx = this.getContext();
    if (!ctx) return;
    this.ambientPlaying = true;

    // Master ambient gain
    this.ambientGainNode = ctx.createGain();
    this.ambientGainNode.gain.value = (this.muted || this.musicMuted) ? 0 : this.masterVolume * AUDIO.AMBIENT.GAIN;
    this.ambientGainNode.connect(ctx.destination);

    this.startCityNoise(ctx);

    this.birdIntervalId = setInterval(() => {
      if (this.muted || this.musicMuted || !this.ambientPlaying) return;
      if (Math.random() < AUDIO.AMBIENT.BIRD_CHANCE) this.playBirdChirp(ctx);
    }, AUDIO.AMBIENT.BIRD_INTERVAL_BASE_MS + Math.random() * AUDIO.AMBIENT.BIRD_INTERVAL_RANGE_MS);

    this.trafficIntervalId = setInterval(() => {
      if (this.muted || this.musicMuted || !this.ambientPlaying) return;
      if (this.ambientVehicles > AUDIO.AMBIENT.TRAFFIC_VEHICLE_THRESHOLD) this.playTrafficHum(ctx);
    }, AUDIO.AMBIENT.TRAFFIC_INTERVAL_MS);
  }

  stopAmbient(): void {
    if (this.ambientNoiseNode) {
      try { this.ambientNoiseNode.stop(); } catch { /* */ }
      this.ambientNoiseNode = null;
    }
    if (this.birdIntervalId !== null) {
      clearInterval(this.birdIntervalId);
      this.birdIntervalId = null;
    }
    if (this.trafficIntervalId !== null) {
      clearInterval(this.trafficIntervalId);
      this.trafficIntervalId = null;
    }
    if (this.ambientGainNode) {
      this.ambientGainNode.disconnect();
      this.ambientGainNode = null;
    }
    this.ambientPlaying = false;
  }

  updateAmbientState(population: number, vehicleCount: number): void {
    this.ambientPopulation = population;
    this.ambientVehicles = vehicleCount;

    // Adjust ambient noise volume based on city size
    if (this.ambientGainNode && !this.muted && !this.musicMuted) {
      const popFactor = Math.min(1, population / AUDIO.AMBIENT.POP_SCALE_MAX);
      this.ambientGainNode.gain.value = this.masterVolume * AUDIO.AMBIENT.GAIN * (AUDIO.AMBIENT.POP_GAIN_MIN + popFactor * AUDIO.AMBIENT.POP_GAIN_RANGE);
    }
  }

  private startCityNoise(ctx: AudioContext): void {
    // Create brown noise (filtered white noise) for ambient city rumble
    const bufferSize = ctx.sampleRate * 2; // 2 seconds
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate brown noise (random walk)
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + (AUDIO.AMBIENT.NOISE_WALK_STEP * white)) / AUDIO.AMBIENT.NOISE_DECAY;
      data[i] = last * AUDIO.AMBIENT.NOISE_SCALE;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.ambientGainNode!);
    source.start();
    this.ambientNoiseNode = source;
  }

  private playBirdChirp(ctx: AudioContext): void {
    if (!this.ambientGainNode) return;
    const gain = ctx.createGain();
    gain.connect(this.ambientGainNode);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    // Random bird frequencies (high pitched chirp)
    const baseFreq = AUDIO.AMBIENT.BIRD_FREQ_BASE + Math.random() * AUDIO.AMBIENT.BIRD_FREQ_RANGE;
    osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.3, ctx.currentTime + 0.05);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

    osc.connect(gain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);

    // Optional second chirp after a short delay
    if (Math.random() < AUDIO.AMBIENT.BIRD_DOUBLE_CHANCE) {
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      const freq2 = baseFreq * (0.9 + Math.random() * 0.2);
      osc2.frequency.setValueAtTime(freq2, ctx.currentTime + 0.2);
      osc2.frequency.exponentialRampToValueAtTime(freq2 * 1.2, ctx.currentTime + 0.25);

      const gain2 = ctx.createGain();
      gain2.gain.setValueAtTime(0.2, ctx.currentTime + 0.2);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

      osc2.connect(gain2);
      gain2.connect(this.ambientGainNode);
      osc2.start(ctx.currentTime + 0.2);
      osc2.stop(ctx.currentTime + 0.35);
    }
  }

  private playTrafficHum(ctx: AudioContext): void {
    if (!this.ambientGainNode) return;
    const gain = ctx.createGain();
    gain.connect(this.ambientGainNode);

    // Low rumble for traffic
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = AUDIO.AMBIENT.TRAFFIC_FREQ_BASE + Math.random() * AUDIO.AMBIENT.TRAFFIC_FREQ_RANGE;

    const intensity = Math.min(1, this.ambientVehicles / AUDIO.AMBIENT.TRAFFIC_VEHICLE_SCALE);
    gain.gain.setValueAtTime(AUDIO.AMBIENT.TRAFFIC_GAIN * intensity, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + AUDIO.AMBIENT.TRAFFIC_DURATION);

    osc.connect(gain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + AUDIO.AMBIENT.TRAFFIC_DURATION);
  }

  setMasterVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1, vol));
  }

  setMusicVolume(vol: number): void {
    this.musicVolume = Math.max(0, Math.min(1, vol));
  }

  setSfxVolume(vol: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, vol));
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyMusicGain();
    return this.muted;
  }

  toggleSfxMute(): boolean {
    this.sfxMuted = !this.sfxMuted;
    return this.sfxMuted;
  }

  toggleMusicMute(): boolean {
    this.musicMuted = !this.musicMuted;
    this.applyMusicGain();
    return this.musicMuted;
  }

  private applyMusicGain(): void {
    const off = this.muted || this.musicMuted;
    if (this.bgmGainNode) {
      this.bgmGainNode.gain.value = off ? 0 : this.masterVolume * this.musicVolume * AUDIO.BGM.GAIN;
    }
    if (this.ambientGainNode) {
      this.ambientGainNode.gain.value = off ? 0 : this.masterVolume * AUDIO.AMBIENT.GAIN;
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  isSfxMuted(): boolean {
    return this.sfxMuted;
  }

  isMusicMuted(): boolean {
    return this.musicMuted;
  }
}
