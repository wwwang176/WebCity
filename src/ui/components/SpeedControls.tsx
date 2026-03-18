import { createSignal, For } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { SettingsButton } from './SettingsMenu';
import { GameClock, type GameSpeed } from '../../core/simulation/GameClock';

const SPEED_BUTTONS: { speed: GameSpeed; label: string }[] =
  GameClock.SPEEDS.map(s => ({ speed: s, label: `${s}x` }));

export function SpeedControls() {
  const [muted, setMuted] = createSignal(false);

  const togglePause = () => getGame().togglePause();

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
        <For each={SPEED_BUTTONS}>{(btn) =>
          <button
            class="sp-btn"
            classList={{ active: !gameSignals.paused() && gameSignals.speed() === btn.speed }}
            onClick={() => getGame().setSpeed(btn.speed)}
            aria-label={`${btn.label} speed`}
          >{btn.label}</button>
        }</For>
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
