import { createMemo } from 'solid-js';
import { gameSignals, getGame } from '../../store/gameStore';
import { LifeStage, EducationLevel } from '../../../core/citizen/types';
import { buildDemographicsStats } from '../../../core/stats/DemographicsStats';
import { UI_COLORS } from '../../constants';

const STAGE_LABELS: Record<string, string> = {
  [LifeStage.BABY]: 'Baby',
  [LifeStage.CHILD]: 'Child',
  [LifeStage.TEEN]: 'Teen',
  [LifeStage.ADULT]: 'Adult',
  [LifeStage.SENIOR]: 'Senior',
};
const STAGE_COLORS: Record<string, string> = {
  [LifeStage.BABY]: '#ce93d8',
  [LifeStage.CHILD]: '#81d4fa',
  [LifeStage.TEEN]: '#80cbc4',
  [LifeStage.ADULT]: UI_COLORS.STATUS_GOOD,
  [LifeStage.SENIOR]: '#ffb74d',
};

const EDU_LABELS: Record<string, string> = {
  [EducationLevel.NONE]: 'None',
  [EducationLevel.ELEMENTARY]: 'Elementary',
  [EducationLevel.HIGH_SCHOOL]: 'High School',
  [EducationLevel.UNIVERSITY]: 'University',
};
const EDU_COLORS: Record<string, string> = {
  [EducationLevel.NONE]: '#78909c',
  [EducationLevel.ELEMENTARY]: '#4fc3f7',
  [EducationLevel.HIGH_SCHOOL]: '#7986cb',
  [EducationLevel.UNIVERSITY]: '#ba68c8',
};

const EDU_ORDER = [EducationLevel.NONE, EducationLevel.ELEMENTARY, EducationLevel.HIGH_SCHOOL, EducationLevel.UNIVERSITY] as const;

// The keys follow `DemographicsStats`: defined separately on each side, changing one leaves a column
// showing its raw key name.
const ZONE_LABELS: Record<string, string> = {
  commercial: 'Commercial',
  industrial: 'Industrial',
  office: 'Office',
  unemployed: 'Unemployed',
};
const ZONE_COLORS: Record<string, string> = {
  commercial: UI_COLORS.ACCENT,
  industrial: UI_COLORS.STATUS_WARN,
  office: '#ab47bc',
  unemployed: UI_COLORS.STATUS_BAD,
};

const HOUSING_LABELS: Record<string, string> = { level1: 'Lv1', level2: 'Lv2', level3: 'Lv3' };
const HOUSING_COLORS: Record<string, string> = {
  level1: '#78909c', level2: UI_COLORS.STATUS_GOOD, level3: '#ffd54f',
};

function DistributionBar(props: { items: { label: string; count: number; color: string }[]; total: number }) {
  return (
    <div style="margin-bottom:12px">
      <div style={{ display: 'flex', height: '8px', 'border-radius': '4px', overflow: 'hidden', background: 'rgba(255,255,255,0.05)', 'margin-bottom': '6px' }}>
        {props.items.map(item => {
          const pct = props.total > 0 ? (item.count / props.total) * 100 : 0;
          return pct > 0 ? <div style={{ width: `${pct}%`, background: item.color, transition: 'width 0.3s' }} /> : null;
        })}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px 16px">
        {props.items.map(item => (
          <div style="display:flex;align-items:center;gap:4px;font-size:11px">
            <div style={{ width: '8px', height: '8px', 'border-radius': '2px', background: item.color }} />
            <span style="color:#8899b0">{item.label}</span>
            <span style={`color:${UI_COLORS.NEUTRAL};font-weight:500`}>{item.count}</span>
            <span style="color:#667a90">({props.total > 0 ? ((item.count / props.total) * 100).toFixed(0) : 0}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CrossTable(props: {
  title: string;
  rowLabels: string[];
  colLabels: string[];
  colColors: string[];
  data: number[][];
  rowTotals: number[];
}) {
  return (
    <div style="margin-bottom:12px;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead>
          <tr>
            <th style="text-align:left;padding:4px 6px;color:#667a90">{props.title}</th>
            {props.colLabels.map((label, i) => (
              <th style={{ 'text-align': 'right', padding: '4px 6px', color: props.colColors[i] }}>{label}</th>
            ))}
            <th style="text-align:right;padding:4px 6px;color:#667a90">Total</th>
          </tr>
        </thead>
        <tbody>
          {props.rowLabels.map((rowLabel, ri) => (
            <tr style={{ background: ri % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
              <td style="padding:4px 6px;color:#8899b0">{rowLabel}</td>
              {props.colLabels.map((_, ci) => {
                const val = props.data[ri]?.[ci] ?? 0;
                return (
                  <td style={{ 'text-align': 'right', padding: '4px 6px', color: val > 0 ? UI_COLORS.NEUTRAL : '#444' }}>
                    {val}
                  </td>
                );
              })}
              <td style="text-align:right;padding:4px 6px;color:#8899b0;font-weight:500">{props.rowTotals[ri]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DemographicsPage() {
  const stats = createMemo(() => {
    gameSignals.tick();
    const s = buildDemographicsStats(getGame().getState());
    // The panel and the agent API read the same `buildDemographicsStats`. This only turns keys into
    // labels and colours; not one number is recomputed (BUG-342).
    const label = (items: { key: string; count: number }[], labels: Record<string, string>, colors: Record<string, string>) =>
      items.map(b => ({ label: labels[b.key] ?? b.key, count: b.count, color: colors[b.key] ?? '#888' }));

    return {
      pop: s.population,
      avgHappiness: s.avgHappiness,
      avgHealth: s.avgHealth,
      adults: s.adults, employed: s.employed,
      unemployed: s.unemployed, homeless: s.homeless,
      employmentRate: s.employmentRate,
      stageItems: label(s.lifeStages, STAGE_LABELS, STAGE_COLORS),
      eduItems: label(s.education, EDU_LABELS, EDU_COLORS),
      housingItems: label(s.housingLevels, HOUSING_LABELS, HOUSING_COLORS),
      totalWithHome: s.withHome,
      workItems: label(s.workZones, ZONE_LABELS, ZONE_COLORS),
      totalWorkers: s.workers,
      eduWorkData: s.educationByWork.map(r => r.counts),
      eduWorkTotals: s.educationByWork.map(r => r.total),
      eduHousingData: s.educationByHousing.map(r => r.counts),
      eduHousingTotals: s.educationByHousing.map(r => r.total),
    };
  }, undefined, {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  return (
    <>
      <div class="summary-grid">
        <div class="summary-card"><div class="sc-value stat-accent">{stats().pop}</div><div class="sc-label">Population</div></div>
        <div class="summary-card"><div class="sc-value">{stats().avgHappiness.toFixed(0)}</div><div class="sc-label">Avg Happiness</div></div>
        <div class="summary-card"><div class="sc-value">{stats().avgHealth.toFixed(0)}</div><div class="sc-label">Avg Health</div></div>
      </div>

      <div class="section-title">Age Distribution</div>
      <DistributionBar items={stats().stageItems} total={stats().pop} />

      <div class="section-title">Education Level</div>
      <DistributionBar items={stats().eduItems} total={stats().pop} />

      <div class="section-title">Housing Level</div>
      <DistributionBar items={stats().housingItems} total={stats().totalWithHome} />

      <div class="section-title">Workplace Distribution</div>
      <DistributionBar items={stats().workItems} total={stats().totalWorkers} />

      <div class="section-title">Education × Workplace</div>
      <CrossTable
        title="Education"
        rowLabels={EDU_ORDER.map(e => EDU_LABELS[e]!)}
        colLabels={['COM', 'IND', 'Office', 'No Job']}
        colColors={[ZONE_COLORS.COM!, ZONE_COLORS.IND!, ZONE_COLORS.OFFICE!, ZONE_COLORS.UNEMPLOYED!]}
        data={stats().eduWorkData}
        rowTotals={stats().eduWorkTotals}
      />

      <div class="section-title">Education × Housing Level</div>
      <CrossTable
        title="Education"
        rowLabels={EDU_ORDER.map(e => EDU_LABELS[e]!)}
        colLabels={['Lv1', 'Lv2', 'Lv3']}
        colColors={[HOUSING_COLORS.level1!, HOUSING_COLORS.level2!, HOUSING_COLORS.level3!]}
        data={stats().eduHousingData}
        rowTotals={stats().eduHousingTotals}
      />

      <div class="section-title">Employment</div>
      <div class="summary-grid" style="grid-template-columns:1fr 1fr 1fr">
        <div class="summary-card">
          <div class="sc-value stat-positive">{(stats().employmentRate * 100).toFixed(0)}%</div>
          <div class="sc-label">Employment Rate</div>
        </div>
        <div class="summary-card">
          <div class="sc-value stat-negative">{stats().unemployed}</div>
          <div class="sc-label">Unemployed</div>
        </div>
        <div class="summary-card">
          <div class="sc-value" style={`color:${UI_COLORS.STATUS_WARN}`}>{stats().homeless}</div>
          <div class="sc-label">Homeless</div>
        </div>
      </div>
    </>
  );
}
