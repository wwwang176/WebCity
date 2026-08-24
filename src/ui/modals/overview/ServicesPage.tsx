import { For, createMemo } from 'solid-js';
import { hasShortage } from '../../../core/stats/facilityLoad';
import { buildServicesStats, type FacilityStat } from '../../../core/stats/ServiceStats';
import { gameSignals, getGame } from '../../store/gameStore';
import { UI_COLORS } from '../../constants';

/** A short coloured run of text. A line is several of them joined. */
interface SummarySpan { text: string; color?: string }

/** School kinds mapped to their labels. */
const SCHOOL_LABELS: Record<string, string> = {
  elementary: 'Elementary', highschool: 'High School', university: 'University',
};

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

/**
 * A facility with no power or water. Still listed — the player needs to see it
 * — but excluded from the group totals, which are meant to describe capacity
 * the city can actually use.
 */
const OFFLINE = { label: 'Offline', color: UI_COLORS.STATUS_BAD };

export function ServicesPage() {
  const data = createMemo(() => {
    gameSignals.tick();
    // Every number comes from `buildServicesStats`, which the agent API reads too. This only arranges
    // it into the groups, icons and colours on screen (BUG-342: one number recorded in two places
    // parts company).
    const s = buildServicesStats(getGame().getState());
    const by = (name: string) => s.services.find(x => x.service === name)!;

    const entries: { group: string; items: ServiceEntry[]; summary?: SummarySpan[] }[] = [];

    /** One facility row. `suffix` follows the load figures. */
    const row = (
      icon: string, name: string, coverage: number, label: string,
      f: FacilityStat, suffix = '', status?: { label: string; color: string },
    ): ServiceEntry => {
      const ld = loadDetail(label, f.load, f.capacity, suffix);
      const st = status ?? (f.operational
        ? statusOf(f.capacity > 0 ? f.load / f.capacity : 0)
        : OFFLINE);
      return { icon, name, coverage, detail: ld.detail, loadPct: ld.pct, status: st.label, statusColor: st.color };
    };

    /** The row shown when there is no facility of this kind. */
    const none = (icon: string, name: string, coverage: number, text: string): ServiceEntry =>
      ({ icon, name, coverage, detail: text, loadPct: -1, status: 'None', statusColor: UI_COLORS.STATUS_BAD });

    const shortageSpan = (svc: { load: number; capacity: number }): SummarySpan[] =>
      hasShortage(svc.load, svc.capacity) ? [{ text: ' · Shortage', color: UI_COLORS.STATUS_BAD }] : [];

    // ── Power ──
    const power = by('power');
    entries.push({
      group: 'Power',
      items: power.facilities.map(f => row('⚡', 'Power Plant', power.coverage, 'Load', f)),
      summary: power.facilities.length === 0
        ? [{ text: 'No power plant' }]
        : [{ text: `Power: ${Math.round(s.powerDemand)} / ${Math.round(s.powerSupply)}` },
           ...(s.powerDemand > s.powerSupply ? [{ text: ' · Shortage', color: UI_COLORS.STATUS_BAD }] : [])],
    });

    // ── Water, sewage included: one group on screen ──
    const water = by('water');
    const sewage = by('sewage');
    const wtrItems = [
      ...water.facilities.map(f => row('💧', 'Water Plant', water.coverage, 'Load', f)),
      ...sewage.facilities.map(f => row('💧', 'Sewage Plant', sewage.coverage, 'Load', f)),
    ];
    const wtrSummary: SummarySpan[] = [];
    if (water.facilities.length === 0) {
      wtrSummary.push({ text: 'No water plant' });
    } else {
      wtrSummary.push({ text: `Water: ${Math.round(s.waterDemand)} / ${Math.round(s.waterSupply)}` });
      if (s.waterDemand > s.waterSupply) wtrSummary.push({ text: ' · Shortage', color: UI_COLORS.STATUS_BAD });
    }
    wtrSummary.push({ text: ' | ' });
    if (sewage.facilities.length === 0) {
      wtrSummary.push({ text: 'No sewage plant' });
      if (s.sewageProduced > 0) wtrSummary.push({ text: ` · ${s.sewageProduced} sewage`, color: UI_COLORS.STATUS_BAD });
    } else {
      const untreated = s.sewageUntreated > 0;
      wtrSummary.push({ text: `Sewage: ${s.sewageProduced} / ${sewage.capacity} · ` });
      wtrSummary.push({ text: untreated ? 'Untreated' : 'Normal', color: untreated ? UI_COLORS.STATUS_WARN : UI_COLORS.STATUS_GOOD });
    }
    entries.push({ group: 'Water', items: wtrItems, summary: wtrSummary });

    // ── Public Safety ──
    const police = by('police');
    const fire = by('fire');
    const safetyItems = [
      ...(police.facilities.length
        ? police.facilities.map(f => row('🚔', 'Police', police.coverage, 'Load', f))
        : [none('🚔', 'Police', police.coverage, 'No station')]),
      ...(fire.facilities.length
        ? fire.facilities.map(f => row('🚒', 'Fire', fire.coverage, 'Load', f))
        : [none('🚒', 'Fire', fire.coverage, 'No station')]),
    ];
    entries.push({
      group: 'Public Safety',
      items: safetyItems,
      summary: [
        { text: `Police: ${police.load} / ${police.capacity}` }, ...shortageSpan(police),
        { text: ' · ' },
        { text: `Fire: ${fire.load} / ${fire.capacity}` }, ...shortageSpan(fire),
        ...(s.activeFires > 0
          ? [{ text: ' · ' }, { text: `Active Fires ${s.activeFires}`, color: UI_COLORS.STATUS_BAD }]
          : []),
      ],
    });

    // ── Health ──
    const health = by('health');
    entries.push({
      group: 'Health',
      items: health.facilities.map(f => row('🏥', 'Hospital', health.coverage, 'Load', f)),
      summary: health.facilities.length === 0
        ? [{ text: 'No hospital' }]
        : [{ text: `Hospital: ${health.load} / ${health.capacity}` }, ...shortageSpan(health)],
    });

    // ── Education ──
    const education = by('education');
    const eduItems = education.facilities.map(f => row(
      '🏫', SCHOOL_LABELS[f.subtype ?? ''] ?? f.subtype ?? 'School',
      education.coverage, 'Students', f, ` · Need ${f.demand ?? 0}`,
      // More people wanting to enrol than there are seats is under-provision, even where the current
      // enrolment has not filled them.
      !f.operational ? OFFLINE
        : (f.demand ?? 0) > f.capacity ? { label: 'Over capacity', color: UI_COLORS.STATUS_WARN }
        : undefined,
    ));
    const eduSummary: SummarySpan[] = [];
    if (eduItems.length === 0) {
      eduSummary.push({ text: 'No schools' });
    } else {
      const byType: Record<string, { demand: number; capacity: number }> = {};
      for (const f of education.facilities) {
        const label = SCHOOL_LABELS[f.subtype ?? ''] ?? f.subtype ?? 'School';
        if (!byType[label]) byType[label] = { demand: 0, capacity: 0 };
        byType[label]!.demand += f.demand ?? 0;
        if (f.operational) byType[label]!.capacity += f.capacity;
      }
      let first = true;
      for (const [label, { demand, capacity }] of Object.entries(byType)) {
        if (!first) eduSummary.push({ text: ' · ' });
        first = false;
        eduSummary.push({ text: `${label}: ${demand} / ${capacity}` });
        if (demand > capacity) eduSummary.push({ text: ' Shortage', color: UI_COLORS.STATUS_BAD });
      }
    }
    entries.push({ group: 'Education', items: eduItems, summary: eduSummary });

    // ── Garbage ──
    const garbage = by('garbage');
    const garbageSummary: SummarySpan[] = [];
    if (garbage.facilities.length === 0) {
      garbageSummary.push({ text: 'No landfill' });
      if (s.garbageUncollected > 0) {
        garbageSummary.push({ text: ' · ' }, { text: `Awaiting pickup ${s.garbageUncollected}`, color: UI_COLORS.STATUS_BAD });
      }
      if (s.garbageProducedPerWeek > 0) garbageSummary.push({ text: ` · Produced ${s.garbageProducedPerWeek}/wk` });
    } else if (s.garbageUncollected > 0) {
      garbageSummary.push({ text: `Awaiting pickup ${s.garbageUncollected}`, color: UI_COLORS.STATUS_BAD });
      garbageSummary.push({ text: ` · Produced ${s.garbageProducedPerWeek}/wk · Burned ${s.garbageBurnedPerWeek}/wk` });
    } else {
      garbageSummary.push({ text: `Awaiting pickup 0 · Produced ${s.garbageProducedPerWeek}/wk · Burned ${s.garbageBurnedPerWeek}/wk` });
    }
    entries.push({
      group: 'Garbage',
      items: garbage.facilities.map(f => row('🗑', 'Landfill', garbage.coverage, 'Load', f, ` · Burned ${f.burnedPerWeek ?? 0}/wk`)),
      summary: garbageSummary,
    });

    // ── Death Care ──
    const deathCare = by('deathCare');
    const deathSummary: SummarySpan[] = [];
    if (deathCare.facilities.length === 0) {
      deathSummary.push({ text: 'No cemetery' });
      if (s.deathsAwaitingPickup > 0) {
        deathSummary.push({ text: ' · ' }, { text: `Awaiting pickup ${s.deathsAwaitingPickup}`, color: UI_COLORS.STATUS_BAD });
      }
      if (s.deathsPerWeek > 0) deathSummary.push({ text: ` · Deaths ${s.deathsPerWeek}/wk` });
    } else if (s.deathsAwaitingPickup > 0) {
      deathSummary.push({ text: `Awaiting pickup ${s.deathsAwaitingPickup}`, color: UI_COLORS.STATUS_BAD });
      deathSummary.push({ text: ` · Deaths ${s.deathsPerWeek}/wk · Cremated ${s.cremationsPerWeek}/wk` });
    } else {
      deathSummary.push({ text: `Awaiting pickup 0 · Deaths ${s.deathsPerWeek}/wk · Cremated ${s.cremationsPerWeek}/wk` });
    }
    entries.push({
      group: 'Death Care',
      items: deathCare.facilities.map(f => row('⚰', 'Cemetery', deathCare.coverage, 'Bodies', f, ` · Cremated ${f.crematedPerWeek ?? 0}/wk`)),
      summary: deathSummary,
    });

    return { entries, avgCoverage: s.avgCoverage, gaps: s.gaps };
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
