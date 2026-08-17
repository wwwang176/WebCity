import { Show } from 'solid-js';
import { getGame } from '../store/gameStore';
import { citizenName } from '../../core/citizen/CitizenName';
import { citizenWorkLabel } from '../../core/citizen/CitizenPresentation';

export function CitizenDetail(props: { citizenId: number | null }) {
  const citizen = () => {
    const id = props.citizenId;
    if (id == null) return null;
    return getGame().getState().citizens.getCitizen(id) ?? null;
  };

  return (
    <Show when={citizen()}>
      {(c) => (
        <div class="bp-citizen-detail" style={{ display: 'block' }}>
          <div class="cd-name">{citizenName(c().id, getGame().getState().citySeed)} <span style="color:#667a90">#{c().id}</span></div>
          <div class="cd-row">Stage <span>{c().lifeStage}</span></div>
          <div class="cd-row">Education <span>{c().education}</span></div>

          <div class="cd-row">Happiness <span>{c().happiness}</span></div>
          <div class="cd-row">Health <span>{c().health}</span></div>
          <div class="cd-row">Home <span>{c().homeId ?? 'Homeless'}</span></div>
          <div class="cd-row">Work <span>{citizenWorkLabel(c())}</span></div>
        </div>
      )}
    </Show>
  );
}
