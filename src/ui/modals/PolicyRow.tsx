import { For, Show } from 'solid-js';
import { POLICY_CONFIG, maxLevel } from '../../core/district/PolicyManager';
import { policyEffectSummary } from '../../core/district/PolicyPresentation';
import { policyCost, type PolicyScale } from '../../core/district/PolicyBilling';
import type { PolicyType } from '../../core/district/types';

/**
 * 一條條例在面板上的樣子。
 *
 * 分區與全城共用同一個元件 —— 兩邊回答的問題不同（在哪裡 vs 要不要），但玩家看到
 * 的東西是一樣的:名字、強度、這一級給你什麼要你付什麼、以及本期多少錢。
 *
 * 效果與代價寫在名字底下同一列，不是 tooltip。取捨是玩法，藏起來就沒有取捨。
 */

/** 三級條例的按鈕標籤。按鈕只有 28px 寬，放得下一個字母。 */
const TIER_LABELS = ['L', 'M', 'H'];
const TIER_NAMES = ['Light', 'Medium', 'Heavy'];

export interface PolicyRowProps {
  type: PolicyType;
  level: number;
  scale: PolicyScale;
  /** 已下架:效果表已經沒有它了，只有舊存檔還帶著。只能移除。 */
  retired?: boolean;
  onSetLevel: (level: number) => void;
  onRemove?: () => void;
}

export function PolicyRow(props: PolicyRowProps) {
  const max = () => maxLevel(props.type);
  const name = () => POLICY_CONFIG[props.type]?.name ?? props.type;
  const cost = () => Math.round(policyCost(props.type, props.level, props.scale));

  return (
    <div style="background:#1a2233;border-radius:6px;padding:8px 10px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <strong style={{
          color: props.retired ? '#bcaaa4' : '#e0e0e0',
          'font-size': '13px',
        }}>
          {name()}
        </strong>

        <Show
          when={!props.retired}
          fallback={
            <button
              onClick={() => props.onRemove?.()}
              title="This policy has no effect and is no longer charged. Click to remove it."
              aria-label={`Remove ${name()}`}
              style="font-size:11px;padding:2px 8px;border-radius:4px;cursor:pointer;border:1px solid #a1887f;background:#a1887f33;color:#bcaaa4;white-space:nowrap"
            >
              Remove
            </button>
          }
        >
          <div style="display:flex;gap:4px" role="group" aria-label={`${name()} level`}>
            {/* 離散的等級，不是滑桿 —— 滑桿會變成預算一緊就往下推一格，決策感
                消失。離散逼玩家選一個立場。 */}
            <For each={[0, ...Array.from({ length: max() }, (_, i) => i + 1)]}>
              {(lv) => (
                <button
                  onClick={() => props.onSetLevel(lv)}
                  aria-label={lv === 0 ? 'Off' : (max() > 1 ? TIER_NAMES[lv - 1]! : 'On')}
                  aria-pressed={props.level === lv}
                  title={lv === 0 ? 'Off' : policyEffectSummary(props.type, lv)}
                  style={{
                    'font-size': '11px', width: '28px', padding: '2px 0',
                    'border-radius': '4px', cursor: 'pointer',
                    border: `1px solid ${props.level === lv ? '#ab47bc' : '#444'}`,
                    background: props.level === lv ? '#ab47bc33' : '#222',
                    color: props.level === lv ? '#ce93d8' : '#777',
                  }}
                >
                  {lv === 0 ? '○' : (max() > 1 ? TIER_LABELS[lv - 1] : '●')}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-top:4px">
        <span style="font-size:11px;color:#aaa">
          {props.retired
            ? 'Retired — no effect, no longer charged'
            : (props.level > 0 ? policyEffectSummary(props.type, props.level) : 'Not in effect')}
        </span>
        <Show when={!props.retired && cost() > 0}>
          <span style="font-size:11px;color:#ce93d8;white-space:nowrap">${cost()}</span>
        </Show>
      </div>
    </div>
  );
}
