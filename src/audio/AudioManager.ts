export type SoundType = 'build' | 'demolish' | 'zone' | 'milestone' | 'disaster' | 'click';

export class AudioManager {
  private audioContext: AudioContext | null = null;
  private masterVolume = 0.5;
  private musicVolume = 0.3;
  private sfxVolume = 0.7;
  private muted = false;

  init(): void {
    try {
      this.audioContext = new AudioContext();
    } catch {
      // Audio not supported
    }
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
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }
}
