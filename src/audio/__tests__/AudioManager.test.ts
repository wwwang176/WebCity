import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioManager } from '../AudioManager';

/**
 * A minimal Web Audio stub. The test environment is node, so `new AudioContext()`
 * normally throws and AudioManager silently degrades to "no context" — which makes
 * every gain assertion vacuously pass. Installing this stub is what lets the tests
 * below actually observe the gain values the manager writes.
 */
function makeParam() {
  return {
    value: 0,
    setValueAtTime() { /* stub */ },
    exponentialRampToValueAtTime() { /* stub */ },
  };
}

function installAudioContextStub(): void {
  class StubAudioContext {
    state = 'running';
    currentTime = 0;
    sampleRate = 44100;
    destination = {};
    createGain() {
      return { gain: makeParam(), connect() { /* stub */ }, disconnect() { /* stub */ } };
    }
    createOscillator() {
      return {
        type: 'sine',
        frequency: makeParam(),
        connect() { /* stub */ },
        start() { /* stub */ },
        stop() { /* stub */ },
      };
    }
    createBuffer(_ch: number, len: number) {
      return { getChannelData: () => new Float32Array(len) };
    }
    createBufferSource() {
      return {
        buffer: null,
        loop: false,
        connect() { /* stub */ },
        start() { /* stub */ },
        stop() { /* stub */ },
      };
    }
    resume() { /* stub */ }
  }
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = StubAudioContext;
}

describe('AudioManager mute defaults', () => {
  let audio: AudioManager;

  beforeEach(() => {
    installAudioContextStub();
    audio = new AudioManager();
  });

  afterEach(() => {
    audio.stopBGM();
    audio.stopAmbient();
    delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
  });

  it('starts with music muted', () => {
    expect(audio.isMusicMuted()).toBe(true);
  });

  it('starts with sound effects audible', () => {
    expect(audio.isSfxMuted()).toBe(false);
    expect(audio.isMuted()).toBe(false);
  });

  it('keeps BGM silent on init while music is muted', () => {
    audio.init();
    expect(audio.getBgmGain()).toBe(0);
  });

  it('brings BGM back when the player turns music on', () => {
    audio.init();
    expect(audio.toggleMusicMute()).toBe(false);
    expect(audio.getBgmGain()).toBeGreaterThan(0);
  });

  it('does not build the BGM graph at all while music is muted', () => {
    audio.init();
    expect(audio.isBgmPlaying()).toBe(false);
    audio.toggleMusicMute();
    expect(audio.isBgmPlaying()).toBe(true);
  });

  it('leaves music off when master mute is lifted', () => {
    audio.init();
    audio.toggleMute();
    audio.toggleMute();
    expect(audio.isMusicMuted()).toBe(true);
    expect(audio.getBgmGain()).toBe(0);
  });

  it('restores music after a master mute round trip when music is on', () => {
    audio.init();
    audio.toggleMusicMute();
    audio.toggleMute();
    expect(audio.getBgmGain()).toBe(0);
    audio.toggleMute();
    expect(audio.getBgmGain()).toBeGreaterThan(0);
  });
});

describe('AudioManager ambient follows sound effects, not music', () => {
  let audio: AudioManager;

  beforeEach(() => {
    installAudioContextStub();
    audio = new AudioManager();
    audio.init();
    audio.startAmbient();
  });

  afterEach(() => {
    audio.stopBGM();
    audio.stopAmbient();
    delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
  });

  it('plays ambient city sound even though music is muted by default', () => {
    expect(audio.isMusicMuted()).toBe(true);
    expect(audio.getAmbientGain()).toBeGreaterThan(0);
  });

  it('silences ambient when sound effects are muted', () => {
    audio.toggleSfxMute();
    expect(audio.getAmbientGain()).toBe(0);
  });

  it('restores ambient when sound effects are unmuted', () => {
    audio.toggleSfxMute();
    audio.toggleSfxMute();
    expect(audio.getAmbientGain()).toBeGreaterThan(0);
  });

  it('keeps ambient audible while music is toggled', () => {
    audio.toggleMusicMute();
    expect(audio.getAmbientGain()).toBeGreaterThan(0);
  });

  it('silences ambient on master mute', () => {
    audio.toggleMute();
    expect(audio.getAmbientGain()).toBe(0);
  });

  it('does not raise ambient volume from updateAmbientState while sfx is muted', () => {
    audio.toggleSfxMute();
    audio.updateAmbientState(50000, 200);
    expect(audio.getAmbientGain()).toBe(0);
  });
});
