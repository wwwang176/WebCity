import { createSignal, createEffect, For, Show } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { Modal } from './Modal';
import { POLICY_CONFIG, isPolicyImplemented } from '../../core/district/PolicyManager';
import {
  nextPolicyLevel, policyButtonText, policyEffectSummary, districtPolicyTotal,
  districtOfferedPolicies,
} from '../../core/district/PolicyPresentation';
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
// 全城條例不列在這裡 —— 列出來玩家會按，按了沒反應（setPolicyLevel 會擋），
// 那比看不到更糟。它們在 City Ordinances 面板。清單本身在 core，那裡測得到。
const OFFERED_POLICY_TYPES = districtOfferedPolicies();

function retiredLabel(pt: PolicyType): string {
  return `${POLICY_CONFIG[pt]?.name ?? pt} (retired — no effect)`;
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

  const cyclePolicy = (districtId: string, policyType: PolicyType) => {
    const game = getGame();
    const state = game.getState();
    // A retired policy can only ever be REMOVED. Routing it through the normal
    // cycle would re-apply one stored at level 0 — which is how a legacy save
    // could end up with a policy the player could see but never get rid of.
    if (!isPolicyImplemented(policyType)) {
      state.policies.removePolicy(districtId, policyType);
    } else {
      // 按一次進一級，到頂再按回到 0 —— 一顆按鈕就走得完全部等級。
      const next = nextPolicyLevel(
        state.policies.getPolicyLevel(districtId, policyType), policyType);
      state.policies.setPolicyLevel(districtId, policyType, next);
    }
    // A build policy decides whether zoned cells in this district can develop
    // at all, and the overlay says so. Nothing else here can see that change,
    // and a paused game is exactly when a player sits in this modal.
    game.notifyDistrictPolicyChanged();
    setVersion(v => v + 1);
  };

  return (
    <Modal id="district-modal" title={'\u{1F3F3} District Management'} open={props.open} onClose={props.onClose} style={{ 'min-width': '400px', 'max-width': '480px' }}>
      <Show when={districts().length > 0} fallback={
        <div style="color:#888;text-align:center;padding:12px">No districts created yet.<br />Use the District Paint tool to create one.</div>
      }>
        <For each={districts()}>
          {(d) => {
            // version() is read FIRST in both, deliberately.
            //
            // <For each={districts()}> hands back fresh arrays of the SAME
            // District object references, so Solid's mapArray reuses each row
            // and this body never re-runs. d.policies is a plain mutable array
            // and reading it tracks nothing, so these memos had no dependencies
            // at all: removing a retired policy updated the state and the
            // billing, while the button kept its tick, its colour and its
            // enabled state until the modal was closed and reopened.
            const levelOf = (pt: PolicyType) => {
              version();
              gameSignals.tick();
              return (d.policies as { type: PolicyType; level: number }[])
                .find(p => p.type === pt)?.level ?? 0;
            };
            // Offered ∪ whatever this district already carries — the union is
            // what lets a retired policy from an old save be switched off.
            const listedPolicies = () => {
              version();
              const seen = new Set<PolicyType>(OFFERED_POLICY_TYPES);
              for (const p of d.policies as { type: PolicyType }[]) seen.add(p.type);
              return [...seen];
            };
            // The header needs the same treatment for the same reason: the row
            // body never re-runs, so `{d.name}` and `{d.cells.size}` were read
            // once and frozen. Renaming a district, or painting more cells into
            // it, changed nothing on screen until the modal was closed and
            // reopened — and the cell count is the only feedback the paint tool
            // gives.
            // 這幾個 memo 除了本地 version() 之外還要讀 gameSignals.tick():
            // <For> 會重用同一個 District 物件，所以外層 districts() 追蹤全域 tick
            // 對這裡沒有幫助。少了它，玩家一邊開著面板一邊畫分區，格數與費用會
            // 停在舊值，直到切換某條政策或關掉重開。
            const name = () => { version(); gameSignals.tick(); return d.name; };
            const cellCount = () => { version(); gameSignals.tick(); return d.cells.size; };
            const scale = () => ({
              population: getGame().getState().citizens.getPopulation(),
              districtCells: cellCount(),
            });
            // 本區合計。費用跟著格數走，所以把分區畫大一倍這個數字就跳一倍。
            const total = () => Math.round(districtPolicyTotal(
              d.policies as { type: PolicyType; level: number }[], scale()));
            return (
              <div style="background:#1a2233;border-radius:6px;padding:8px 10px;margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                  <strong style="color:#e0e0e0">{name()}</strong>
                  <span style="color:#888;font-size:11px">{cellCount()} cells</span>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
                  <span style="font-size:12px;color:#aaa">Policies:</span>
                  <Show when={total() > 0}>
                    <span style="font-size:11px;color:#ce93d8">本區 ${total()}/期</span>
                  </Show>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:4px">
                  <For each={listedPolicies()}>
                    {(pt) => {
                      const level = () => levelOf(pt);
                      const isActive = () => level() > 0;
                      const retired = () => !isPolicyImplemented(pt);
                      const label = () => retired()
                        ? retiredLabel(pt)
                        : policyButtonText(pt, level(), scale());
                      // A retired policy is only listed at all because this
                      // district carries it, so it is always removable — even
                      // one stored as `active: false`, which the previous
                      // `retired && !isActive` rule left permanently stuck.
                      return (
                        <button
                          onClick={() => cyclePolicy(d.id, pt)}
                          title={retired()
                            ? 'This policy has no effect and is no longer charged. Click to remove it.'
                            : policyEffectSummary(pt, Math.max(1, level()))}
                          aria-label={label()}
                          style={{
                            'font-size': '11px', padding: '3px 8px', 'border-radius': '4px',
                            border: `1px solid ${isActive() ? (retired() ? '#a1887f' : '#ab47bc') : '#444'}`,
                            background: isActive() ? (retired() ? '#a1887f33' : '#ab47bc33') : '#222',
                            color: isActive() ? (retired() ? '#bcaaa4' : '#ce93d8') : '#777',
                            cursor: 'pointer',
                            opacity: retired() ? '0.6' : '1',
                          }}
                        >
                          {label()}
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
