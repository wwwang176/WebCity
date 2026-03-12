import { createSignal } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { SettingsButton } from './SettingsMenu';

export function SpeedControls() {
  const [muted, setMuted] = createSignal(false);

  const togglePause = () => getGame().togglePause();
  const setSpeedVal = (s: 1 | 2 | 3) => getGame().setSpeed(s);

  const toggleMute = () => {
    const m = getGame().getAudioManager().toggleMute();
    setMuted(m);
  };

  return (
    <div class="top-section">
      <div class="speed-group" role="group" aria-label="Game speed controls">
        <button
          class="sp-btn"
          classList={{ active: gameSignals.paused() }}
          onClick={togglePause}
          aria-label="Pause game"
        >II</button>
        <button
          class="sp-btn"
          classList={{ active: !gameSignals.paused() && gameSignals.speed() === 1 }}
          onClick={() => setSpeedVal(1)}
          aria-label="Normal speed"
        >1x</button>
        <button
          class="sp-btn"
          classList={{ active: !gameSignals.paused() && gameSignals.speed() === 2 }}
          onClick={() => setSpeedVal(2)}
          aria-label="Double speed"
        >2x</button>
        <button
          class="sp-btn"
          classList={{ active: !gameSignals.paused() && gameSignals.speed() === 3 }}
          onClick={() => setSpeedVal(3)}
          aria-label="Triple speed"
        >3x</button>
      </div>
      <button
        id="mute-btn"
        title="Toggle Sound"
        aria-label="Toggle sound mute"
        classList={{ muted: muted() }}
        onClick={toggleMute}
        innerHTML={muted() ? '&#128264;' : '&#128266;'}
      />
      <SettingsButton />
    </div>
  );
}
