import { Show } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';

const OVERLAY_NAMES: Record<string, string> = {
  power: 'Power', water: 'Water', zone: 'Zones',
  traffic: 'Traffic', pollution: 'Pollution', landValue: 'Land Value',
  police: 'Police', fire: 'Fire', health: 'Health',
  education: 'Education', park: 'Park', garbage: 'Garbage', district: 'Districts',
};

export function OverlayIndicator() {
  const ov = () => gameSignals.currentOverlay();
  const visible = () => ov() !== 'none';

  const closeOverlay = () => {
    getGame().setOverlay('none');
  };

  return (
    <div id="overlay-indicator" classList={{ visible: visible() }}>
      <span class="oi-label">Overlay:</span>
      <span class="oi-name">{OVERLAY_NAMES[ov()] ?? ov()}</span>
      <button id="overlay-close" onClick={closeOverlay}>Close</button>
    </div>
  );
}
