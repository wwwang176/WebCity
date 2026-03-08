export type SoundType = 'build' | 'demolish' | 'zone' | 'milestone' | 'disaster' | 'click';

export class AudioManager {
  private audioContext: AudioContext | null = null;
  private masterVolume = 0.5;
  private musicVolume = 0.3;
  private sfxVolume = 0.7;
  private muted = false;
  private bgmOscillators: OscillatorNode[] = [];
  private bgmGainNode: GainNode | null = null;
  private bgmPlaying = false;
  private bgmIntervalId: ReturnType<typeof setInterval> | null = null;

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
    this.bgmGainNode.gain.value = this.muted ? 0 : bgmVolume;
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
    if (this.muted) return;
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
    // Update BGM volume based on mute state
    if (this.bgmGainNode) {
      this.bgmGainNode.gain.value = this.muted ? 0 : this.masterVolume * this.musicVolume * 0.08;
    }
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }
}
