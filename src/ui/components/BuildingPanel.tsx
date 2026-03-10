import { Show, For, createSignal } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { CitizenDetail } from './CitizenDetail';
import { ZoneType } from '../../core/grid/types';
import type { SelectedZoneBuilding, SelectedInfraBuilding } from '../../Game';

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

function ZoneBuildingInfo(props: { sel: SelectedZoneBuilding }) {
  const [selectedCitizen, setSelectedCitizen] = createSignal<number | null>(null);

  const bt = () => props.sel.buildingType;
  const tax = () => {
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
        <div class="bp-row">Residents <span>{bt().residents}</span></div>
      </Show>
      <Show when={bt().workers > 0}>
        <div class="bp-row">Workers <span>{bt().workers}</span></div>
      </Show>
      <div class="bp-row">Tax <span>{tax()}</span></div>
      <div class="bp-row">Zone <span>{zoneName()}</span></div>

      <div id="bp-citizen-list">
        <Show when={citizens().residents.length > 0}>
          <div style="font-size:11px;color:#66bb6a;margin-top:4px">Residents ({citizens().residents.length})</div>
          <For each={citizens().residents}>
            {(c) => (
              <div class="bp-citizen" onClick={() => setSelectedCitizen(c.id)}>
                Citizen #{c.id} - Age {c.age} ({c.lifeStage})
              </div>
            )}
          </For>
        </Show>
        <Show when={citizens().workers.length > 0}>
          <div style="font-size:11px;color:#42a5f5;margin-top:4px">Workers ({citizens().workers.length})</div>
          <For each={citizens().workers}>
            {(c) => (
              <div class="bp-citizen" onClick={() => setSelectedCitizen(c.id)}>
                Citizen #{c.id} - Age {c.age} ({c.lifeStage})
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
          </>
        )}
      </Show>
    </div>
  );
}
