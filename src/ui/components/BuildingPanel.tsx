import { Show, For, createSignal } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { CitizenDetail } from './CitizenDetail';
import { ZoneType } from '../../core/grid/types';
import type { SelectedZoneBuilding, SelectedInfraBuilding, SelectedTransportStop, ServiceStatus } from '../../Game';

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
  airport: '\u2708',
};

const TRANSPORT_ICONS: Record<string, string> = {
  bus: '\u{1F68C}',
  metro: '\u{1F687}',
  rail: '\u{1F686}',
  ferry: '\u26F4',
};

const SERVICE_LABELS: { key: keyof ServiceStatus; label: string }[] = [
  { key: 'power', label: 'Power' },
  { key: 'water', label: 'Water' },
  { key: 'police', label: 'Police' },
  { key: 'fire', label: 'Fire' },
  { key: 'health', label: 'Health' },
  { key: 'education', label: 'Education' },
  { key: 'garbage', label: 'Garbage' },
  { key: 'deathCare', label: 'Death Care' },
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

function ServiceCoverage(props: { services: ServiceStatus }) {
  return (
    <div style="margin-top:4px">
      <div style="font-size:11px;color:#90a4ae;margin-bottom:2px">Services</div>
      <For each={SERVICE_LABELS}>
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
  background: 'rgba(239,83,80,0.15)', color: '#ef5350',
  'font-size': '11px', 'font-weight': '600',
} as const;

type WarnLevel = 'red' | 'yellow';
interface Warning { level: WarnLevel; text: string }

function collectWarnings(sel: SelectedZoneBuilding): Warning[] {
  if (sel.isAbandoned || sel.abandonmentStress <= 0) return [];

  const warnings: Warning[] = [];
  const game = getGame();
  const isRes = sel.zoneType === ZoneType.RESIDENTIAL_LOW || sel.zoneType === ZoneType.RESIDENTIAL_HIGH;
  const taxRate = isRes ? game.getState().taxRates.residential : game.getState().taxRates.business;
  const over = taxRate - (isRes ? 12 : 9);

  // Tax
  if (over >= 8) warnings.push({ level: 'red', text: 'Tax rate unbearable' });
  else if (over >= 4) warnings.push({ level: 'red', text: 'Tax rate too high' });
  else if (over > 0) warnings.push({ level: 'yellow', text: 'Tax rate slightly high' });

  // Pollution (industrial immune)
  if (sel.pollution > 70 && sel.zoneType !== ZoneType.INDUSTRIAL) {
    warnings.push({ level: 'red', text: 'Severe pollution' });
  } else if (sel.pollution > 40 && sel.zoneType !== ZoneType.INDUSTRIAL) {
    warnings.push({ level: 'yellow', text: 'High pollution' });
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
  const [selectedCitizen, setSelectedCitizen] = createSignal<number | null>(null);

  const bt = () => props.sel.buildingType;
  const hasPower = () => props.sel.services.power >= 0;
  const hasWater = () => props.sel.services.water >= 0;
  const tax = () => {
    if (!hasPower()) return '$0/tick';
    const b = bt();
    return `$${((b.residents + b.workers) * 0.5).toFixed(0)}/tick`;
  };
  const level = () => {
    const b = bt();
    return '\u2605'.repeat(b.level) + '\u2606'.repeat(3 - b.level);
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
          background: 'rgba(239,83,80,0.15)', color: '#ef5350',
          'font-size': '11px', 'font-weight': '600',
        }}>
          No Power - No income
        </div>
      </Show>
      <Show when={!hasWater()}>
        <div style={{
          'margin-top': '4px', padding: '4px 8px', 'border-radius': '4px',
          background: 'rgba(239,83,80,0.15)', color: '#ef5350',
          'font-size': '11px', 'font-weight': '600',
        }}>
          No Water
        </div>
      </Show>
      <Show when={props.sel.isAbandoned}>
        <div style={{
          'margin-top': '4px', padding: '4px 8px', 'border-radius': '4px',
          background: 'rgba(239,83,80,0.2)', color: '#ef5350',
          'font-size': '11px', 'font-weight': '700',
        }}>
          ABANDONED
        </div>
      </Show>
      <AbandonmentWarnings sel={props.sel} />
      <ServiceCoverage services={props.sel.services} />

      <div id="bp-citizen-list">
        <Show when={citizens().residents.length > 0}>
          <div style="font-size:11px;color:#66bb6a;margin-top:4px">Residents ({citizens().residents.length})</div>
          <For each={citizens().residents}>
            {(c) => (
              <div class="bp-citizen" onClick={() => setSelectedCitizen(c.id)}>
                Citizen #{c.id} - {c.lifeStage}
              </div>
            )}
          </For>
        </Show>
        <Show when={citizens().workers.length > 0}>
          <div style="font-size:11px;color:#42a5f5;margin-top:4px">Workers ({citizens().workers.length})</div>
          <For each={citizens().workers}>
            {(c) => (
              <div class="bp-citizen" onClick={() => setSelectedCitizen(c.id)}>
                Citizen #{c.id} - {c.lifeStage}
              </div>
            )}
          </For>
        </Show>
      </div>

      <Show when={selectedCitizen() !== null}>
        <CitizenDetail citizenId={selectedCitizen()} />
      </Show>
    </>
  );
}

function InfraBuildingInfo(props: { sel: SelectedInfraBuilding }) {
  const icon = () => INFRA_ICONS[props.sel.infraType] ?? '';
  const details = () => Object.entries(props.sel.details);

  return (
    <>
      <div class="bp-title">{icon()} {props.sel.name}</div>
      <div class="bp-row">Cost <span>${props.sel.cost}</span></div>
      <For each={details()}>
        {([key, value]) => (
          <div class="bp-row">{key} <span>{value}</span></div>
        )}
      </For>
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
    </>
  );
}

export function BuildingPanel() {
  const selected = () => gameSignals.selectedBuilding();

  return (
    <div id="building-panel" class="g-panel" classList={{ visible: !!selected() }}>
      <Show when={selected()}>
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
