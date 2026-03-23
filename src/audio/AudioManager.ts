export enum SoundType {
  BUILD = 'build',
  DEMOLISH = 'demolish',
  ZONE = 'zone',
  MILESTONE = 'milestone',
  DISASTER = 'disaster',
  CLICK = 'click',
}

export class AudioManager {
  private audioContext: AudioContext | null = null;
  private masterVolume = 0.5;
  private musicVolume = 0.3;
  private sfxVolume = 0.7;
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

    // Chord progressions: each entry is an array of frequencies forming a chord
    const chords = [
      [261.63, 329.63, 392.00], // C major  (C4, E4, G4)
      [293.66, 349.23, 440.00], // Dm       (D4, F4, A4)
      [246.94, 311.13, 369.99], // Bm       (B3, Eb4, F#4) - acts as Am
      [261.63, 329.63, 392.00], // C major  repeat
    ];

    const bgmVolume = this.masterVolume * this.musicVolume * 0.08;

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
    this.bgmIntervalId = setInterval(playChord, 4000);
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

    switch (type) {
      case 'build':
        osc.frequency.value = 440;
        osc.type = 'sine';
        gain.gain.setValueAtTime(volume * 0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
        break;
      case 'demolish':
        osc.frequency.value = 200;
        osc.type = 'sawtooth';
        gain.gain.setValueAtTime(volume * 0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
        break;
      case 'zone':
        osc.frequency.value = 523;
        osc.type = 'triangle';
        gain.gain.setValueAtTime(volume * 0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.15);
        break;
      case 'milestone':
        osc.frequency.value = 660;
        osc.type = 'sine';
        gain.gain.setValueAtTime(volume * 0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
        break;
      case 'disaster':
        osc.frequency.value = 150;
        osc.type = 'square';
        gain.gain.setValueAtTime(volume * 0.5, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.8);
        break;
      case 'click':
        osc.frequency.value = 800;
        osc.type = 'sine';
        gain.gain.setValueAtTime(volume * 0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.05);
        break;
    }
  }

  // ===== Ambient Environment Audio =====

  startAmbient(): void {
    if (this.ambientPlaying) return;
    const ctx = this.getContext();
    if (!ctx) return;
    this.ambientPlaying = true;

    // Master ambient gain
    this.ambientGainNode = ctx.createGain();
    this.ambientGainNode.gain.value = (this.muted || this.musicMuted) ? 0 : this.masterVolume * 0.04;
    this.ambientGainNode.connect(ctx.destination);

    // City ambient noise (brown noise via filtered white noise)
    this.startCityNoise(ctx);

    // Bird chirps (random interval)
    this.birdIntervalId = setInterval(() => {
      if (this.muted || this.musicMuted || !this.ambientPlaying) return;
      // Only chirp during daytime (we don't track time here, so always play but randomly)
      if (Math.random() < 0.3) this.playBirdChirp(ctx);
    }, 3000 + Math.random() * 4000);

    // Traffic hum (periodic based on vehicle count)
    this.trafficIntervalId = setInterval(() => {
      if (this.muted || this.musicMuted || !this.ambientPlaying) return;
      if (this.ambientVehicles > 5) this.playTrafficHum(ctx);
    }, 5000);
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
      const popFactor = Math.min(1, population / 1000); // 0-1 based on pop up to 1000
      this.ambientGainNode.gain.value = this.masterVolume * 0.04 * (0.3 + popFactor * 0.7);
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
      last = (last + (0.02 * white)) / 1.02;
      data[i] = last * 3.5; // scale up
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
    const baseFreq = 2000 + Math.random() * 2000;
    osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.3, ctx.currentTime + 0.05);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

    osc.connect(gain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);

    // Optional second chirp after a short delay
    if (Math.random() < 0.5) {
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
    osc.frequency.value = 80 + Math.random() * 40;

    const intensity = Math.min(1, this.ambientVehicles / 50);
    gain.gain.setValueAtTime(0.15 * intensity, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);

    osc.connect(gain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 1.5);
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
      this.bgmGainNode.gain.value = off ? 0 : this.masterVolume * this.musicVolume * 0.08;
    }
    if (this.ambientGainNode) {
      this.ambientGainNode.gain.value = off ? 0 : this.masterVolume * 0.04;
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
