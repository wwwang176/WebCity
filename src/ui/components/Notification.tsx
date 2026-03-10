import { Show } from 'solid-js';
import { gameSignals } from '../store/gameStore';

export function Notification() {
  return (
    <Show when={gameSignals.notification()} fallback={<div id="notification" role="alert" aria-live="assertive" />}>
      <div id="notification" class="visible" role="alert" aria-live="assertive">
        {gameSignals.notification()}
      </div>
    </Show>
  );
}
