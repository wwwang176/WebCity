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

    interface SummarySpan { text: string; color?: string }
    const entries: { group: string; items: ServiceEntry[]; summary?: SummarySpan[] }[] = [];

    // helper to build a service entry with loadDetail
    const mkEntry = (icon: string, name: string, coverage: number, label: string, load: number, cap: number, st: { label: string; color: string }, suffix = ''): ServiceEntry => {
      const ld = loadDetail(label, load, cap, suffix);
      return { icon, name, coverage, detail: ld.detail, loadPct: ld.pct, status: st.label, statusColor: st.color };
    };

    // ── Power ──
    const pwrItems: ServiceEntry[] = [];
    const powerPlants = state.power.getPlants();
    const pwrTotalSupply = state.power.getSupply();
    const pwrTotalDemand = state.power.getDemand();
    let pwrSummary: SummarySpan[];
    for (const p of powerPlants) {
      const pLoad = pwrTotalSupply > 0 ? Math.round(pwrTotalDemand * p.output / pwrTotalSupply) : 0;
      const pSt = statusOf(p.output > 0 ? pLoad / p.output : 0);
      pwrItems.push(mkEntry('\u26A1', 'Power Plant', r.poweredRatio, 'Load', pLoad, Math.round(p.output), pSt));
    }
    if (powerPlants.length === 0) {
      pwrSummary = [{ text: 'No power plant' }];
    } else {
      pwrSummary = [{ text: `Power: ${Math.round(pwrTotalDemand)} / ${Math.round(pwrTotalSupply)}` }];
      if (pwrTotalDemand > pwrTotalSupply) {
        pwrSummary.push({ text: ' \u00B7 Shortage', color: UI_COLORS.STATUS_BAD });
      }
    }
    entries.push({ group: 'Power', items: pwrItems, summary: pwrSummary });

    // ── Water ──
    const wtrItems: ServiceEntry[] = [];
    const pumpingStations = state.water.getPlants();
    const wtrTotalSupply = state.water.getSupply();
    const wtrTotalDemand = state.water.getDemand();
    for (const wp of pumpingStations) {
      const wLoad = wtrTotalSupply > 0 ? Math.round(wtrTotalDemand * wp.output / wtrTotalSupply) : 0;
      const wSt = statusOf(wp.output > 0 ? wLoad / wp.output : 0);
      wtrItems.push(mkEntry('\uD83D\uDCA7', 'Water Plant', r.wateredRatio, 'Load', wLoad, Math.round(wp.output), wSt));
    }
    const treatPlants = state.sewage.getTreatmentPlants();
    const sewageProduced = Math.round(state.sewage.getProduced());
    const sewageTotalCap = state.sewage.getTreatmentCapacity();
    const sewageUntreated = state.sewage.getUntreated();
    for (const tp of treatPlants) {
      const tpLoad = sewageTotalCap > 0 ? Math.round(sewageProduced * tp.capacity / sewageTotalCap) : 0;
      const tpSt = statusOf(tp.capacity > 0 ? tpLoad / tp.capacity : 0);
      wtrItems.push(mkEntry('\uD83D\uDCA7', 'Sewage Plant', r.sewageRatio, 'Load', tpLoad, tp.capacity, tpSt));
    }
    const wtrSummary: SummarySpan[] = [];
    if (pumpingStations.length === 0) {
      wtrSummary.push({ text: 'No water plant' });
    } else {
      wtrSummary.push({ text: `Water: ${Math.round(wtrTotalDemand)} / ${Math.round(wtrTotalSupply)}` });
      if (wtrTotalDemand > wtrTotalSupply) {
        wtrSummary.push({ text: ' \u00B7 Shortage', color: UI_COLORS.STATUS_BAD });
      }
    }
    wtrSummary.push({ text: ' | ' });
    if (treatPlants.length === 0) {
      wtrSummary.push({ text: 'No sewage plant' });
      if (sewageProduced > 0) {
        wtrSummary.push({ text: ` \u00B7 ${sewageProduced} sewage`, color: UI_COLORS.STATUS_BAD });
      }
    } else {
      const untreated = sewageUntreated > 0;
      wtrSummary.push({ text: `Sewage: ${sewageProduced} / ${sewageTotalCap} \u00B7 ` });
      wtrSummary.push({ text: untreated ? 'Untreated' : 'Normal', color: untreated ? UI_COLORS.STATUS_WARN : UI_COLORS.STATUS_GOOD });
    }
    entries.push({ group: 'Water', items: wtrItems, summary: wtrSummary });

    // ── Public Safety ──
    const safetyItems: ServiceEntry[] = [];
    let policeLoad = 0, policeCap = 0;
    for (const s of state.police.getStations()) {
      const load = state.police.getStationLoad(s.id);
      policeLoad += load; policeCap += s.capacity;
      safetyItems.push(mkEntry('\uD83D\uDE94', 'Police', r.policeRatio, 'Load', load, s.capacity, statusOf(s.capacity > 0 ? load / s.capacity : 0)));
    }
    if (safetyItems.length === 0) {
      safetyItems.push({ icon: '\uD83D\uDE94', name: 'Police', coverage: r.policeRatio, detail: 'No station', loadPct: -1, status: 'None', statusColor: UI_COLORS.STATUS_BAD });
    }
    let fireLoad = 0, fireCap = 0;
    const activeFires = state.fire.getActiveFires().length;
    for (const s of state.fire.getStations()) {
      const load = state.fire.getStationLoad(s.id);
      fireLoad += load; fireCap += s.capacity;
      safetyItems.push(mkEntry('\uD83D\uDE92', 'Fire', r.fireRatio, 'Load', load, s.capacity, statusOf(s.capacity > 0 ? load / s.capacity : 0)));
    }
    if (!state.fire.getStations().length) {
      safetyItems.push({ icon: '\uD83D\uDE92', name: 'Fire', coverage: r.fireRatio, detail: 'No station', loadPct: -1, status: 'None', statusColor: UI_COLORS.STATUS_BAD });
    }
    const safetySummary: SummarySpan[] = [];
    const policeOver = policeCap > 0 && policeLoad > policeCap;
    safetySummary.push({ text: `Police: ${policeLoad} / ${policeCap}`, color: policeOver ? UI_COLORS.STATUS_WARN : undefined });
    safetySummary.push({ text: ' \u00B7 ' });
    const fireOver = fireCap > 0 && fireLoad > fireCap;
    safetySummary.push({ text: `Fire: ${fireLoad} / ${fireCap}`, color: fireOver ? UI_COLORS.STATUS_WARN : undefined });
    if (activeFires > 0) {
      safetySummary.push({ text: ' \u00B7 ' });
      safetySummary.push({ text: `Active Fires ${activeFires}`, color: UI_COLORS.STATUS_BAD });
    }
    entries.push({ group: 'Public Safety', items: safetyItems, summary: safetySummary });

    // ── Health ──
    const healthItems: ServiceEntry[] = [];
    let healthLoad = 0, healthCap = 0;
    for (const h of state.health.getHospitals()) {
      const load = state.health.getHospitalLoad(h.id);
      healthLoad += load; healthCap += h.capacity;
      healthItems.push(mkEntry('\uD83C\uDFE5', 'Hospital', r.healthRatio, 'Load', load, h.capacity, statusOf(h.capacity > 0 ? load / h.capacity : 0)));
    }
    const healthSummary: SummarySpan[] = [];
    if (healthItems.length === 0) {
      healthSummary.push({ text: 'No hospital' });
    } else {
      const over = healthCap > 0 && healthLoad > healthCap;
      healthSummary.push({ text: `Hospital: ${healthLoad} / ${healthCap}`, color: over ? UI_COLORS.STATUS_WARN : undefined });
    }
    entries.push({ group: 'Health', items: healthItems, summary: healthSummary });

    // ── Education ──
    const schoolLabels: Record<string, string> = { elementary: 'Elementary', highschool: 'High School', university: 'University' };
    const eduItems: ServiceEntry[] = [];
    for (const s of state.education.getSchools()) {
      const enrolled = state.education.getSchoolEnrollment(s.id);
      const demand = state.education.getSchoolDemand(s.id);
      const st = demand > s.capacity ? { label: 'Over capacity', color: UI_COLORS.STATUS_WARN } : statusOf(s.capacity > 0 ? enrolled / s.capacity : 0);
      eduItems.push(mkEntry('\uD83C\uDFEB', schoolLabels[s.type] ?? s.type, r.educationRatio, 'Students', enrolled, s.capacity, st, ` \u00B7 Need ${demand}`));
    }
    const eduSummary: SummarySpan[] = [];
    if (eduItems.length === 0) {
      eduSummary.push({ text: 'No schools' });
    } else {
      const byType: Record<string, { demand: number; capacity: number }> = {};
      for (const s of state.education.getSchools()) {
        const label = schoolLabels[s.type] ?? s.type;
        if (!byType[label]) byType[label] = { demand: 0, capacity: 0 };
        byType[label]!.demand += state.education.getSchoolDemand(s.id);
        byType[label]!.capacity += s.capacity;
      }
      let first = true;
      for (const [label, { demand, capacity }] of Object.entries(byType)) {
        if (!first) eduSummary.push({ text: ' \u00B7 ' });
        first = false;
        const over = demand > capacity;
        eduSummary.push({ text: `${label}: ${demand} / ${capacity}`, color: over ? UI_COLORS.STATUS_WARN : undefined });
      }
    }
    entries.push({ group: 'Education', items: eduItems, summary: eduSummary });

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
    const garbageSummary: SummarySpan[] = [];
    if (garbageFacilities.length === 0) {
      garbageSummary.push({ text: 'No landfill' });
      if (awaitingGarbage > 0) garbageSummary.push({ text: ` \u00B7 ` }, { text: `Awaiting pickup ${awaitingGarbage}`, color: UI_COLORS.STATUS_BAD });
      if (producedWk > 0) garbageSummary.push({ text: ` \u00B7 Produced ${producedWk}/wk` });
    } else {
      if (awaitingGarbage > 0) {
        garbageSummary.push({ text: `Awaiting pickup ${awaitingGarbage}`, color: UI_COLORS.STATUS_BAD });
        garbageSummary.push({ text: ` \u00B7 Produced ${producedWk}/wk \u00B7 Burned ${burnedWk}/wk` });
      } else {
        garbageSummary.push({ text: `Awaiting pickup 0 \u00B7 Produced ${producedWk}/wk \u00B7 Burned ${burnedWk}/wk` });
      }
    }
    entries.push({ group: 'Garbage', items: garbageItems, summary: garbageSummary });

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
    const deathCareSummary: SummarySpan[] = [];
    if (cemeteries.length === 0) {
      deathCareSummary.push({ text: 'No cemetery' });
      if (awaitingPickup > 0) deathCareSummary.push({ text: ` \u00B7 ` }, { text: `Awaiting pickup ${awaitingPickup}`, color: UI_COLORS.STATUS_BAD });
      if (deathsWk > 0) deathCareSummary.push({ text: ` \u00B7 Deaths ${deathsWk}/wk` });
    } else {
      if (awaitingPickup > 0) {
        deathCareSummary.push({ text: `Awaiting pickup ${awaitingPickup}`, color: UI_COLORS.STATUS_BAD });
        deathCareSummary.push({ text: ` \u00B7 Deaths ${deathsWk}/wk \u00B7 Cremated ${crematedWk}/wk` });
      } else {
        deathCareSummary.push({ text: `Awaiting pickup 0 \u00B7 Deaths ${deathsWk}/wk \u00B7 Cremated ${crematedWk}/wk` });
      }
    }
    entries.push({ group: 'Death Care', items: burialItems, summary: deathCareSummary });

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
            <div class="section-title">{group.group}</div>
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
            {group.summary && (
              <div style="padding:4px 0;font-size:11px;color:#667a90">
                <For each={group.summary}>
                  {(span) => <span style={{ color: span.color || 'inherit', 'font-weight': span.color ? '600' : 'normal' }}>{span.text}</span>}
                </For>
              </div>
            )}
          </>
        )}
      </For>
    </>
  );
}
