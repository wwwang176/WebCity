import { gameSignals } from '../store/gameStore';

export function RCIBar() {
  const rHeight = () => `${Math.max(5, (gameSignals.rciDemand().residential + 100) / 2)}%`;
  const cHeight = () => `${Math.max(5, (gameSignals.rciDemand().commercial + 100) / 2)}%`;
  const iHeight = () => `${Math.max(5, (gameSignals.rciDemand().industrial + 100) / 2)}%`;

  return (
    <div id="rci-bar" role="group" aria-label="RCI demand indicators">
      <div class="rci-col">
        <div class="rci-meter" role="meter" aria-label="Residential demand" aria-valuemin={0} aria-valuemax={100}>
          <div class="rci-fill" style={{ background: '#66bb6a', height: rHeight() }} />
        </div>
        <div class="rci-label">R</div>
      </div>
      <div class="rci-col">
        <div class="rci-meter" role="meter" aria-label="Commercial demand" aria-valuemin={0} aria-valuemax={100}>
          <div class="rci-fill" style={{ background: '#42a5f5', height: cHeight() }} />
        </div>
        <div class="rci-label">C</div>
      </div>
      <div class="rci-col">
        <div class="rci-meter" role="meter" aria-label="Industrial demand" aria-valuemin={0} aria-valuemax={100}>
          <div class="rci-fill" style={{ background: '#ffa726', height: iHeight() }} />
        </div>
        <div class="rci-label">I</div>
      </div>
    </div>
  );
}
