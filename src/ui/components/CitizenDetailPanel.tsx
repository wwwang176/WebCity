import { Show } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';

import { STAGE_NAMES, EDU_NAMES } from './citizenLabels';

export function CitizenDetailPanel(props: { panelOrder?: number }) {
  const citizenId = () => gameSignals.selectedCitizenId();
  const visible = () => citizenId() !== null;

  const citizen = () => {
    gameSignals.tick();
    const id = citizenId();
    if (id == null) return null;
    return getGame().getState().citizens.getCitizen(id) ?? null;
  };

  const close = () => {
    gameSignals.setSelectedCitizenId(null);
  };

  return (
    <Show when={visible()}>
      <div id="citizen-detail-panel" class="g-panel visible" style={{ order: props.panelOrder ?? 0 }}>
        <div class="g-panel-header">
          <span class="g-panel-title">Citizen #{citizenId()}</span>
          <button
            style={{
              background: 'none', border: 'none', color: '#667a90', cursor: 'pointer',
              'font-size': '14px', padding: '0 2px', 'line-height': '1',
            }}
            onClick={close}
          >&times;</button>
        </div>
        <Show when={citizen()}>
          {(c) => (
            <>
              <div class="bp-row">Stage <span>{STAGE_NAMES[c().lifeStage] ?? c().lifeStage}</span></div>
              <div class="bp-row">Education <span>{EDU_NAMES[c().education] ?? c().education}</span></div>
              <div class="bp-row">Happiness <span>{c().happiness}</span></div>
              <div class="bp-row">Health <span>{c().health}</span></div>
              <div class="bp-row">Home <span>{c().homeId ?? 'Homeless'}</span></div>
              <div class="bp-row">Work <span>{c().workplaceId ?? 'Unemployed'}</span></div>
            </>
          )}
        </Show>
      </div>
    </Show>
  );
}
