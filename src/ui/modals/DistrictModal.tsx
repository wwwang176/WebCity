import { createSignal, createEffect, For, Show } from 'solid-js';
import { getGame } from '../store/gameStore';
import { Modal } from './Modal';

const POLICY_LABELS: Record<string, string> = {
  NO_HEAVY_INDUSTRY: 'No Heavy Industry ($150)',
  ENCOURAGE_RECYCLING: 'Encourage Recycling ($100)',
  HIGH_DENSITY_BAN: 'High Density Ban ($120)',
  ORGANIC_FOOD: 'Organic Food ($80)',
  TOURISM: 'Tourism Promotion ($200)',
};
const POLICY_TYPES = ['NO_HEAVY_INDUSTRY', 'ENCOURAGE_RECYCLING', 'HIGH_DENSITY_BAN', 'ORGANIC_FOOD', 'TOURISM'];

export function DistrictModal(props: { open: boolean; onClose: () => void }) {
  const [version, setVersion] = createSignal(0);

  createEffect(() => {
    if (props.open) setVersion(v => v + 1);
  });

  const districts = () => {
    version();
    return getGame().getState().districts.getAllDistricts();
  };

  const togglePolicy = (districtId: string, policyType: string) => {
    const state = getGame().getState();
    if (state.policies.isPolicyActive(districtId, policyType as any)) {
      state.policies.removePolicy(districtId, policyType as any);
    } else {
      state.policies.applyPolicy(districtId, policyType as any);
    }
    setVersion(v => v + 1);
  };

  return (
    <Modal id="district-modal" title={'\u{1F3F3} District Management'} open={props.open} onClose={props.onClose} style={{ 'min-width': '400px', 'max-width': '480px' }}>
      <Show when={districts().length > 0} fallback={
        <div style="color:#888;text-align:center;padding:12px">No districts created yet.<br />Use the District Paint tool to create one.</div>
      }>
        <For each={districts()}>
          {(d) => {
            const activePolicies = () => new Set(d.policies.filter((p: any) => p.active).map((p: any) => p.type));
            return (
              <div style="background:#1a2233;border-radius:6px;padding:8px 10px;margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                  <strong style="color:#e0e0e0">{d.name}</strong>
                  <span style="color:#888;font-size:11px">{d.cells.size} cells</span>
                </div>
                <div style="font-size:12px;color:#aaa;margin-bottom:4px">Policies:</div>
                <div style="display:flex;flex-wrap:wrap;gap:4px">
                  <For each={POLICY_TYPES}>
                    {(pt) => {
                      const isActive = () => activePolicies().has(pt as any);
                      return (
                        <button
                          onClick={() => togglePolicy(d.id, pt)}
                          style={{
                            'font-size': '11px', padding: '3px 8px', 'border-radius': '4px',
                            border: `1px solid ${isActive() ? '#ab47bc' : '#444'}`,
                            background: isActive() ? '#ab47bc33' : '#222',
                            color: isActive() ? '#ce93d8' : '#777',
                            cursor: 'pointer',
                          }}
                        >
                          {isActive() ? '\u2713 ' : ''}{POLICY_LABELS[pt]}
                        </button>
                      );
                    }}
                  </For>
                </div>
              </div>
            );
          }}
        </For>
      </Show>
    </Modal>
  );
}
