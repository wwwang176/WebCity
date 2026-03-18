import { gameSignals, getGame } from '../../store/gameStore';
import { LifeStage, EducationLevel } from '../../../core/citizen/types';

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
  [LifeStage.ADULT]: '#66bb6a',
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
            <span style="color:#d0d8e8;font-weight:500">{item.count}</span>
            <span style="color:#667a90">({props.total > 0 ? ((item.count / props.total) * 100).toFixed(0) : 0}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DemographicsPage() {
  const stats = () => {
    gameSignals.tick();
    const state = getGame().getState();
    const citizens = state.citizens.getCitizens();
    const pop = citizens.length;

    const stages: Record<string, number> = {};
    const edus: Record<string, number> = {};
    let totalHappiness = 0;
    let totalHealth = 0;
    let unemployed = 0;
    let homeless = 0;
    let adults = 0;
    let employed = 0;

    for (const c of citizens) {
      stages[c.lifeStage] = (stages[c.lifeStage] ?? 0) + 1;
      edus[c.education] = (edus[c.education] ?? 0) + 1;
      totalHappiness += c.happiness;
      totalHealth += c.health;
      if (c.homelessSince !== null) homeless++;
      if (c.lifeStage === LifeStage.ADULT) {
        adults++;
        if (c.workplaceId) employed++;
        else if (c.unemployedSince !== null) unemployed++;
      }
    }

    return {
      pop, totalHappiness, totalHealth,
      avgHappiness: pop > 0 ? totalHappiness / pop : 0,
      avgHealth: pop > 0 ? totalHealth / pop : 0,
      adults, employed, unemployed, homeless,
      employmentRate: adults > 0 ? employed / adults : 0,
      stageItems: [LifeStage.BABY, LifeStage.CHILD, LifeStage.TEEN, LifeStage.ADULT, LifeStage.SENIOR].map(s => ({
        label: STAGE_LABELS[s] ?? s, count: stages[s] ?? 0, color: STAGE_COLORS[s] ?? '#888',
      })),
      eduItems: [EducationLevel.NONE, EducationLevel.ELEMENTARY, EducationLevel.HIGH_SCHOOL, EducationLevel.UNIVERSITY].map(e => ({
        label: EDU_LABELS[e] ?? e, count: edus[e] ?? 0, color: EDU_COLORS[e] ?? '#888',
      })),
    };
  };

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
          <div class="sc-value" style="color:#ffa726">{stats().homeless}</div>
          <div class="sc-label">Homeless</div>
        </div>
      </div>
    </>
  );
}
