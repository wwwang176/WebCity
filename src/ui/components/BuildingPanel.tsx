import { Show, For, createSignal } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { CitizenDetail } from './CitizenDetail';
import { ZoneType } from '../../core/grid/types';

const ZONE_NAMES: Record<number, string> = {
  [ZoneType.RESIDENTIAL_LOW]: 'Residential (Low)',
  [ZoneType.RESIDENTIAL_HIGH]: 'Residential (High)',
  [ZoneType.COMMERCIAL_LOW]: 'Commercial (Low)',
  [ZoneType.COMMERCIAL_HIGH]: 'Commercial (High)',
  [ZoneType.INDUSTRIAL]: 'Industrial',
  [ZoneType.OFFICE]: 'Office',
};

export function BuildingPanel() {
  const [selectedCitizen, setSelectedCitizen] = createSignal<number | null>(null);

  const selected = () => gameSignals.selectedBuilding();

  const bt = () => selected()?.buildingType;
  const tax = () => {
    const b = bt();
    return b ? `$${((b.residents + b.workers) * 0.5).toFixed(0)}/tick` : '';
  };
  const level = () => {
    const b = bt();
    return b ? '\u2605'.repeat(b.level) + '\u2606'.repeat(3 - b.level) : '';
  };
  const zoneName = () => {
    const s = selected();
    return s ? ZONE_NAMES[s.zoneType] ?? 'Unknown' : '';
  };

  const citizens = () => {
    const s = selected();
    if (!s) return { residents: [] as any[], workers: [] as any[] };
    const key = `${s.x},${s.y}`;
    const cm = getGame().getState().citizens;
    return {
      residents: cm.getCitizensByHome(key),
      workers: cm.getCitizensByWorkplace(key),
    };
  };

  return (
    <div id="building-panel" class="g-panel" classList={{ visible: !!selected() }}>
      <Show when={selected()}>
        {(sel) => {
          const b = () => sel().buildingType;
          return (
            <>
              <div class="bp-title">{b().name}</div>
              <div class="bp-row">Level <span>{level()}</span></div>
              <Show when={b().residents > 0}>
                <div class="bp-row">Residents <span>{b().residents}</span></div>
              </Show>
              <Show when={b().workers > 0}>
                <div class="bp-row">Workers <span>{b().workers}</span></div>
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
        }}
      </Show>
    </div>
  );
}
