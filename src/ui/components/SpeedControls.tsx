import { createSignal } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';

export function SpeedControls() {
  const [muted, setMuted] = createSignal(false);

  const togglePause = () => {
    const game = getGame();
    game.paused = !game.paused;
    const state = game.getState();
    if (game.paused) state.clock.pause();
    else state.clock.resume();
  };

  const setSpeedVal = (s: 1 | 2 | 3) => {
    const game = getGame();
    game.speed = s;
    game.getState().clock.setSpeed(s);
    game.paused = false;
  };

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
    </div>
  );
}
