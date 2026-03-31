import { createMemo } from 'solid-js';
import { gameSignals, getGame } from '../../store/gameStore';
import { LifeStage, EducationLevel } from '../../../core/citizen/types';
import { ZoneType, isResidentialZone, isCommercialZone } from '../../../core/grid/types';
import { getBuildingType } from '../../../core/building/types';
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

const ZONE_LABELS: Record<string, string> = {
  COM: 'Commercial',
  IND: 'Industrial',
  OFFICE: 'Office',
  UNEMPLOYED: 'Unemployed',
};
const ZONE_COLORS: Record<string, string> = {
  COM: UI_COLORS.ACCENT,
  IND: UI_COLORS.STATUS_WARN,
  OFFICE: '#ab47bc',
  UNEMPLOYED: UI_COLORS.STATUS_BAD,
};

const LEVEL_LABELS: Record<number, string> = { 1: 'Lv1', 2: 'Lv2', 3: 'Lv3' };
const LEVEL_COLORS: Record<number, string> = { 1: '#78909c', 2: UI_COLORS.STATUS_GOOD, 3: '#ffd54f' };

function getWorkZoneKey(zoneType: number): string {
  if (isCommercialZone(zoneType)) return 'COM';
  if (zoneType === ZoneType.INDUSTRIAL) return 'IND';
  if (zoneType === ZoneType.OFFICE) return 'OFFICE';
  return 'COM';
}

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
    const state = getGame().getState();
    const grid = state.grid;
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

    // Distribution counters
    const housingLevels: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
    const workZones: Record<string, number> = { COM: 0, IND: 0, OFFICE: 0 };

    // Cross-tab: education × work zone (rows=edu, cols=COM/IND/OFFICE/Unemployed)
    const eduWorkCross: Record<string, Record<string, number>> = {};
    // Cross-tab: education × housing level (rows=edu, cols=Lv1/Lv2/Lv3)
    const eduHousingCross: Record<string, Record<number, number>> = {};
    for (const e of EDU_ORDER) {
      eduWorkCross[e] = { COM: 0, IND: 0, OFFICE: 0, UNEMPLOYED: 0 };
      eduHousingCross[e] = { 1: 0, 2: 0, 3: 0 };
    }

    for (const c of citizens) {
      stages[c.lifeStage] = (stages[c.lifeStage] ?? 0) + 1;
      edus[c.education] = (edus[c.education] ?? 0) + 1;
      totalHappiness += c.happiness;
      totalHealth += c.health;
      if (c.homelessSince !== null) homeless++;

      // Housing level
      if (c.homeId) {
        const [hx, hy] = c.homeId.split(',').map(Number);
        const homeCell = grid.getCell(hx!, hy!);
        if (homeCell) {
          const bt = getBuildingType(homeCell.buildingId);
          if (bt) {
            housingLevels[bt.level] = (housingLevels[bt.level] ?? 0) + 1;
            eduHousingCross[c.education]![bt.level] = (eduHousingCross[c.education]![bt.level] ?? 0) + 1;
          }
        }
      }

      if (c.lifeStage === LifeStage.ADULT) {
        adults++;
        if (c.workplaceId) {
          employed++;
          const [wx, wy] = c.workplaceId.split(',').map(Number);
          const workCell = grid.getCell(wx!, wy!);
          if (workCell) {
            const zk = getWorkZoneKey(workCell.zoneType);
            workZones[zk] = (workZones[zk] ?? 0) + 1;
            eduWorkCross[c.education]![zk] = (eduWorkCross[c.education]![zk] ?? 0) + 1;
          }
        } else {
          if (c.unemployedSince !== null) unemployed++;
          eduWorkCross[c.education]!.UNEMPLOYED = (eduWorkCross[c.education]!.UNEMPLOYED ?? 0) + 1;
        }
      }
    }

    // Build cross-tab data arrays
    const workColKeys = ['COM', 'IND', 'OFFICE', 'UNEMPLOYED'];
    const eduWorkData = EDU_ORDER.map(e => workColKeys.map(z => eduWorkCross[e]![z] ?? 0));
    const eduWorkTotals = eduWorkData.map(row => row.reduce((a, b) => a + b, 0));

    const levelColKeys = [1, 2, 3];
    const eduHousingData = EDU_ORDER.map(e => levelColKeys.map(l => eduHousingCross[e]![l] ?? 0));
    const eduHousingTotals = eduHousingData.map(row => row.reduce((a, b) => a + b, 0));

    const totalWithHome = Object.values(housingLevels).reduce((a, b) => a + b, 0);
    const totalWorkers = Object.values(workZones).reduce((a, b) => a + b, 0);

    return {
      pop, totalHappiness, totalHealth,
      avgHappiness: pop > 0 ? totalHappiness / pop : 0,
      avgHealth: pop > 0 ? totalHealth / pop : 0,
      adults, employed, unemployed, homeless,
      employmentRate: adults > 0 ? employed / adults : 0,
      stageItems: [LifeStage.BABY, LifeStage.CHILD, LifeStage.TEEN, LifeStage.ADULT, LifeStage.SENIOR].map(s => ({
        label: STAGE_LABELS[s] ?? s, count: stages[s] ?? 0, color: STAGE_COLORS[s] ?? '#888',
      })),
      eduItems: EDU_ORDER.map(e => ({
        label: EDU_LABELS[e] ?? e, count: edus[e] ?? 0, color: EDU_COLORS[e] ?? '#888',
      })),
      housingItems: levelColKeys.map(l => ({
        label: LEVEL_LABELS[l]!, count: housingLevels[l] ?? 0, color: LEVEL_COLORS[l]!,
      })),
      totalWithHome,
      workItems: ['COM', 'IND', 'OFFICE'].map(z => ({
        label: ZONE_LABELS[z]!, count: workZones[z] ?? 0, color: ZONE_COLORS[z]!,
      })),
      totalWorkers,
      eduWorkData, eduWorkTotals,
      eduHousingData, eduHousingTotals,
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
        colColors={[LEVEL_COLORS[1]!, LEVEL_COLORS[2]!, LEVEL_COLORS[3]!]}
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
