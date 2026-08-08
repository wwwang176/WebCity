import { createMemo } from 'solid-js';
import { gameSignals, getGame } from '../../store/gameStore';
import { UI_COLORS } from '../../constants';

function CapacityRow(props: { label: string; current: number; max: number; unit?: string; color: string }) {
  const pct = () => props.max > 0 ? Math.min(100, (props.current / props.max) * 100) : 0;
  const fillColor = () => pct() > 90 ? UI_COLORS.STATUS_BAD : pct() > 70 ? UI_COLORS.STATUS_WARN : props.color;
  return (
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
        <span style="color:#b0bec5">{props.label}</span>
        <span style={{ color: fillColor(), 'font-weight': '500' }}>
          {Math.round(props.current)} / {Math.round(props.max)} {props.unit ?? ''}
        </span>
      </div>
      <div style={{ height: '6px', 'border-radius': '3px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{ width: `${pct()}%`, height: '100%', 'border-radius': '3px', background: fillColor(), transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

function SupplyDemandRow(props: { label: string; supply: number; demand: number; color: string; icon: string }) {
  const ratio = () => props.demand > 0 ? props.supply / props.demand : props.supply > 0 ? 2 : 0;
  const statusColor = () => ratio() >= 1 ? UI_COLORS.STATUS_GOOD : ratio() >= 0.7 ? UI_COLORS.STATUS_WARN : UI_COLORS.STATUS_BAD;
  return (
    <div style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <span style="font-size:14px">{props.icon}</span>
        <span style={`font-size:13px;font-weight:600;color:${UI_COLORS.NEUTRAL}`}>{props.label}</span>
        <span style={{ 'font-size': '11px', 'margin-left': 'auto', color: statusColor(), 'font-weight': '600' }}>
          {(ratio() * 100).toFixed(0)}%
        </span>
      </div>
      <div style="display:flex;gap:16px;font-size:12px;margin-bottom:4px">
        <div style="display:flex;gap:6px"><span style="color:#667a90">Supply</span><span style={`color:${UI_COLORS.STATUS_GOOD};font-weight:500`}>{Math.round(props.supply)}</span></div>
        <div style="display:flex;gap:6px"><span style="color:#667a90">Demand</span><span style="color:#ef9a9a;font-weight:500">{Math.round(props.demand)}</span></div>
      </div>
      <div style={{ height: '6px', 'border-radius': '3px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{
          width: `${Math.min(100, ratio() * 100)}%`, height: '100%', 'border-radius': '3px',
          background: statusColor(), transition: 'width 0.3s',
        }} />
      </div>
    </div>
  );
}

export function InfraPage() {
  const data = createMemo(() => {
    gameSignals.tick();
    const state = getGame().getState();

    // Both halves have to describe the same landfills. getTotalCapacity counts
    // only the reachable, powered ones; pairing it with the unfiltered stored
    // total printed "1800 / 0" at a healthy 0% (BUG-155).
    const garbageLoad = state.garbage.getActiveLoad();
    const garbageCap = state.garbage.getTotalCapacity();
    const garbageStranded = state.garbage.getStrandedCapacity();
    const garbageUncollected = state.garbage.getUncollected();

    const sewageUntreated = state.sewage.getUntreated();
    const sewageCap = state.sewage.getTreatmentCapacity();

    const cemeteries = state.deathCare.getCemeteries();
    let cemUsed = 0, cemCap = 0;
    for (const c of cemeteries) { cemUsed += c.currentLoad; cemCap += c.capacity; }
    const unprocessed = state.deathCare.getUnprocessed();

    return {
      pwrSupply: state.power.getSupply(),
      pwrDemand: state.power.getDemand(),
      wtrSupply: state.water.getSupply(),
      wtrDemand: state.water.getDemand(),
      garbageLoad, garbageCap, garbageStranded, garbageUncollected,
      sewageUntreated, sewageCap,
      cemUsed, cemCap, unprocessed,
      waterPollution: state.sewage.getWaterPollution(),
    };
  }, undefined, {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  return (
    <>
      <SupplyDemandRow label="Power Grid" supply={data().pwrSupply} demand={data().pwrDemand} color="#ffeb3b" icon={'\u26A1'} />
      <SupplyDemandRow label="Water Network" supply={data().wtrSupply} demand={data().wtrDemand} color={UI_COLORS.ACCENT} icon={'\uD83D\uDCA7'} />

      <div class="section-title">Waste Management</div>
      <CapacityRow label="Landfill Usage" current={data().garbageLoad} max={data().garbageCap} color="#8d6e63" />
      {data().garbageStranded > 0 && (
        <div style={`font-size:11px;color:${UI_COLORS.STATUS_BAD};margin-bottom:8px`}>
          {data().garbageStranded} landfill capacity offline (no road or no power)
        </div>
      )}
      {data().garbageUncollected > 0 && (
        <div style={`font-size:11px;color:${UI_COLORS.STATUS_BAD};margin-bottom:8px`}>
          Awaiting pickup: {data().garbageUncollected} bags (causing pollution)
        </div>
      )}

      <div class="section-title">Sewage Treatment</div>
      <CapacityRow label="Treatment Capacity" current={data().sewageCap > 0 ? data().sewageCap - data().sewageUntreated : 0} max={data().sewageCap} color="#607d8b" />
      {data().sewageUntreated > 0 && (
        <div style={`font-size:11px;color:${UI_COLORS.STATUS_WARN};margin-bottom:8px`}>
          Untreated: {Math.round(data().sewageUntreated)} &rarr; Water pollution: {Math.round(data().waterPollution)}
        </div>
      )}

      <div class="section-title">Death Care</div>
      <CapacityRow label="Cemetery Capacity" current={data().cemUsed} max={data().cemCap} color="#78909c" />
      {data().unprocessed > 0 && (
        <div style={`font-size:11px;color:${UI_COLORS.STATUS_BAD};margin-bottom:8px`}>
          Unprocessed deaths: {data().unprocessed} (happiness -20)
        </div>
      )}
    </>
  );
}
