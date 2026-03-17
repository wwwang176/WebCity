import { For } from 'solid-js';
import { gameSignals, getGame } from '../../store/gameStore';
import { ZoneType } from '../../../core/grid/types';
import { getBuildingType } from '../../../core/building/types';
import { calculateAttractiveness } from '../../../core/citizen/Migration';

const ZONE_ORDER = [
  ZoneType.RESIDENTIAL_LOW, ZoneType.RESIDENTIAL_HIGH,
  ZoneType.COMMERCIAL_LOW, ZoneType.COMMERCIAL_HIGH,
  ZoneType.INDUSTRIAL, ZoneType.OFFICE,
] as const;
const ZONE_LABELS: Record<number, string> = {
  [ZoneType.RESIDENTIAL_LOW]: 'Residential (Low)',
  [ZoneType.RESIDENTIAL_HIGH]: 'Residential (High)',
  [ZoneType.COMMERCIAL_LOW]: 'Commercial (Low)',
  [ZoneType.COMMERCIAL_HIGH]: 'Commercial (High)',
  [ZoneType.INDUSTRIAL]: 'Industrial',
  [ZoneType.OFFICE]: 'Office',
};

export function SummaryPage() {
  const data = () => {
    gameSignals.tick();
    const state = getGame().getState();
    const grid = state.grid;
    const population = state.citizens.getPopulation();

    const zoneCounts: Record<number, { count: number; capacity: number }> = {};
    for (const zt of ZONE_ORDER) zoneCounts[zt] = { count: 0, capacity: 0 };

    let totalPollution = 0;
    let pollutionCount = 0;
    grid.forEachCell((cell) => {
      if (cell.buildingId > 0 || cell.zoneType > 0) {
        totalPollution += cell.pollution;
        pollutionCount++;
      }
      if (cell.buildingId <= 0 || cell.zoneType === ZoneType.NONE) return;
      const entry = zoneCounts[cell.zoneType];
      if (!entry) return;
      entry.count++;
      const bt = getBuildingType(cell.buildingId);
      if (bt) entry.capacity += bt.residents + bt.workers;
    });
    const avgPollution = pollutionCount > 0 ? totalPollution / pollutionCount : 0;

    const totalHomes = (zoneCounts[ZoneType.RESIDENTIAL_LOW]?.capacity ?? 0) +
      (zoneCounts[ZoneType.RESIDENTIAL_HIGH]?.capacity ?? 0);
    const totalJobs = (zoneCounts[ZoneType.COMMERCIAL_LOW]?.capacity ?? 0) +
      (zoneCounts[ZoneType.COMMERCIAL_HIGH]?.capacity ?? 0) +
      (zoneCounts[ZoneType.INDUSTRIAL]?.capacity ?? 0) +
      (zoneCounts[ZoneType.OFFICE]?.capacity ?? 0);
    const vacantHomes = Math.max(0, totalHomes - population);
    const jobOpenings = Math.max(0, totalJobs - population);

    const avgHappiness = population > 0
      ? Math.round(state.citizens.getAverageHappiness())
      : 70;
    const taxRate = state.taxRates.residential ?? 9;
    const attractiveness = calculateAttractiveness({
      jobOpenings, vacantHomes, avgHappiness, taxRate,
      pollution: avgPollution, crimeRate: Math.min(50, population * 0.02),
    });
    const canMigrate = attractiveness > 50 && vacantHomes > 0 && jobOpenings > 0;

    const pwrRatio = state.power.getSupplyRatio();
    const wtrRatio = state.water.getSupplyRatio();

    const rci = gameSignals.rciDemand();

    return {
      population, totalHomes, totalJobs, vacantHomes, jobOpenings,
      avgHappiness, zoneCounts, attractiveness, canMigrate,
      pwrRatio, wtrRatio, rci,
      checks: [
        { label: 'Attractiveness > 50', value: attractiveness.toFixed(1), ok: attractiveness > 50 },
        { label: 'Vacant Homes > 0', value: String(vacantHomes), ok: vacantHomes > 0 },
        { label: 'Job Openings > 0', value: String(jobOpenings), ok: jobOpenings > 0 },
      ],
    };
  };

  const capLabel = (zt: number) => zt <= ZoneType.RESIDENTIAL_HIGH ? 'Residents' : 'Workers';

  return (
    <>
      <div class="summary-grid">
        <div class="summary-card"><div class="sc-value stat-accent">{data().population}</div><div class="sc-label">Population</div></div>
        <div class="summary-card"><div class="sc-value">{data().avgHappiness}</div><div class="sc-label">Happiness</div></div>
        <div class="summary-card"><div class="sc-value">{data().vacantHomes}</div><div class="sc-label">Vacant Homes</div></div>
        <div class="summary-card"><div class="sc-value">{data().jobOpenings}</div><div class="sc-label">Job Openings</div></div>
      </div>

      <div class="section-title">RCI Demand</div>
      <div style="display:flex;gap:12px;margin-bottom:12px">
        {(['R', 'C', 'I'] as const).map((label, i) => {
          const colors = ['#66bb6a', '#42a5f5', '#ffa726'];
          const keys: ('residential' | 'commercial' | 'industrial')[] = ['residential', 'commercial', 'industrial'];
          const key = keys[i]!;
          const val = () => {
            const rci = data().rci;
            return rci ? rci[key] ?? 0 : 0;
          };
          return (
            <div style="flex:1;text-align:center">
              <div style="font-size:10px;color:#667a90;margin-bottom:4px">{label}</div>
              <div style={{ height: '6px', 'border-radius': '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, Math.max(0, val() * 100))}%`, height: '100%', 'border-radius': '3px', background: colors[i], transition: 'width 0.3s' }} />
              </div>
              <div style={{ 'font-size': '11px', color: colors[i], 'margin-top': '2px' }}>{(val() * 100).toFixed(0)}%</div>
            </div>
          );
        })}
      </div>

      <div class="section-title">Utilities</div>
      <div style="display:flex;gap:12px;margin-bottom:12px">
        {[
          { label: 'Power', ratio: () => data().pwrRatio, color: '#66bb6a' },
          { label: 'Water', ratio: () => data().wtrRatio, color: '#42a5f5' },
        ].map(u => (
          <div style="flex:1">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:#8899b0;margin-bottom:4px">
              <span>{u.label}</span>
              <span style={{ color: u.ratio() >= 1 ? '#66bb6a' : u.ratio() >= 0.7 ? '#ffa726' : '#ef5350' }}>
                {(u.ratio() * 100).toFixed(0)}%
              </span>
            </div>
            <div style={{ height: '6px', 'border-radius': '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div style={{
                width: `${Math.min(100, u.ratio() * 100)}%`, height: '100%', 'border-radius': '3px',
                background: u.ratio() >= 1 ? u.color : u.ratio() >= 0.7 ? '#ffa726' : '#ef5350',
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
        ))}
      </div>

      <div class="section-title">Buildings by Zone</div>
      <table class="data-table">
        <thead><tr><th>Zone</th><th style="text-align:right">Buildings</th><th style="text-align:right">Capacity</th></tr></thead>
        <tbody>
          <For each={[...ZONE_ORDER]}>
            {(zt) => (
              <tr>
                <td class="td-label">{ZONE_LABELS[zt]}</td>
                <td class="td-value" style="text-align:right">{data().zoneCounts[zt]?.count ?? 0}</td>
                <td class="td-value" style="text-align:right">{data().zoneCounts[zt]?.capacity ?? 0} {capLabel(zt)}</td>
              </tr>
            )}
          </For>
          <tr style="border-top:1px solid rgba(100,120,150,0.3)">
            <td class="td-label" style="font-weight:600">Total Housing</td><td /><td class="td-value" style="text-align:right;font-weight:600">{data().totalHomes}</td>
          </tr>
          <tr>
            <td class="td-label" style="font-weight:600">Total Jobs</td><td /><td class="td-value" style="text-align:right;font-weight:600">{data().totalJobs}</td>
          </tr>
        </tbody>
      </table>

      <div class="section-title">Migration Status</div>
      <table class="data-table">
        <thead><tr><th>Condition</th><th style="text-align:right">Value</th><th style="text-align:center">Status</th></tr></thead>
        <tbody>
          <For each={data().checks}>
            {(chk) => (
              <tr>
                <td class="td-label">{chk.label}</td>
                <td class="td-value" style="text-align:right">{chk.value}</td>
                <td style={{ 'text-align': 'center', color: chk.ok ? '#66bb6a' : '#ef5350' }}>{chk.ok ? '\u2713' : '\u2717'}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <div style={{
        'margin-top': '8px', padding: '8px 12px', 'border-radius': '6px',
        'font-size': '12px', 'font-weight': '600',
        background: data().canMigrate ? 'rgba(102,187,106,0.15)' : 'rgba(239,83,80,0.15)',
        color: data().canMigrate ? '#66bb6a' : '#ef5350',
      }}>
        {data().canMigrate ? '\u2713 Citizens can migrate in' : '\u2717 Migration blocked \u2014 fix conditions marked \u2717 above'}
      </div>
    </>
  );
}
