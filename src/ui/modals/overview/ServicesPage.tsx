import { For, createMemo } from 'solid-js';
import { gameSignals, getGame } from '../../store/gameStore';
import { getResidentialServiceRatios } from '../../../core/service/ServiceCoverageQuery';
import { UI_COLORS } from '../../constants';

interface ServiceEntry {
  icon: string;
  name: string;
  coverage: number;
  /** Supply/demand or load/capacity info */
  detail: string;
  status: string;
  statusColor: string;
}

function statusOf(ratio: number): { label: string; color: string } {
  if (ratio >= 2) return { label: 'Overloaded', color: UI_COLORS.STATUS_BAD };
  if (ratio > 1) return { label: 'Over capacity', color: UI_COLORS.STATUS_WARN };
  return { label: 'Normal', color: UI_COLORS.STATUS_GOOD };
}

function loadDetail(label: string, load: number, cap: number, suffix = ''): string {
  const pct = cap > 0 ? Math.round((load / cap) * 100) : 0;
  return `${label} ${load} / ${cap} (${pct}%)${suffix}`;
}

function coverageColor(pct: number): string {
  if (pct >= 80) return UI_COLORS.STATUS_GOOD;
  if (pct >= 50) return UI_COLORS.STATUS_WARN;
  return UI_COLORS.STATUS_BAD;
}

export function ServicesPage() {
  const data = createMemo(() => {
    gameSignals.tick();
    const state = getGame().getState();
    const r = getResidentialServiceRatios(state);

    const entries: { group: string; items: ServiceEntry[] }[] = [];

    // ── Utilities ──
    const pwrRatio = state.power.getDemand() > 0 ? state.power.getSupply() / state.power.getDemand() : 0;
    const wtrRatio = state.water.getDemand() > 0 ? state.water.getSupply() / state.water.getDemand() : 0;
    entries.push({ group: 'Utilities', items: [
      {
        icon: '\u26A1', name: 'Power', coverage: r.poweredRatio,
        detail: `Supply ${Math.round(state.power.getSupply())} / Demand ${Math.round(state.power.getDemand())}`,
        status: pwrRatio >= 1 ? 'Surplus' : 'Shortage',
        statusColor: pwrRatio >= 1 ? UI_COLORS.STATUS_GOOD : UI_COLORS.STATUS_BAD,
      },
      {
        icon: '\uD83D\uDCA7', name: 'Water', coverage: r.wateredRatio,
        detail: `Supply ${Math.round(state.water.getSupply())} / Demand ${Math.round(state.water.getDemand())}`,
        status: wtrRatio >= 1 ? 'Surplus' : 'Shortage',
        statusColor: wtrRatio >= 1 ? UI_COLORS.STATUS_GOOD : UI_COLORS.STATUS_BAD,
      },
    ]});

    // ── Public Safety ──
    const safetyItems: ServiceEntry[] = [];
    for (const s of state.police.getStations()) {
      const load = state.police.getStationLoad(s.id);
      const st = statusOf(s.capacity > 0 ? load / s.capacity : 0);
      safetyItems.push({ icon: '\uD83D\uDE94', name: 'Police', coverage: r.policeRatio, detail: loadDetail('Load', load, s.capacity), status: st.label, statusColor: st.color });
    }
    if (safetyItems.length === 0) {
      safetyItems.push({ icon: '\uD83D\uDE94', name: 'Police', coverage: r.policeRatio, detail: 'No station', status: 'None', statusColor: UI_COLORS.STATUS_BAD });
    }
    for (const s of state.fire.getStations()) {
      const load = state.fire.getStationLoad(s.id);
      const st = statusOf(s.capacity > 0 ? load / s.capacity : 0);
      safetyItems.push({ icon: '\uD83D\uDE92', name: 'Fire', coverage: r.fireRatio, detail: loadDetail('Load', load, s.capacity), status: st.label, statusColor: st.color });
    }
    if (!state.fire.getStations().length) {
      safetyItems.push({ icon: '\uD83D\uDE92', name: 'Fire', coverage: r.fireRatio, detail: 'No station', status: 'None', statusColor: UI_COLORS.STATUS_BAD });
    }
    entries.push({ group: 'Public Safety', items: safetyItems });

    // ── Health ──
    const healthItems: ServiceEntry[] = [];
    for (const h of state.health.getHospitals()) {
      const load = state.health.getHospitalLoad(h.id);
      const st = statusOf(h.capacity > 0 ? load / h.capacity : 0);
      healthItems.push({ icon: '\uD83C\uDFE5', name: 'Hospital', coverage: r.healthRatio, detail: loadDetail('Load', load, h.capacity), status: st.label, statusColor: st.color });
    }
    if (healthItems.length === 0) {
      healthItems.push({ icon: '\uD83C\uDFE5', name: 'Hospital', coverage: r.healthRatio, detail: 'No hospital', status: 'None', statusColor: UI_COLORS.STATUS_BAD });
    }
    entries.push({ group: 'Health', items: healthItems });

    // ── Education ──
    const schoolLabels: Record<string, string> = { elementary: 'Elementary', highschool: 'High School', university: 'University' };
    const eduItems: ServiceEntry[] = [];
    for (const s of state.education.getSchools()) {
      const enrolled = state.education.getSchoolEnrollment(s.id);
      const demand = state.education.getSchoolDemand(s.id);
      const needSuffix = demand > s.capacity ? ` Need ${demand}` : '';
      const st = demand > s.capacity ? { label: 'Over capacity', color: UI_COLORS.STATUS_WARN } : statusOf(s.capacity > 0 ? enrolled / s.capacity : 0);
      eduItems.push({ icon: '\uD83C\uDFEB', name: schoolLabels[s.type] ?? s.type, coverage: r.educationRatio, detail: loadDetail('Students', enrolled, s.capacity, needSuffix), status: st.label, statusColor: st.color });
    }
    if (eduItems.length === 0) {
      eduItems.push({ icon: '\uD83C\uDFEB', name: 'Education', coverage: r.educationRatio, detail: 'No schools', status: 'None', statusColor: UI_COLORS.STATUS_BAD });
    }
    entries.push({ group: 'Education', items: eduItems });

    // ── Waste & Burial ──
    const wasteItems: ServiceEntry[] = [];
    const garbageLoad = state.garbage.getCurrentLoad();
    const garbageCap = state.garbage.getTotalCapacity();
    const garbageOverflow = state.garbage.getOverflow();
    const gRatio = garbageCap > 0 ? (garbageLoad + garbageOverflow) / garbageCap : (garbageOverflow > 0 ? Infinity : 0);
    const gSt = garbageOverflow > 0 ? { label: 'Overflow', color: UI_COLORS.STATUS_BAD } : statusOf(gRatio);
    wasteItems.push({ icon: '\uD83D\uDDD1', name: 'Garbage', coverage: r.garbageRatio, detail: loadDetail('Landfill', Math.round(garbageLoad), garbageCap), status: gSt.label, statusColor: gSt.color });

    const sewageProduced = Math.round(state.sewage.getProduced());
    const sewageUntreated = state.sewage.getUntreated();
    const sewageCap = state.sewage.getTreatmentCapacity();
    const sewageDetail = sewageCap > 0
      ? loadDetail('Produced', sewageProduced, sewageCap)
      : `${sewageProduced} sewage untreated — build a treatment plant`;
    const sSt = sewageUntreated > 0 ? { label: 'Untreated', color: UI_COLORS.STATUS_WARN } : { label: 'Normal', color: UI_COLORS.STATUS_GOOD };
    wasteItems.push({ icon: '\uD83D\uDCA7', name: 'Sewage', coverage: -1, detail: sewageDetail, status: sSt.label, statusColor: sSt.color });

    const cemeteries = state.deathCare.getCemeteries();
    let cemUsed = 0, cemCap = 0;
    for (const c of cemeteries) { cemUsed += c.used; cemCap += c.capacity; }
    const unprocessed = state.deathCare.getUnprocessed();
    const dSt = unprocessed > 0 ? { label: `Unprocessed ${unprocessed}`, color: UI_COLORS.STATUS_BAD } : statusOf(cemCap > 0 ? cemUsed / cemCap : 0);
    wasteItems.push({ icon: '\u26B0', name: 'Death Care', coverage: r.deathCareRatio, detail: loadDetail('Cemetery', cemUsed, cemCap), status: dSt.label, statusColor: dSt.color });

    entries.push({ group: 'Waste & Burial', items: wasteItems });

    // Summary stats
    const allCoverages = [r.poweredRatio, r.wateredRatio, r.policeRatio, r.fireRatio, r.healthRatio, r.educationRatio, r.garbageRatio, r.deathCareRatio];
    const avgCoverage = allCoverages.reduce((s, v) => s + v, 0) / allCoverages.length;
    const gaps = allCoverages.filter(v => v < 0.5).length;

    return { entries, avgCoverage, gaps };
  }, undefined, {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

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
          <div class="sc-value" style={{ color: data().gaps === 0 ? UI_COLORS.STATUS_GOOD : UI_COLORS.STATUS_BAD }}>
            {data().gaps}
          </div>
          <div class="sc-label">Critical Gaps (&lt;50%)</div>
        </div>
      </div>

      <div style="display:flex;align-items:center;padding:6px 0;font-size:11px;color:#78909c;gap:8px;border-bottom:1px solid rgba(255,255,255,0.1)">
        <span style="min-width:110px">Service</span>
        <span style="min-width:55px">Coverage</span>
        <span style="flex:1">Detail</span>
        <span style="text-align:right">Status</span>
      </div>

      <For each={data().entries}>
        {(group) => (
          <>
            <div class="section-title" style="margin-top:12px">{group.group}</div>
            <For each={group.items}>
              {(item) => (
                <div style="display:flex;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12px;gap:8px">
                  <span style="display:flex;align-items:center;gap:4px;color:#b0bec5;min-width:110px">
                    <span style="font-size:13px">{item.icon}</span>
                    {item.name}
                  </span>
                  {item.coverage >= 0 && (
                    <span style={{ 'min-width': '55px', 'font-size': '11px', color: coverageColor(item.coverage * 100) }}>
                      {Math.round(item.coverage * 100)}%
                    </span>
                  )}
                  <span style="flex:1;font-size:11px;color:#667a90">{item.detail}</span>
                  <span style={{ 'font-weight': '600', 'font-size': '11px', color: item.statusColor, 'white-space': 'nowrap' }}>{item.status}</span>
                </div>
              )}
            </For>
          </>
        )}
      </For>
    </>
  );
}
