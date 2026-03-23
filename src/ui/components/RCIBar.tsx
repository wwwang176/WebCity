import { gameSignals } from '../store/gameStore';
import { UI_COLORS } from '../constants';

export function RCIBar() {
  const rHeight = () => `${Math.max(5, (gameSignals.rciDemand().residential + 100) / 2)}%`;
  const cHeight = () => `${Math.max(5, (gameSignals.rciDemand().commercial + 100) / 2)}%`;
  const iHeight = () => `${Math.max(5, (gameSignals.rciDemand().industrial + 100) / 2)}%`;

  return (
    <div id="rci-bar" role="group" aria-label="RCI demand indicators">
      <div class="rci-col">
        <div class="rci-meter" role="meter" aria-label="Residential demand" aria-valuemin={0} aria-valuemax={100}>
          <div class="rci-fill" style={{ background: UI_COLORS.STATUS_GOOD, height: rHeight() }} />
        </div>
        <div class="rci-label">R</div>
      </div>
      <div class="rci-col">
        <div class="rci-meter" role="meter" aria-label="Commercial demand" aria-valuemin={0} aria-valuemax={100}>
          <div class="rci-fill" style={{ background: UI_COLORS.ACCENT, height: cHeight() }} />
        </div>
        <div class="rci-label">C</div>
      </div>
      <div class="rci-col">
        <div class="rci-meter" role="meter" aria-label="Industrial demand" aria-valuemin={0} aria-valuemax={100}>
          <div class="rci-fill" style={{ background: UI_COLORS.STATUS_WARN, height: iHeight() }} />
        </div>
        <div class="rci-label">I</div>
      </div>
    </div>
  );
}
