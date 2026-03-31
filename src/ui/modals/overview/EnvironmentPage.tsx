import { createMemo } from 'solid-js';
import { gameSignals, getGame } from '../../store/gameStore';
import { BURNED, ABANDONED } from '../../../core/building/InfraPlacement';
import { UI_COLORS } from '../../constants';

function StatRow(props: { label: string; value: string; status: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const color = () => {
    switch (props.status) {
      case 'good': return UI_COLORS.STATUS_GOOD;
      case 'warn': return UI_COLORS.STATUS_WARN;
      case 'bad': return UI_COLORS.STATUS_BAD;
      default: return UI_COLORS.NEUTRAL;
    }
  };
  return (
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(100,180,255,0.04);font-size:12px">
      <span style="color:#8899b0">{props.label}</span>
      <span style={{ color: color(), 'font-weight': '500' }}>{props.value}</span>
    </div>
  );
}

export function EnvironmentPage() {
  const data = createMemo(() => {
    gameSignals.tick();
    const state = getGame().getState();
    const grid = state.grid;

    let totalGround = 0;
    let totalNoise = 0;
    let cellCount = 0;

    grid.forEachCell((cell) => {
      if (cell.buildingId > 0 || cell.zoneType > 0) {
        totalGround += cell.pollution;
        cellCount++;
      }
    });

    const avgGround = cellCount > 0 ? totalGround / cellCount : 0;
    const avgNoise = cellCount > 0 ? totalNoise / cellCount : 0;
    const waterPollution = state.sewage.getWaterPollution();

    const activeFires = state.fire.getActiveFires();
    const todayExt = state.fire.getTodayExtinguished();
    const recentExt = state.fire.getRecentExtinguished();

    let burnedCount = 0;
    let abandonedCount = 0;
    grid.forEachCell((cell) => {
      if (cell.reserved === BURNED) burnedCount++;
      if (cell.reserved === ABANDONED) abandonedCount++;
    });

    return {
      avgGround, waterPollution, avgNoise,
      activeFires: activeFires.length,
      todayExt, recentExt, burnedCount,
    };
  }, undefined, {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  const pollutionStatus = (val: number): 'good' | 'warn' | 'bad' =>
    val < 10 ? 'good' : val < 30 ? 'warn' : 'bad';

  return (
    <>
      <div class="section-title">Pollution</div>
      <div class="summary-grid" style="grid-template-columns:1fr 1fr 1fr">
        <div class="summary-card">
          <div class="sc-value" style={{
            color: data().avgGround < 10 ? UI_COLORS.STATUS_GOOD : data().avgGround < 30 ? UI_COLORS.STATUS_WARN : UI_COLORS.STATUS_BAD
          }}>
            {data().avgGround.toFixed(1)}
          </div>
          <div class="sc-label">Ground Avg</div>
        </div>
        <div class="summary-card">
          <div class="sc-value" style={{
            color: data().waterPollution < 10 ? UI_COLORS.STATUS_GOOD : data().waterPollution < 30 ? UI_COLORS.STATUS_WARN : UI_COLORS.STATUS_BAD
          }}>
            {data().waterPollution.toFixed(1)}
          </div>
          <div class="sc-label">Water</div>
        </div>
        <div class="summary-card">
          <div class="sc-value" style="color:#78909c">-</div>
          <div class="sc-label">Noise</div>
        </div>
      </div>

      <div class="section-title">Fire Safety</div>
      <StatRow label="Active Fires" value={String(data().activeFires)} status={data().activeFires === 0 ? 'good' : 'bad'} />
      <StatRow label="Extinguished Today" value={String(data().todayExt)} status="neutral" />
      <StatRow label="Extinguished (30 days)" value={String(data().recentExt)} status="neutral" />
      <StatRow label="Burned Buildings" value={String(data().burnedCount)} status={data().burnedCount === 0 ? 'good' : 'bad'} />
    </>
  );
}
