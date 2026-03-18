import { Show } from 'solid-js';
import { getGame } from '../store/gameStore';

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
          <div class="cd-name">Citizen #{c().id}</div>
          <div class="cd-row">Stage <span>{c().lifeStage}</span></div>
          <div class="cd-row">Education <span>{c().education}</span></div>

          <div class="cd-row">Happiness <span>{c().happiness}</span></div>
          <div class="cd-row">Health <span>{c().health}</span></div>
          <div class="cd-row">Home <span>{c().homeId ?? 'Homeless'}</span></div>
          <div class="cd-row">Work <span>{c().workplaceId ?? 'Unemployed'}</span></div>
        </div>
      )}
    </Show>
  );
}
