import { createSignal, createEffect, For, Show } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { Modal } from './Modal';
import { POLICY_CONFIG, IMPLEMENTED_POLICY_TYPES, isPolicyImplemented } from '../../core/district/PolicyManager';
import type { PolicyType } from '../../core/district/types';

/**
 * Only the policies the simulation reads are OFFERED — but any policy a
 * district already carries is still LISTED, so an old save's leftovers can be
 * turned off.
 *
 * ENCOURAGE_RECYCLING, ORGANIC_FOOD and TOURISM appear nowhere in the
 * simulation; listing them with a price tag charged the player $380 per budget
 * cycle for no effect at all (BUG-091). Dropping them from the modal outright
 * left a save that had one enabled with a policy object the player could no
 * longer see or remove — and one that would start taking effect silently the
 * day the mechanic is implemented.
 *
 * Both lists are derived: the hand-written POLICY_TYPES / POLICY_LABELS pair
 * was the third and fourth copy of data POLICY_CONFIG already holds.
 */
const OFFERED_POLICY_TYPES = [...IMPLEMENTED_POLICY_TYPES];

function policyLabel(pt: PolicyType): string {
  const cfg = POLICY_CONFIG[pt];
  if (!cfg) return pt;
  return isPolicyImplemented(pt)
    ? `${cfg.name} ($${cfg.cost})`
    : `${cfg.name} (retired — no effect)`;
}

export function DistrictModal(props: { open: boolean; onClose: () => void }) {
  const [version, setVersion] = createSignal(0);

  createEffect(() => {
    if (props.open) setVersion(v => v + 1);
  });

  const districts = () => {
    version();
    gameSignals.tick(); // reactive: throttled live-refresh
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
            // Offered ∪ whatever this district already carries — the union is
            // what lets a retired policy from an old save be switched off.
            const listedPolicies = () => {
              const seen = new Set<PolicyType>(OFFERED_POLICY_TYPES);
              for (const p of d.policies as { type: PolicyType }[]) seen.add(p.type);
              return [...seen];
            };
            return (
              <div style="background:#1a2233;border-radius:6px;padding:8px 10px;margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                  <strong style="color:#e0e0e0">{d.name}</strong>
                  <span style="color:#888;font-size:11px">{d.cells.size} cells</span>
                </div>
                <div style="font-size:12px;color:#aaa;margin-bottom:4px">Policies:</div>
                <div style="display:flex;flex-wrap:wrap;gap:4px">
                  <For each={listedPolicies()}>
                    {(pt) => {
                      const isActive = () => activePolicies().has(pt as any);
                      const retired = () => !isPolicyImplemented(pt);
                      // A retired policy can only be turned OFF, never back on.
                      const disabled = () => retired() && !isActive();
                      return (
                        <button
                          onClick={() => { if (!disabled()) togglePolicy(d.id, pt); }}
                          disabled={disabled()}
                          title={retired() ? 'This policy has no effect and is no longer charged.' : undefined}
                          aria-label={policyLabel(pt)}
                          style={{
                            'font-size': '11px', padding: '3px 8px', 'border-radius': '4px',
                            border: `1px solid ${isActive() ? (retired() ? '#a1887f' : '#ab47bc') : '#444'}`,
                            background: isActive() ? (retired() ? '#a1887f33' : '#ab47bc33') : '#222',
                            color: isActive() ? (retired() ? '#bcaaa4' : '#ce93d8') : '#777',
                            cursor: disabled() ? 'default' : 'pointer',
                            opacity: disabled() ? '0.5' : '1',
                          }}
                        >
                          {isActive() ? '\u2713 ' : ''}{policyLabel(pt)}
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
