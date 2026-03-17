import { gameSignals, getGame } from '../../store/gameStore';
import { getResidentialServiceRatios } from '../../../core/service/ServiceCoverageQuery';

interface ServiceRow {
  label: string;
  ratio: number;
  color: string;
  icon: string;
}

function CoverageBar(props: { row: ServiceRow }) {
  const pct = () => Math.round(props.row.ratio * 100);
  const barColor = () => pct() >= 80 ? props.row.color : pct() >= 50 ? '#ffa726' : '#ef5350';
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
      { label: 'Water', ratio: ratios.wateredRatio, color: '#42a5f5', icon: '\uD83D\uDCA7' },
      { label: 'Police', ratio: ratios.policeRatio, color: '#5c6bc0', icon: '\uD83D\uDE94' },
      { label: 'Fire', ratio: ratios.fireRatio, color: '#ef5350', icon: '\uD83D\uDE92' },
      { label: 'Health', ratio: ratios.healthRatio, color: '#ec407a', icon: '\uD83C\uDFE5' },
      { label: 'Education', ratio: ratios.educationRatio, color: '#ab47bc', icon: '\uD83C\uDFEB' },
      { label: 'Garbage', ratio: ratios.garbageRatio, color: '#8d6e63', icon: '\uD83D\uDDD1' },
      { label: 'Death Care', ratio: ratios.deathCareRatio, color: '#78909c', icon: '\u26B0' },
    ];

    const avgCoverage = rows.reduce((s, r) => s + r.ratio, 0) / rows.length;
    const gaps = rows.filter(r => r.ratio < 0.5);

    return { rows, avgCoverage, gaps };
  };

  return (
    <>
      <div class="summary-grid" style="grid-template-columns:1fr 1fr">
        <div class="summary-card">
          <div class="sc-value" style={{
            color: data().avgCoverage >= 0.8 ? '#66bb6a' : data().avgCoverage >= 0.5 ? '#ffa726' : '#ef5350'
          }}>
            {(data().avgCoverage * 100).toFixed(0)}%
          </div>
          <div class="sc-label">Avg Coverage</div>
        </div>
        <div class="summary-card">
          <div class="sc-value" style={{ color: data().gaps.length === 0 ? '#66bb6a' : '#ef5350' }}>
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
    </>
  );
}
