import { For } from 'solid-js';
import { gameSignals, getGame } from '../../store/gameStore';
import { getResidentialServiceRatios } from '../../../core/service/ServiceCoverageQuery';
import { UI_COLORS } from '../../constants';

interface ServiceRow {
  label: string;
  ratio: number;
  color: string;
  icon: string;
}

interface FacilityStatus {
  name: string;
  load: number;
  capacity: number;
  ratio: number;
}

function CoverageBar(props: { row: ServiceRow }) {
  const pct = () => Math.round(props.row.ratio * 100);
  const barColor = () => pct() >= 80 ? props.row.color : pct() >= 50 ? UI_COLORS.STATUS_WARN : UI_COLORS.STATUS_BAD;
  return (
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:12px;color:#b0bec5;display:flex;align-items:center;gap:6px">
          <span style="font-size:14px">{props.row.icon}</span>
          {props.row.label}
        </span>
        <span style={{ 'font-size': '12px', 'font-weight': '600', color: barColor() }}>{pct()}%</span>
      </div>
      <div style={{ height: '6px', 'border-radius': '3px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{
          width: `${pct()}%`, height: '100%', 'border-radius': '3px',
          background: barColor(), transition: 'width 0.3s',
        }} />
      </div>
    </div>
  );
}

export function ServicesPage() {
  const data = () => {
    gameSignals.tick();
    const state = getGame().getState();
    const ratios = getResidentialServiceRatios(state);

    const rows: ServiceRow[] = [
      { label: 'Power', ratio: ratios.poweredRatio, color: '#ffeb3b', icon: '\u26A1' },
      { label: 'Water', ratio: ratios.wateredRatio, color: UI_COLORS.ACCENT, icon: '\uD83D\uDCA7' },
      { label: 'Police', ratio: ratios.policeRatio, color: '#5c6bc0', icon: '\uD83D\uDE94' },
      { label: 'Fire', ratio: ratios.fireRatio, color: UI_COLORS.STATUS_BAD, icon: '\uD83D\uDE92' },
      { label: 'Health', ratio: ratios.healthRatio, color: '#ec407a', icon: '\uD83C\uDFE5' },
      { label: 'Education', ratio: ratios.educationRatio, color: '#ab47bc', icon: '\uD83C\uDFEB' },
      { label: 'Garbage', ratio: ratios.garbageRatio, color: '#8d6e63', icon: '\uD83D\uDDD1' },
      { label: 'Death Care', ratio: ratios.deathCareRatio, color: '#78909c', icon: '\u26B0' },
    ];

    const avgCoverage = rows.reduce((s, r) => s + r.ratio, 0) / rows.length;
    const gaps = rows.filter(r => r.ratio < 0.5);

    // Facility load status
    const facilities: FacilityStatus[] = [];
    for (const h of state.health.getHospitals()) {
      const load = state.health.getHospitalLoad(h.id);
      facilities.push({ name: 'Hospital', load, capacity: h.capacity, ratio: h.capacity > 0 ? load / h.capacity : 0 });
    }
    const schoolLabels: Record<string, string> = { elementary: 'Elementary', highschool: 'High School', university: 'University' };
    for (const s of state.education.getSchools()) {
      const enrolled = state.education.getSchoolEnrollment(s.id);
      facilities.push({ name: schoolLabels[s.type] ?? s.type, load: enrolled, capacity: s.capacity, ratio: s.capacity > 0 ? enrolled / s.capacity : 0 });
    }

    return { rows, avgCoverage, gaps, facilities };
  };

  return (
    <>
      <div class="summary-grid" style="grid-template-columns:1fr 1fr">
        <div class="summary-card">
          <div class="sc-value" style={{
            color: data().avgCoverage >= 0.8 ? UI_COLORS.STATUS_GOOD : data().avgCoverage >= 0.5 ? UI_COLORS.STATUS_WARN : UI_COLORS.STATUS_BAD
          }}>
            {(data().avgCoverage * 100).toFixed(0)}%
          </div>
          <div class="sc-label">Avg Coverage</div>
        </div>
        <div class="summary-card">
          <div class="sc-value" style={{ color: data().gaps.length === 0 ? UI_COLORS.STATUS_GOOD : UI_COLORS.STATUS_BAD }}>
            {data().gaps.length}
          </div>
          <div class="sc-label">Critical Gaps (&lt;50%)</div>
        </div>
      </div>

      <div class="section-title">Coverage by Service</div>
      {data().rows.map(row => <CoverageBar row={row} />)}

      {data().gaps.length > 0 && (
        <div style={{
          'margin-top': '8px', padding: '8px 12px', 'border-radius': '6px',
          'font-size': '12px', background: 'rgba(239,83,80,0.1)', color: '#ef9a9a',
        }}>
          Low coverage: {data().gaps.map(g => g.label).join(', ')}
        </div>
      )}

      <div class="section-title" style="margin-top:16px">Facility Load</div>
      <For each={data().facilities}>
        {(f) => {
          const pct = Math.round(f.ratio * 100);
          const color = f.ratio >= 2 ? UI_COLORS.STATUS_BAD : f.ratio > 1 ? UI_COLORS.STATUS_WARN : UI_COLORS.STATUS_GOOD;
          const label = f.ratio >= 2 ? 'Overloaded' : f.ratio > 1 ? 'Over capacity' : 'Normal';
          return (
            <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.05)">
              <span style="color:#b0bec5">{f.name}</span>
              <span style="display:flex;align-items:center;gap:8px">
                <span style="color:#b0bec5">{f.load} / {f.capacity}</span>
                <span style={{ 'font-weight': '600', color, 'min-width': '90px', 'text-align': 'right' }}>{pct}% — {label}</span>
              </span>
            </div>
          );
        }}
      </For>
    </>
  );
}
