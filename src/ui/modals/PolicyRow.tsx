import { For, Show } from 'solid-js';
import { POLICY_CONFIG, maxLevel } from '../../core/district/PolicyManager';
import { policyEffectSummary, policyLevelLabel } from '../../core/district/PolicyPresentation';
import { policyCost, policyRevenue, type PolicyScale } from '../../core/district/PolicyBilling';
import type { PolicyType } from '../../core/district/types';

/**
 * One policy's row in the panel.
 *
 * Districts and the city share this component: the two answer different questions — where, and whether
 * — but what the player sees is the same. The name, the intensity, what this level gives and asks for,
 * and how much it costs this period.
 *
 * The effect and the cost are on the same row under the name rather than in a tooltip. The trade-off
 * is the gameplay, and hidden there is no trade-off.
 */


export interface PolicyRowProps {
  type: PolicyType;
  level: number;
  scale: PolicyScale;
  /** Retired: the effects table no longer holds it and only old saves still carry it. It can only be removed. */
  retired?: boolean;
  onSetLevel: (level: number) => void;
  onRemove?: () => void;
}

export function PolicyRow(props: PolicyRowProps) {
  const max = () => maxLevel(props.type);
  const name = () => POLICY_CONFIG[props.type]?.name ?? props.type;
  const cost = () => Math.round(policyCost(props.type, props.level, props.scale));
  const revenue = () => Math.round(policyRevenue(props.type, props.level, props.scale));
  /**
   * The row shows the **net**: a green + when it earns, a purple $ when it costs.
   *
   * A policy can have both — the congestion charge's gantry costs against its tolls. This card has room
   * for one line, so it carries the net; the two figures separately are in the budget panel's
   * breakdown.
   */
  const net = () => revenue() - cost();

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
            {/* Discrete levels rather than a slider: a slider becomes one notch down whenever the budget
                tightens, and the sense of a decision disappears. Discrete levels force a position. */}
            <For each={[0, ...Array.from({ length: max() }, (_, i) => i + 1)]}>
              {(lv) => (
                <button
                  onClick={() => props.onSetLevel(lv)}
                  aria-pressed={props.level === lv}
                  title={lv === 0 ? 'Off' : policyEffectSummary(props.type, lv)}
                  style={{
                    'font-size': '11px', padding: '3px 9px',
                    'border-radius': '4px', cursor: 'pointer', 'white-space': 'nowrap',
                    border: `1px solid ${props.level === lv ? '#ab47bc' : '#444'}`,
                    background: props.level === lv ? '#ab47bc33' : '#222',
                    color: props.level === lv ? '#ce93d8' : '#777',
                    'font-weight': props.level === lv ? '600' : '400',
                  }}
                >
                  {policyLevelLabel(props.type, lv)}
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
        <Show when={!props.retired && (cost() > 0 || revenue() > 0)}>
          <span style={{
            'font-size': '11px', 'white-space': 'nowrap',
            color: net() > 0 ? '#66bb6a' : '#ce93d8',
          }}>
            {net() > 0 ? `+$${net()}` : `$${-net()}`}
          </span>
        </Show>
      </div>
    </div>
  );
}
