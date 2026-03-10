import { Show } from 'solid-js';
import { gameSignals } from '../store/gameStore';

const INFRA_TOOLS = new Set([
  'power', 'water', 'police', 'fire', 'hospital',
  'school', 'school_high', 'school_univ', 'park',
  'garbage', 'sewage', 'cemetery',
]);

export function RotationIndicator() {
  const show = () => INFRA_TOOLS.has(gameSignals.currentTool()) && gameSignals.currentRotation() !== 0;
  return (
    <div id="rotation-indicator" classList={{ visible: show() }} aria-live="polite">
      {show() ? `R: ${gameSignals.currentRotation()}\u00B0` : ''}
    </div>
  );
}
