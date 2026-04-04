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
  /** Load percentage (-1 if not applicable) */
  loadPct: number;
  status: string;
  statusColor: string;
}

function statusOf(ratio: number): { label: string; color: string } {
  if (ratio >= 2) return { label: 'Overloaded', color: UI_COLORS.STATUS_BAD };
  if (ratio > 1) return { label: 'Over capacity', color: UI_COLORS.STATUS_WARN };
  return { label: 'Normal', color: UI_COLORS.STATUS_GOOD };
}

function loadDetail(label: string, load: number, cap: number, suffix = ''): { detail: string; pct: number } {
  const pct = cap > 0 ? Math.round((load / cap) * 100) : 0;
  return { detail: `${label} ${load} / ${cap}${suffix}`, pct };
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

    // helper to build a service entry with loadDetail
    const mkEntry = (icon: string, name: string, coverage: number, label: string, load: number, cap: number, st: { label: string; color: string }, suffix = ''): ServiceEntry => {
      const ld = loadDetail(label, load, cap, suffix);
      return { icon, name, coverage, detail: ld.detail, loadPct: ld.pct, status: st.label, statusColor: st.color };
    };

    // ── Power (個別設施 → 統計) ──
    const pwrFacilities: ServiceEntry[] = [];
    const pwrStats: ServiceEntry[] = [];
    const powerPlants = state.power.getPlants();
    for (const p of powerPlants) {
      pwrFacilities.push({ icon: '\u26A1', name: 'Power Plant', coverage: r.poweredRatio, detail: `Output ${Math.round(p.output)}`, loadPct: -1, status: '', statusColor: '' });
    }
    if (powerPlants.length === 0) {
      pwrStats.push({ icon: '\u26A1', name: 'Power', coverage: r.poweredRatio, detail: 'No power plant', loadPct: -1, status: 'None', statusColor: UI_COLORS.STATUS_BAD });
    } else {
      const pwrDemand = Math.round(state.power.getDemand());
      const pwrSupply = Math.round(state.power.getSupply());
      const pSt = pwrSupply >= pwrDemand ? { label: 'Surplus', color: UI_COLORS.STATUS_GOOD } : { label: 'Shortage', color: UI_COLORS.STATUS_BAD };
      pwrStats.push(mkEntry('', '', -1, 'Load', pwrDemand, pwrSupply, pSt));
    }
    entries.push({ group: 'Power', items: [...pwrFacilities, ...pwrStats] });

    // ── Water (個別設施 → 統計) ──
    const wtrFacilities: ServiceEntry[] = [];
    const wtrStats: ServiceEntry[] = [];
    const pumpingStations = state.water.getPlants();
    for (const wp of pumpingStations) {
      wtrFacilities.push({ icon: '\uD83D\uDCA7', name: 'Water Plant', coverage: r.wateredRatio, detail: `Output ${Math.round(wp.output)}`, loadPct: -1, status: '', statusColor: '' });
    }
    const treatPlants = state.sewage.getTreatmentPlants();
    const sewageProduced = Math.round(state.sewage.getProduced());
    const sewageTotalCap = state.sewage.getTreatmentCapacity();
    const sewageUntreated = state.sewage.getUntreated();
    for (const tp of treatPlants) {
      const tpLoad = sewageTotalCap > 0 ? Math.round(sewageProduced * tp.capacity / sewageTotalCap) : 0;
      const tpSt = statusOf(tp.capacity > 0 ? tpLoad / tp.capacity : 0);
      wtrFacilities.push(mkEntry('\uD83C\uDFED', 'Sewage Plant', r.sewageRatio, 'Load', tpLoad, tp.capacity, tpSt));
    }
    if (pumpingStations.length === 0) {
      wtrStats.push({ icon: '\uD83D\uDCA7', name: 'Water', coverage: r.wateredRatio, detail: 'No water plant', loadPct: -1, status: 'None', statusColor: UI_COLORS.STATUS_BAD });
    } else {
      const wtrDemand = Math.round(state.water.getDemand());
      const wtrSupply = Math.round(state.water.getSupply());
      const wSt = wtrSupply >= wtrDemand ? { label: 'Surplus', color: UI_COLORS.STATUS_GOOD } : { label: 'Shortage', color: UI_COLORS.STATUS_BAD };
      wtrStats.push(mkEntry('', '', -1, 'Load', wtrDemand, wtrSupply, wSt));
    }
    if (treatPlants.length === 0) {
      const noSt = sewageProduced > 0 ? { label: 'Untreated', color: UI_COLORS.STATUS_WARN } : { label: 'None', color: UI_COLORS.STATUS_BAD };
      wtrStats.push({ icon: '\uD83C\uDFED', name: 'Sewage', coverage: -1, detail: sewageProduced > 0 ? `No sewage plant \u00B7 ${sewageProduced} sewage` : 'No sewage plant', loadPct: -1, status: noSt.label, statusColor: noSt.color });
    } else {
      const tSt = sewageUntreated > 0 ? { label: 'Untreated', color: UI_COLORS.STATUS_WARN } : { label: 'Normal', color: UI_COLORS.STATUS_GOOD };
      wtrStats.push(mkEntry('', '', -1, 'Load', sewageProduced, sewageTotalCap, tSt));
    }
    entries.push({ group: 'Water', items: [...wtrFacilities, ...wtrStats] });

    // ── Public Safety ──
    const safetyItems: ServiceEntry[] = [];
    for (const s of state.police.getStations()) {
      const load = state.police.getStationLoad(s.id);
      safetyItems.push(mkEntry('\uD83D\uDE94', 'Police', r.policeRatio, 'Load', load, s.capacity, statusOf(s.capacity > 0 ? load / s.capacity : 0)));
    }
    if (safetyItems.length === 0) {
      safetyItems.push({ icon: '\uD83D\uDE94', name: 'Police', coverage: r.policeRatio, detail: 'No station', loadPct: -1, status: 'None', statusColor: UI_COLORS.STATUS_BAD });
    }
    for (const s of state.fire.getStations()) {
      const load = state.fire.getStationLoad(s.id);
      safetyItems.push(mkEntry('\uD83D\uDE92', 'Fire', r.fireRatio, 'Load', load, s.capacity, statusOf(s.capacity > 0 ? load / s.capacity : 0)));
    }
    if (!state.fire.getStations().length) {
      safetyItems.push({ icon: '\uD83D\uDE92', name: 'Fire', coverage: r.fireRatio, detail: 'No station', loadPct: -1, status: 'None', statusColor: UI_COLORS.STATUS_BAD });
    }
    entries.push({ group: 'Public Safety', items: safetyItems });

    // ── Health ──
    const healthItems: ServiceEntry[] = [];
    for (const h of state.health.getHospitals()) {
      const load = state.health.getHospitalLoad(h.id);
      healthItems.push(mkEntry('\uD83C\uDFE5', 'Hospital', r.healthRatio, 'Load', load, h.capacity, statusOf(h.capacity > 0 ? load / h.capacity : 0)));
    }
    if (healthItems.length === 0) {
      healthItems.push({ icon: '\uD83C\uDFE5', name: 'Hospital', coverage: r.healthRatio, detail: 'No hospital', loadPct: -1, status: 'None', statusColor: UI_COLORS.STATUS_BAD });
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
      eduItems.push(mkEntry('\uD83C\uDFEB', schoolLabels[s.type] ?? s.type, r.educationRatio, 'Students', enrolled, s.capacity, st, needSuffix));
    }
    if (eduItems.length === 0) {
      eduItems.push({ icon: '\uD83C\uDFEB', name: 'Education', coverage: r.educationRatio, detail: 'No schools', loadPct: -1, status: 'None', statusColor: UI_COLORS.STATUS_BAD });
    }
    entries.push({ group: 'Education', items: eduItems });

    // ── Garbage ──
    const garbageItems: ServiceEntry[] = [];
    const garbageFacilities = state.garbage.getFacilities();
    for (const f of garbageFacilities) {
      const fBurnedWk = f.burnDaily ? Math.round(f.burnDaily.reduce((a: number, b: number) => a + b, 0)) : 0;
      const burnSuffix = ` \u00B7 Burned ${fBurnedWk}/wk`;
      const fSt = statusOf(f.capacity > 0 ? f.currentLoad / f.capacity : 0);
      garbageItems.push(mkEntry('\uD83D\uDDD1', 'Landfill', r.garbageRatio, 'Load', f.currentLoad, f.capacity, fSt, burnSuffix));
    }
    const awaitingGarbage = state.garbage.getUncollected();
    const producedWk = state.garbage.getProducedPerWeek();
    const burnedWk = state.garbage.getBurnedPerWeek();
    if (garbageFacilities.length === 0) {
      const noSt = awaitingGarbage > 0 ? { label: `${awaitingGarbage} awaiting pickup`, color: UI_COLORS.STATUS_BAD } : { label: 'None', color: UI_COLORS.STATUS_BAD };
      const noSuffix = producedWk > 0 ? ` \u00B7 Produced ${producedWk}/wk` : '';
      garbageItems.push({ icon: '\uD83D\uDDD1', name: 'Garbage', coverage: r.garbageRatio, detail: `No landfill${noSuffix}`, loadPct: -1, status: noSt.label, statusColor: noSt.color });
    } else {
      const summaryParts: string[] = [];
      summaryParts.push(`Awaiting pickup ${awaitingGarbage}`);
      summaryParts.push(`Produced ${producedWk}/wk`);
      summaryParts.push(`Burned ${burnedWk}/wk`);
      const aSt = awaitingGarbage > 0 ? { label: `${awaitingGarbage} awaiting`, color: UI_COLORS.STATUS_BAD } : { label: 'Normal', color: UI_COLORS.STATUS_GOOD };
      garbageItems.push({ icon: '\uD83D\uDDD1', name: 'Garbage', coverage: -1, detail: summaryParts.join(' \u00B7 '), loadPct: -1, status: aSt.label, statusColor: aSt.color });
    }
    entries.push({ group: 'Garbage', items: garbageItems });

    // ── Death Care ──
    const burialItems: ServiceEntry[] = [];
    const cemeteries = state.deathCare.getCemeteries();
    for (const c of cemeteries) {
      const cCrematedWk = c.recentDaily ? Math.round(c.recentDaily.reduce((a: number, b: number) => a + b, 0)) : 0;
      const cremSuffix = ` \u00B7 Cremated ${cCrematedWk}/wk`;
      const cSt = statusOf(c.capacity > 0 ? c.currentLoad / c.capacity : 0);
      burialItems.push(mkEntry('\u26B0', 'Cemetery', r.deathCareRatio, 'Bodies', c.currentLoad, c.capacity, cSt, cremSuffix));
    }
    const awaitingPickup = state.deathCare.getPendingDeathQueue().length;
    const deathsWk = state.deathCare.getRecentDeaths();
    const crematedWk = state.deathCare.getRecentCremations();
    if (cemeteries.length === 0) {
      const noSt = awaitingPickup > 0 ? { label: `${awaitingPickup} awaiting pickup`, color: UI_COLORS.STATUS_BAD } : { label: 'None', color: UI_COLORS.STATUS_BAD };
      const noSuffix = deathsWk > 0 ? ` \u00B7 Deaths ${deathsWk}/wk` : '';
      burialItems.push({ icon: '\u26B0', name: 'Death Care', coverage: r.deathCareRatio, detail: `No cemetery${noSuffix}`, loadPct: -1, status: noSt.label, statusColor: noSt.color });
    } else {
      const summaryParts: string[] = [];
      summaryParts.push(`Awaiting pickup ${awaitingPickup}`);
      summaryParts.push(`Deaths ${deathsWk}/wk`);
      summaryParts.push(`Cremated ${crematedWk}/wk`);
      const aSt = awaitingPickup > 0 ? { label: `${awaitingPickup} awaiting`, color: UI_COLORS.STATUS_BAD } : { label: 'Normal', color: UI_COLORS.STATUS_GOOD };
      burialItems.push({ icon: '\u26B0', name: 'Death Care', coverage: -1, detail: summaryParts.join(' \u00B7 '), loadPct: -1, status: aSt.label, statusColor: aSt.color });
    }

    entries.push({ group: 'Death Care', items: burialItems });

    // Summary stats
    const allCoverages = [r.poweredRatio, r.wateredRatio, r.sewageRatio, r.policeRatio, r.fireRatio, r.healthRatio, r.educationRatio, r.garbageRatio, r.deathCareRatio];
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
        <span style="min-width:45px;text-align:right">Load%</span>
        <span style="min-width:85px;text-align:right">Status</span>
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
                  {item.loadPct >= 0 ? (
                    <span style={{ 'min-width': '45px', 'text-align': 'right', 'font-size': '11px', 'font-weight': '600', color: item.loadPct >= 200 ? UI_COLORS.STATUS_BAD : item.loadPct > 100 ? UI_COLORS.STATUS_WARN : UI_COLORS.STATUS_GOOD }}>
                      {item.loadPct}%
                    </span>
                  ) : (
                    <span style="min-width:45px" />
                  )}
                  <span style={{ 'min-width': '85px', 'font-weight': '600', 'font-size': '11px', color: item.statusColor, 'white-space': 'nowrap', 'text-align': 'right' }}>{item.status}</span>
                </div>
              )}
            </For>
          </>
        )}
      </For>
    </>
  );
}
