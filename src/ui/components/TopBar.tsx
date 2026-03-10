import { gameSignals } from '../store/gameStore';
import { SpeedControls } from './SpeedControls';

export function TopBar() {
  const balClass = () => gameSignals.balance() >= 0 ? 'stat-positive' : 'stat-negative';
  const balText = () => {
    const b = gameSignals.balance();
    return `${b >= 0 ? '+' : ''}$${b}/tick`;
  };
  const happyText = () => gameSignals.population() > 0 ? `${gameSignals.happiness()}%` : '--';
  const toolText = () => {
    const cost = gameSignals.previewCost();
    return `${gameSignals.currentTool()}${cost != null ? ` $${cost}` : ''}`;
  };

  return (
    <div id="top-bar" role="banner" aria-label="City status bar">
      <div class="top-section" role="status" aria-label="City statistics">
        <div class="top-stat">
          <span class="stat-label">Date</span>
          <span class="stat-value" aria-live="polite">{gameSignals.date()}</span>
        </div>
        <div class="top-divider" />
        <div class="top-stat">
          <span class="stat-label">Funds</span>
          <span class="stat-value">${gameSignals.funds().toLocaleString()}</span>
        </div>
        <div class="top-divider" />
        <div class="top-stat">
          <span class="stat-label">Population</span>
          <span class="stat-value stat-accent">{gameSignals.population()}</span>
        </div>
        <div class="top-divider" />
        <div class="top-stat">
          <span class="stat-label">Balance</span>
          <span class={`stat-value ${balClass()}`}>{balText()}</span>
        </div>
        <div class="top-divider" />
        <div class="top-stat">
          <span class="stat-label">Happiness</span>
          <span class="stat-value">{happyText()}</span>
        </div>
        <div class="top-divider" />
        <div class="top-stat">
          <span class="stat-label">Tool</span>
          <span class="stat-value" style="font-size:12px">{toolText()}</span>
        </div>
      </div>
      <SpeedControls />
    </div>
  );
}
