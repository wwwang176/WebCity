import { Show, For } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { ZoneType, isResidentialZone, isCommercialZone } from '../../core/grid/types';
import type { SelectedZoneBuilding, SelectedInfraBuilding, SelectedTransportStop, ServiceStatus } from '../../Game';
import { UI_COLORS } from '../constants';

const ZONE_NAMES: Record<number, string> = {
  [ZoneType.RESIDENTIAL_LOW]: 'Residential (Low)',
  [ZoneType.RESIDENTIAL_HIGH]: 'Residential (High)',
  [ZoneType.COMMERCIAL_LOW]: 'Commercial (Low)',
  [ZoneType.COMMERCIAL_HIGH]: 'Commercial (High)',
  [ZoneType.INDUSTRIAL]: 'Industrial',
  [ZoneType.OFFICE]: 'Office',
};

const INFRA_ICONS: Record<string, string> = {
  police: '\u{1F6A8}',
  fire: '\u{1F692}',
  hospital: '\u{1F3E5}',
  school: '\u{1F3EB}',
  school_high: '\u{1F3EB}',
  school_univ: '\u{1F393}',
  park: '\u{1F333}',
  garbage: '\u{1F5D1}',
  sewage: '\u{1F4A7}',
  cemetery: '\u26B0',
  power: '\u26A1',
  water: '\u{1F4A7}',
  airport_s: '\u2708',
  airport_m: '\u2708',
  airport_l: '\u2708',
};

const TRANSPORT_ICONS: Record<string, string> = {
  bus: '\u{1F68C}',
  metro: '\u{1F687}',
  rail: '\u{1F686}',
  ferry: '\u26F4',
};

const SERVICE_LABELS_ALL: { key: keyof ServiceStatus; label: string }[] = [
  { key: 'power', label: 'Power' },
  { key: 'water', label: 'Water' },
  { key: 'police', label: 'Police' },
  { key: 'fire', label: 'Fire' },
  { key: 'health', label: 'Health' },
  { key: 'education', label: 'Education' },
  { key: 'garbage', label: 'Garbage' },
  { key: 'deathCare', label: 'Death Care' },
];

/** Non-residential zones only need infrastructure & safety services */
const SERVICE_LABELS_NON_RES: { key: keyof ServiceStatus; label: string }[] = [
  { key: 'power', label: 'Power' },
  { key: 'water', label: 'Water' },
  { key: 'police', label: 'Police' },
  { key: 'fire', label: 'Fire' },
];

/** Map cost ratio (-1=none, 0=best, 1=worst) to a dot color. */
function ratioColor(ratio: number): string {
  if (ratio < 0) return '#616161'; // grey — no coverage
  const r = Math.min(1, ratio);
  if (r <= 0.5) {
    const t = r * 2;
    const red = Math.round(255 * t);
    return `rgb(${red},200,50)`;
  }
  const t = (r - 0.5) * 2;
  const green = Math.round(200 * (1 - t));
  return `rgb(255,${green},50)`;
}

function ServiceCoverage(props: { services: ServiceStatus; isResidential: boolean }) {
  const labels = () => props.isResidential ? SERVICE_LABELS_ALL : SERVICE_LABELS_NON_RES;
  return (
    <div style="margin-top:4px">
      <div style="font-size:11px;color:#90a4ae;margin-bottom:2px">Services</div>
      <For each={labels()}>
        {(s) => {
          const r = () => props.services[s.key];
          return (
            <div class="bp-row">
              {s.label}
              <span
                style={`display:inline-block;width:8px;height:8px;border-radius:50%;background:${ratioColor(r())}`}
              />
            </div>
          );
        }}
      </For>
    </div>
  );
}

const WARNING_STYLE_YELLOW = {
  'margin-top': '4px', padding: '4px 8px', 'border-radius': '4px',
  background: 'rgba(255,152,0,0.15)', color: '#ff9800',
  'font-size': '11px', 'font-weight': '600',
} as const;

const WARNING_STYLE_RED = {
  'margin-top': '4px', padding: '4px 8px', 'border-radius': '4px',
  background: 'rgba(239,83,80,0.15)', color: UI_COLORS.STATUS_BAD,
  'font-size': '11px', 'font-weight': '600',
} as const;

type WarnLevel = 'red' | 'yellow';
interface Warning { level: WarnLevel; text: string }

function collectWarnings(sel: SelectedZoneBuilding): Warning[] {
  const warnings: Warning[] = [];

  // Freight warnings always show (not gated by abandonment stress)
  if (isCommercialZone(sel.zoneType) && sel.freightRatio != null) {
    if (sel.freightRatio === 0) {
      warnings.push({ level: 'red', text: 'No goods to sell' });
    } else if (sel.freightRatio < 1) {
      const label = sel.freightSource === 'imported' ? 'Importing goods' : 'Partially supplied';
      warnings.push({ level: sel.freightRatio < 0.5 ? 'red' : 'yellow', text: label });
    } else if (sel.freightSource === 'imported') {
      warnings.push({ level: 'yellow', text: 'Importing goods' });
    }
  }
  if (sel.zoneType === ZoneType.INDUSTRIAL) {
    if (sel.freightExporting) {
      warnings.push({ level: 'yellow', text: 'Exporting goods' });
    } else if ((sel.freightSurplusRatio ?? 0) > 0.5) {
      warnings.push({ level: sel.freightSurplusRatio! > 0.8 ? 'red' : 'yellow', text: 'Goods not selling' });
    }
  }

  // Shopping access warnings (always show)
  if (isCommercialZone(sel.zoneType) && sel.hasCustomers != null) {
    if (!sel.hasCustomers) {
      warnings.push({ level: 'red', text: 'No consumers nearby' });
    } else if (sel.customerRatio != null && sel.customerRatio < 0.3) {
      warnings.push({ level: 'yellow', text: 'Needs more residents' });
    }
  }
  if (isResidentialZone(sel.zoneType) && sel.shoppingAccess != null) {
    if (!sel.shoppingAccess) {
      warnings.push({ level: 'red', text: 'No shops nearby' });
    } else if (sel.shoppingRatio != null && sel.shoppingRatio < 0.3) {
      warnings.push({ level: 'yellow', text: 'Needs more shops' });
    }
  }

  // Labor shortage — always show (non-residential only)
  if (!isResidentialZone(sel.zoneType) && sel.workerCapacity > 0) {
    if (sel.workerCount === 0) warnings.push({ level: 'red', text: 'No workers' });
    else if (sel.workerCount < sel.workerCapacity * 0.5) warnings.push({ level: 'yellow', text: 'Labor shortage' });
  }

  // Pollution by type — always show (industrial immune)
  if (sel.zoneType !== ZoneType.INDUSTRIAL) {
    const types: [number, string][] = [
      [sel.pollutionGround, 'Ground pollution'],
      [sel.pollutionWater, 'Water pollution'],
      [sel.pollutionNoise, 'Noise pollution'],
    ];
    for (const [val, label] of types) {
      if (val > 70) warnings.push({ level: 'red', text: label });
      else if (val > 40) warnings.push({ level: 'yellow', text: label });
    }
  }

  // Abandonment stress — always show
  if (!sel.isAbandoned) {
    if (sel.abandonmentStress > 70) warnings.push({ level: 'red', text: 'Near abandonment' });
    else if (sel.abandonmentStress > 40) warnings.push({ level: 'yellow', text: 'Under stress' });
  }

  // Tax — only when building is under stress
  if (!sel.isAbandoned && sel.abandonmentStress > 0) {
    const game = getGame();
    const isRes = sel.zoneType === ZoneType.RESIDENTIAL_LOW || sel.zoneType === ZoneType.RESIDENTIAL_HIGH;
    const taxRate = isRes ? game.getState().taxRates.residential : game.getState().taxRates.business;
    const over = taxRate - (isRes ? 12 : 9);

    if (over >= 8) warnings.push({ level: 'red', text: 'Tax rate unbearable' });
    else if (over >= 4) warnings.push({ level: 'red', text: 'Tax rate too high' });
    else if (over > 0) warnings.push({ level: 'yellow', text: 'Tax rate slightly high' });
  }

  // Garbage load — covered but service overloaded (always show)
  if (sel.garbageLoadRatio > 1) {
    warnings.push({ level: 'red', text: 'Garbage overflow' });
  } else if (sel.garbageLoadRatio > 0.5) {
    warnings.push({ level: 'yellow', text: 'Garbage piling up' });
  }

  // Hospital overloaded — covered but death rate not reduced (always show)
  if (sel.hospitalLoadRatio > 2) {
    warnings.push({ level: 'red', text: 'Hospital overloaded' });
  } else if (sel.hospitalLoadRatio > 1) {
    warnings.push({ level: 'yellow', text: 'Hospital over capacity' });
  }

  // Police overloaded — crime reduction diminished (always show)
  if (sel.policeLoadRatio > 2) {
    warnings.push({ level: 'red', text: 'Police overstretched' });
  } else if (sel.policeLoadRatio > 1) {
    warnings.push({ level: 'yellow', text: 'Police over capacity' });
  }

  // Fire overloaded — fire damage increased (always show)
  if (sel.fireLoadRatio > 2) {
    warnings.push({ level: 'red', text: 'Fire dept overstretched' });
  } else if (sel.fireLoadRatio > 1) {
    warnings.push({ level: 'yellow', text: 'Fire dept over capacity' });
  }

  // Sort: red first, then yellow
  warnings.sort((a, b) => (a.level === 'red' ? 0 : 1) - (b.level === 'red' ? 0 : 1));
  return warnings;
}

function AbandonmentWarnings(props: { sel: SelectedZoneBuilding }) {
  const warnings = () => collectWarnings(props.sel);

  return (
    <For each={warnings()}>
      {(w) => <div style={w.level === 'red' ? WARNING_STYLE_RED : WARNING_STYLE_YELLOW}>{w.text}</div>}
    </For>
  );
}

function ZoneBuildingInfo(props: { sel: SelectedZoneBuilding }) {
  const setSelectedCitizen = gameSignals.setSelectedCitizenId;

  const bt = () => props.sel.buildingType;
  const hasPower = () => props.sel.services.power >= 0;
  const hasWater = () => props.sel.services.water >= 0;
  const tax = () => `$${props.sel.taxIncome.toFixed(1)}/tick`;
  const level = () => {
    const b = bt();
    return '\u2605'.repeat(b.level) + '\u2606'.repeat(3 - b.level);
  };
  const landStars = () => {
    const v = props.sel.landValue;
    const stars = v > 200 ? 5 : v > 150 ? 4 : v > 100 ? 3 : v > 50 ? 2 : 1;
    return '\u2605'.repeat(stars) + '\u2606'.repeat(5 - stars);
  };
  const zoneName = () => ZONE_NAMES[props.sel.zoneType] ?? 'Unknown';

  const citizens = () => {
    const key = `${props.sel.x},${props.sel.y}`;
    const cm = getGame().getState().citizens;
    return {
      residents: cm.getCitizensByHome(key),
      workers: cm.getCitizensByWorkplace(key),
    };
  };

  return (
    <>
      <div class="bp-title">{bt().name}</div>
      <div class="bp-row">Level <span>{level()}</span></div>
      <div class="bp-row">Land <span>{landStars()}</span></div>
      <Show when={bt().residents > 0}>
        <div class="bp-row">Residents <span>{citizens().residents.length}/{bt().residents}</span></div>
      </Show>
      <Show when={bt().workers > 0}>
        <div class="bp-row">Workers <span>{citizens().workers.length}/{bt().workers}</span></div>
      </Show>
      <div class="bp-row">Tax <span>{tax()}</span></div>
      <div class="bp-row">Zone <span>{zoneName()}</span></div>
      <Show when={!hasPower()}>
        <div style={{
          'margin-top': '4px', padding: '4px 8px', 'border-radius': '4px',
          background: 'rgba(239,83,80,0.15)', color: UI_COLORS.STATUS_BAD,
          'font-size': '11px', 'font-weight': '600',
        }}>
          No Power - No income
        </div>
      </Show>
      <Show when={!hasWater()}>
        <div style={{
          'margin-top': '4px', padding: '4px 8px', 'border-radius': '4px',
          background: 'rgba(239,83,80,0.15)', color: UI_COLORS.STATUS_BAD,
          'font-size': '11px', 'font-weight': '600',
        }}>
          No Water
        </div>
      </Show>
      <Show when={props.sel.isAbandoned}>
        <div style={{
          'margin-top': '4px', padding: '4px 8px', 'border-radius': '4px',
          background: 'rgba(239,83,80,0.2)', color: UI_COLORS.STATUS_BAD,
          'font-size': '11px', 'font-weight': '700',
        }}>
          ABANDONED
        </div>
      </Show>
      <AbandonmentWarnings sel={props.sel} />
      <ServiceCoverage services={props.sel.services} isResidential={props.sel.zoneType === ZoneType.RESIDENTIAL_LOW || props.sel.zoneType === ZoneType.RESIDENTIAL_HIGH} />

      <div id="bp-citizen-list">
        <Show when={citizens().residents.length > 0}>
          <div style={`font-size:11px;color:${UI_COLORS.STATUS_GOOD};margin-top:4px`}>Residents ({citizens().residents.length})</div>
          <For each={citizens().residents}>
            {(c) => (
              <div class="bp-citizen" onClick={() => setSelectedCitizen(c.id)}>
                Citizen #{c.id} - {c.lifeStage}
              </div>
            )}
          </For>
        </Show>
        <Show when={citizens().workers.length > 0}>
          <div style={`font-size:11px;color:${UI_COLORS.ACCENT};margin-top:4px`}>Workers ({citizens().workers.length})</div>
          <For each={citizens().workers}>
            {(c) => (
              <div class="bp-citizen" onClick={() => setSelectedCitizen(c.id)}>
                Citizen #{c.id} - {c.lifeStage}
              </div>
            )}
          </For>
        </Show>
      </div>

    </>
  );
}

function UtilityStatus(props: { hasPower: boolean; hasWater: boolean }) {
  return (
    <div style="margin-top:4px">
      <div class="bp-row">
        Power
        <span style={`display:inline-block;width:8px;height:8px;border-radius:50%;background:${props.hasPower ? '#4caf50' : '#ef5350'}`} />
      </div>
      <div class="bp-row">
        Water
        <span style={`display:inline-block;width:8px;height:8px;border-radius:50%;background:${props.hasWater ? '#4caf50' : '#ef5350'}`} />
      </div>
      <Show when={!props.hasPower || !props.hasWater}>
        <div style={{
          'margin-top': '4px', padding: '4px 8px', 'border-radius': '4px',
          background: 'rgba(239,83,80,0.15)', color: UI_COLORS.STATUS_BAD,
          'font-size': '11px', 'font-weight': '600',
        }}>
          {!props.hasPower && !props.hasWater ? 'No Power / No Water — Offline' : !props.hasPower ? 'No Power — Offline' : 'No Water — Offline'}
        </div>
      </Show>
    </div>
  );
}

/** Overload warning for Need/Capacity services */
function OverloadWarning(props: { need: number; capacity: number }) {
  const level = (): WarnLevel | null => {
    if (props.capacity <= 0 || props.need <= props.capacity) return null;
    return props.need >= props.capacity * 2 ? 'red' : 'yellow';
  };
  return (
    <Show when={level()}>
      {(l) => <div style={l() === 'red' ? WARNING_STYLE_RED : WARNING_STYLE_YELLOW}>Overloaded</div>}
    </Show>
  );
}

/** Shared header: icon + name + cost + utility status */
function InfraHeader(props: { sel: SelectedInfraBuilding }) {
  const icon = () => INFRA_ICONS[props.sel.infraType] ?? '';
  return (
    <>
      <div class="bp-title">{icon()} {props.sel.name}</div>
      <div class="bp-row">Cost <span>${props.sel.cost}</span></div>
    </>
  );
}

function InfraFooter(props: { sel: SelectedInfraBuilding }) {
  return <UtilityStatus hasPower={props.sel.hasPower} hasWater={props.sel.hasWater} />;
}

/** Police / Fire / Hospital / Sewage: Need + Capacity + Radius */
function NeedCapacityPanel(props: { sel: SelectedInfraBuilding }) {
  const d = () => props.sel.details;
  return (
    <>
      <InfraHeader sel={props.sel} />
      <div class="bp-row">Need <span>{d().Need}</span></div>
      <div class="bp-row">Capacity <span>{d().Capacity}</span></div>
      <Show when={d().Radius}><div class="bp-row">Radius <span>{d().Radius}</span></div></Show>
      <Show when={d()['Active Fires'] != null}><div class="bp-row">Active Fires <span>{d()['Active Fires']}</span></div></Show>
      <InfraFooter sel={props.sel} />
      <OverloadWarning need={d().Need as number ?? 0} capacity={d().Capacity as number ?? 0} />
    </>
  );
}

/** School: Type + Need + Capacity + Students + Radius */
function SchoolPanel(props: { sel: SelectedInfraBuilding }) {
  const d = () => props.sel.details;
  return (
    <>
      <InfraHeader sel={props.sel} />
      <div class="bp-row">Type <span>{d().Type}</span></div>
      <div class="bp-row">Need <span>{d().Need}</span></div>
      <div class="bp-row">Students <span>{d().Students}</span></div>
      <div class="bp-row">Radius <span>{d().Radius}</span></div>
      <InfraFooter sel={props.sel} />
      <OverloadWarning need={d().Need as number ?? 0} capacity={d().Capacity as number ?? 0} />
    </>
  );
}

/** Garbage: Load + Produced/Burned per week + Overflow */
function GarbagePanel(props: { sel: SelectedInfraBuilding }) {
  const d = () => props.sel.details;
  const hasOverflow = () => d().Overflow != null && (d().Overflow as number) > 0;
  return (
    <>
      <InfraHeader sel={props.sel} />
      <div class="bp-row">Load <span>{d().Load}</span></div>
      <div class="bp-row">Produced/wk <span>{d()['Produced/wk']}</span></div>
      <div class="bp-row">Burned/wk <span>{d()['Burned/wk']}</span></div>
      <InfraFooter sel={props.sel} />
      <Show when={hasOverflow()}>
        <div style={WARNING_STYLE_RED}>{d().Overflow} garbage uncollected</div>
      </Show>
    </>
  );
}

/** Cemetery: Bodies + Deaths/Cremated per week */
function CemeteryPanel(props: { sel: SelectedInfraBuilding }) {
  const d = () => props.sel.details;
  return (
    <>
      <InfraHeader sel={props.sel} />
      <div class="bp-row">Bodies <span>{d().Bodies}</span></div>
      <div class="bp-row">Deaths/wk <span>{d()['Deaths/wk']}</span></div>
      <div class="bp-row">Cremated/wk <span>{d()['Cremated/wk']}</span></div>
      <InfraFooter sel={props.sel} />
    </>
  );
}

/** Power / Water: Output + Supply/Demand */
function UtilityPlantPanel(props: { sel: SelectedInfraBuilding }) {
  const d = () => props.sel.details;
  return (
    <>
      <InfraHeader sel={props.sel} />
      <For each={Object.entries(d())}>
        {([key, value]) => <div class="bp-row">{key} <span>{value}</span></div>}
      </For>
      <InfraFooter sel={props.sel} />
    </>
  );
}

/** Park: Radius only */
function ParkPanel(props: { sel: SelectedInfraBuilding }) {
  const d = () => props.sel.details;
  return (
    <>
      <InfraHeader sel={props.sel} />
      <div class="bp-row">Radius <span>{d().Radius}</span></div>
      <InfraFooter sel={props.sel} />
    </>
  );
}

/** Dispatch to per-type infra panel */
function InfraBuildingInfo(props: { sel: SelectedInfraBuilding }) {
  const type = () => props.sel.infraType;
  return (
    <>
      <Show when={type() === 'police' || type() === 'fire' || type() === 'hospital' || type() === 'sewage'}>
        <NeedCapacityPanel sel={props.sel} />
      </Show>
      <Show when={type() === 'school' || type() === 'school_high' || type() === 'school_univ'}>
        <SchoolPanel sel={props.sel} />
      </Show>
      <Show when={type() === 'garbage'}>
        <GarbagePanel sel={props.sel} />
      </Show>
      <Show when={type() === 'cemetery'}>
        <CemeteryPanel sel={props.sel} />
      </Show>
      <Show when={type() === 'power' || type() === 'water'}>
        <UtilityPlantPanel sel={props.sel} />
      </Show>
      <Show when={type() === 'park'}>
        <ParkPanel sel={props.sel} />
      </Show>
      <Show when={type()?.startsWith('airport')}>
        <UtilityPlantPanel sel={props.sel} />
      </Show>
    </>
  );
}

function TransportStopInfo(props: { sel: SelectedTransportStop }) {
  const icon = () => TRANSPORT_ICONS[props.sel.transportType] ?? '';

  return (
    <>
      <div class="bp-title">{icon()} {props.sel.name}</div>
      <div class="bp-row">Position <span>({props.sel.x}, {props.sel.y})</span></div>
      <div class="bp-row">Routes <span>{props.sel.routes}</span></div>
      <div class="bp-row">Vehicles <span>{props.sel.vehicles}</span></div>
      <div class="bp-row">Riders/Week <span>{Math.round(props.sel.ridersPerDay * 7)}</span></div>
      <UtilityStatus hasPower={props.sel.hasPower} hasWater={props.sel.hasWater} />
    </>
  );
}

export function BuildingPanel(props: { panelOrder?: number }) {
  // Identity: only changes on selection change (instant)
  const hasSelection = () => gameSignals.selectedBuilding() !== null;

  // Live data: refreshes on tick (~6/sec, throttled)
  const liveData = () => {
    gameSignals.tick();
    if (!hasSelection()) return null;
    return getGame().getSelectedBuilding();
  };

  return (
    <div id="building-panel" class="g-panel" classList={{ visible: hasSelection() }} style={{ order: props.panelOrder ?? 0 }}>
      <Show when={liveData()}>
        {(sel) => (
          <>
            <Show when={sel().kind === 'zone'}>
              <ZoneBuildingInfo sel={sel() as SelectedZoneBuilding} />
            </Show>
            <Show when={sel().kind === 'infra'}>
              <InfraBuildingInfo sel={sel() as SelectedInfraBuilding} />
            </Show>
            <Show when={sel().kind === 'transport'}>
              <TransportStopInfo sel={sel() as SelectedTransportStop} />
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
