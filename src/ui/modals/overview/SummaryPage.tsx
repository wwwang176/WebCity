import { For, createMemo } from 'solid-js';
import { gameSignals, getGame } from '../../store/gameStore';
import { ZoneType } from '../../../core/grid/types';
import { buildSummaryStats } from '../../../core/stats/SummaryStats';
import { UI_COLORS } from '../../constants';

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

/** `SummaryStats.drags`' keys mapped to their labels. */
const DRAG_LABELS: Record<string, string> = {
  'low happiness': 'Low happiness',
  'high taxes': 'High taxes',
  pollution: 'Too much pollution',
  crime: 'High crime',
  unemployment: 'High unemployment',
};

export function SummaryPage() {
  const data = createMemo(() => {
    gameSignals.tick();
    const s = buildSummaryStats(getGame().getState());
    // The panel and the agent API read the same `buildSummaryStats`; computed separately the two part
    // company (BUG-342). This only reshapes it into what the JSX already uses.
    const zoneCounts: Record<number, { count: number; capacity: number }> = {};
    for (let i = 0; i < ZONE_ORDER.length; i++) {
      const z = s.zones[i]!;
      zoneCounts[ZONE_ORDER[i]!] = { count: z.count, capacity: z.capacity };
    }
    const appealStatus = s.worstDrag === null
      ? 'Attractive'
      : `Unappealing — ${DRAG_LABELS[s.worstDrag.reason] ?? s.worstDrag.reason}`;

    return {
      population: s.population,
      totalHomes: s.totalHomes, totalJobs: s.totalJobs,
      vacantHomes: s.vacantHomes, jobOpenings: s.jobOpenings,
      avgHappiness: s.avgHappiness, zoneCounts,
      attractiveness: s.attractiveness, canMigrate: s.canMigrate,
      pwrRatio: s.powerRatio, wtrRatio: s.waterRatio,
      freightSupplyRatio: s.freightSupplyRatio,
      rci: gameSignals.rciDemand(),
      unemploymentRate: s.unemploymentRate,
      checks: [
        { label: 'City Appeal', value: s.attractiveness.toFixed(1), ok: s.worstDrag === null, status: appealStatus },
        { label: 'Housing', value: String(s.vacantHomes), ok: s.vacantHomes > 0, status: s.vacantHomes > 0 ? `${s.vacantHomes} vacant` : 'No vacancy' },
        { label: 'Jobs', value: String(s.jobOpenings), ok: s.jobOpenings > 0, status: s.jobOpenings > 0 ? `${s.jobOpenings} open` : 'No openings' },
        { label: 'Unemployment', value: '', ok: s.unemploymentRate < 0.1, status: s.unemploymentRate < 0.01 ? 'Full employment' : `${(s.unemploymentRate * 100).toFixed(0)}% unemployed${s.unemploymentRate >= 0.4 ? '!' : ''}` },
      ],
    };
  }, undefined, {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  const capLabel = (zt: number) => zt <= ZoneType.RESIDENTIAL_HIGH ? 'Residents' : 'Workers';

  return (
    <>
      <div class="summary-grid">
        <div class="summary-card"><div class="sc-value stat-accent">{data().population}</div><div class="sc-label">Population</div></div>
        <div class="summary-card"><div class="sc-value">{Math.round(data().avgHappiness)}</div><div class="sc-label">Happiness</div></div>
        <div class="summary-card"><div class="sc-value">{data().vacantHomes}</div><div class="sc-label">Vacant Homes</div></div>
        <div class="summary-card"><div class="sc-value">{data().jobOpenings}</div><div class="sc-label">Job Openings</div></div>
        <div class="summary-card"><div class="sc-value" style={{ color: data().unemploymentRate > 0.2 ? UI_COLORS.STATUS_BAD : data().unemploymentRate > 0.1 ? UI_COLORS.STATUS_WARN : UI_COLORS.STATUS_GOOD }}>{(data().unemploymentRate * 100).toFixed(0)}%</div><div class="sc-label">Unemployment</div></div>
      </div>

      <div class="section-title">RCI Demand</div>
      <div style="display:flex;gap:12px;margin-bottom:12px">
        {(['R', 'C', 'I'] as const).map((label, i) => {
          const colors = [UI_COLORS.STATUS_GOOD, UI_COLORS.ACCENT, UI_COLORS.STATUS_WARN];
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
          { label: 'Power', ratio: () => data().pwrRatio, color: UI_COLORS.STATUS_GOOD },
          { label: 'Water', ratio: () => data().wtrRatio, color: UI_COLORS.ACCENT },
        ].map(u => (
          <div style="flex:1">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:#8899b0;margin-bottom:4px">
              <span>{u.label}</span>
              <span style={{ color: u.ratio() >= 1 ? UI_COLORS.STATUS_GOOD : u.ratio() >= 0.7 ? UI_COLORS.STATUS_WARN : UI_COLORS.STATUS_BAD }}>
                {(u.ratio() * 100).toFixed(0)}%
              </span>
            </div>
            <div style={{ height: '6px', 'border-radius': '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div style={{
                width: `${Math.min(100, u.ratio() * 100)}%`, height: '100%', 'border-radius': '3px',
                background: u.ratio() >= 1 ? u.color : u.ratio() >= 0.7 ? UI_COLORS.STATUS_WARN : UI_COLORS.STATUS_BAD,
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
        ))}
      </div>

      <div class="section-title">Freight</div>
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#8899b0;margin-bottom:4px">
          <span>Supply Rate</span>
          <span style={{ color: data().freightSupplyRatio > 1.5 ? UI_COLORS.STATUS_BAD : data().freightSupplyRatio > 1.2 ? UI_COLORS.STATUS_WARN : data().freightSupplyRatio >= 0.8 ? UI_COLORS.STATUS_GOOD : data().freightSupplyRatio >= 0.5 ? UI_COLORS.STATUS_WARN : UI_COLORS.STATUS_BAD }}>
            {(data().freightSupplyRatio * 100).toFixed(0)}%
          </span>
        </div>
        <div style={{ height: '6px', 'border-radius': '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
          <div style={{
            width: `${Math.min(100, data().freightSupplyRatio * 100)}%`, height: '100%', 'border-radius': '3px',
            background: data().freightSupplyRatio > 1.5 ? UI_COLORS.STATUS_BAD : data().freightSupplyRatio > 1.2 ? UI_COLORS.STATUS_WARN : data().freightSupplyRatio >= 0.8 ? UI_COLORS.STATUS_GOOD : data().freightSupplyRatio >= 0.5 ? UI_COLORS.STATUS_WARN : UI_COLORS.STATUS_BAD,
            transition: 'width 0.3s',
          }} />
        </div>
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
        <tbody>
          <For each={data().checks}>
            {(chk) => (
              <tr>
                <td class="td-label">{chk.label}</td>
                <td class="td-value" style={{ 'text-align': 'right', color: chk.ok ? UI_COLORS.STATUS_GOOD : UI_COLORS.STATUS_BAD }}>{chk.status}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <div style={{
        'margin-top': '8px', padding: '8px 12px', 'border-radius': '6px',
        'font-size': '12px', 'font-weight': '600',
        background: data().canMigrate ? 'rgba(102,187,106,0.15)' : 'rgba(239,83,80,0.15)',
        color: data().canMigrate ? UI_COLORS.STATUS_GOOD : UI_COLORS.STATUS_BAD,
      }}>
        {data().canMigrate ? 'People are moving in' : 'Nobody is moving in'}
      </div>
    </>
  );
}
