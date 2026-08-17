import { createSignal, createEffect, For, Show } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { Modal } from './Modal';
import { POLICY_CONFIG, maxLevel } from '../../core/district/PolicyManager';
import { policyEffectSummary, policiesByCategory } from '../../core/district/PolicyPresentation';
import { policyCost } from '../../core/district/PolicyBilling';
import { PolicyType } from '../../core/district/types';

/**
 * 全城條例。
 *
 * 跟分區條例分開一個面板，是因為它們回答的是不同的問題:分區問「在哪裡」，全城問
 * 「要不要、多強」。把兩者混在一起，玩家會以為全城條例也需要先畫一塊地。
 *
 * 效果與代價寫在名稱底下同一列，不是 tooltip —— 取捨是玩法，藏起來就沒有取捨。
 */

// 分類分組在 core，那裡測得到 —— 寫在這裡的話，分錯組不會有任何測試轉紅。
const ORDINANCE_GROUPS = policiesByCategory('city');

/** 三級條例的按鈕標籤。按鈕只有 28px 寬，放得下一個字母。 */
const TIER_LABELS = ['L', 'M', 'H'];
const TIER_NAMES = ['Light', 'Medium', 'Heavy'];

export function CityOrdinanceModal(props: { open: boolean; onClose: () => void }) {
  const [version, setVersion] = createSignal(0);

  createEffect(() => {
    if (props.open) setVersion(v => v + 1);
  });

  const ordinances = () => {
    version();
    gameSignals.tick();
    return getGame().getState().ordinances;
  };
  const population = () => { version(); return getGame().getState().citizens.getPopulation(); };

  const setLevel = (type: PolicyType, level: number) => {
    getGame().getState().ordinances.setLevel(type, level);
    setVersion(v => v + 1);
  };

  const costOf = (type: PolicyType, level: number) =>
    policyCost(type, level, { population: population(), districtCells: 0 });

  const grandTotal = () => Math.round(ordinances().totalCost(population()));

  return (
    <Modal
      id="city-ordinance-modal"
      title={'\u{1F4CB} City Ordinances'}
      open={props.open}
      onClose={props.onClose}
      style={{ 'min-width': '420px', 'max-width': '520px' }}
    >
      <div style="display:flex;justify-content:flex-end;font-size:12px;color:#ce93d8;margin-bottom:8px">
        This cycle: ${grandTotal()}
      </div>
      <For each={ORDINANCE_GROUPS}>
        {(group) => (
          <div style="margin-bottom:10px">
            <div style="font-size:10px;color:#777;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">
              {group.category}
            </div>
      <For each={group.policies}>
        {(type) => {
          const level = () => { version(); return ordinances().getLevel(type); };
          const max = maxLevel(type);
          const cost = () => Math.round(costOf(type, level()));
          return (
            <div style="background:#1a2233;border-radius:6px;padding:8px 10px;margin-bottom:8px">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <strong style="color:#e0e0e0;font-size:13px">
                  {POLICY_CONFIG[type]?.name ?? type}
                </strong>
                <div style="display:flex;gap:4px" role="group" aria-label={`${type} level`}>
                  {/* 離散的等級點，不是滑桿 —— 滑桿會變成預算一緊就往下推一格，
                      決策感消失。離散逼玩家選一個立場。 */}
                  <For each={[0, ...Array.from({ length: max }, (_, i) => i + 1)]}>
                    {(lv) => (
                      <button
                        onClick={() => setLevel(type, lv)}
                        aria-label={lv === 0 ? 'Off' : (max > 1 ? TIER_NAMES[lv - 1]! : 'On')}
                        aria-pressed={level() === lv}
                        title={lv === 0 ? 'Off' : policyEffectSummary(type, lv)}
                        style={{
                          'font-size': '11px', width: '28px', padding: '2px 0',
                          'border-radius': '4px', cursor: 'pointer',
                          border: `1px solid ${level() === lv ? '#ab47bc' : '#444'}`,
                          background: level() === lv ? '#ab47bc33' : '#222',
                          color: level() === lv ? '#ce93d8' : '#777',
                        }}
                      >
                        {lv === 0 ? '○' : (max > 1 ? TIER_LABELS[lv - 1] : '●')}
                      </button>
                    )}
                  </For>
                </div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px">
                <span style="font-size:11px;color:#aaa">
                  {level() > 0 ? policyEffectSummary(type, level()) : 'Not in effect'}
                </span>
                <Show when={cost() > 0}>
                  <span style="font-size:11px;color:#ce93d8;white-space:nowrap">${cost()}</span>
                </Show>
              </div>
            </div>
          );
        }}
      </For>
          </div>
        )}
      </For>
      <div style="font-size:11px;color:#777;margin-top:4px">
        City ordinances are billed per resident — the bill grows with the city.
      </div>
    </Modal>
  );
}
