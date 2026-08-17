import { createSignal, createEffect, For, Show } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { Modal } from './Modal';
import { PolicyRow } from './PolicyRow';
import { isPolicyImplemented } from '../../core/district/PolicyManager';
import {
  policiesByCategory, districtPolicyTotal, RETIRED_CATEGORY,
} from '../../core/district/PolicyPresentation';
import type { PolicyType } from '../../core/district/types';

/**
 * 條例面板。
 *
 * 全城與分區合在同一個面板裡，左邊選範圍、右邊看內容 —— 兩者回答的是同一件事的
 * 兩個層級（這座城市要不要 vs 這一區要不要），分成兩個面板玩家得自己記住哪條在
 * 哪裡。條列的樣子也一致，因為玩家要比較的就是它們。
 *
 * 分區的清單是「現在提供的 ∪ 這一區已經帶著的」。少了後者，舊存檔裡已下架的條例
 * 會從畫面上消失，玩家就再也關不掉它 —— 它們集中在最後的 Retired 一組。
 */

type Pane = { kind: 'city' } | { kind: 'district'; id: string };

export function PolicyModal(props: {
  open: boolean;
  onClose: () => void;
  /** 從哪一個工具列按鈕進來的。分區那顆進來就直接停在第一個分區上。 */
  initial: 'city' | 'district';
}) {
  const [version, setVersion] = createSignal(0);
  const [pane, setPane] = createSignal<Pane>({ kind: 'city' });

  const districts = () => {
    version();
    gameSignals.tick();   // 一邊開著面板一邊畫分區，格數與費用要跟著動
    return getGame().getState().districts.getAllDistricts();
  };

  createEffect(() => {
    if (!props.open) return;
    setVersion(v => v + 1);
    const first = getGame().getState().districts.getAllDistricts()[0];
    setPane(props.initial === 'district' && first
      ? { kind: 'district', id: first.id }
      : { kind: 'city' });
  });

  const population = () => { version(); return getGame().getState().citizens.getPopulation(); };

  /** 目前選到的分區。分區被刪掉的話回 undefined，畫面退回全城。 */
  const selectedDistrict = () => {
    const p = pane();
    if (p.kind !== 'district') return undefined;
    return districts().find(d => d.id === p.id);
  };

  const isCity = () => pane().kind === 'city' || !selectedDistrict();

  const scale = () => ({
    population: population(),
    districtCells: selectedDistrict()?.cells.size ?? 0,
  });

  const groups = () => {
    version();
    const d = selectedDistrict();
    if (isCity() || !d) return policiesByCategory('city');
    return policiesByCategory('district', (d.policies as { type: PolicyType }[]).map(p => p.type));
  };

  const levelOf = (pt: PolicyType) => {
    version();
    gameSignals.tick();
    const d = selectedDistrict();
    const state = getGame().getState();
    return isCity() || !d
      ? state.ordinances.getLevel(pt)
      : state.policies.getPolicyLevel(d.id, pt);
  };

  const total = () => {
    version();
    gameSignals.tick();
    const d = selectedDistrict();
    const state = getGame().getState();
    if (isCity() || !d) return Math.round(state.ordinances.totalCost(population()));
    return Math.round(districtPolicyTotal(
      d.policies as { type: PolicyType; level: number }[], scale()));
  };

  const setLevel = (pt: PolicyType, level: number) => {
    const game = getGame();
    const state = game.getState();
    const d = selectedDistrict();
    if (isCity() || !d) {
      state.ordinances.setLevel(pt, level);
    } else {
      state.policies.setPolicyLevel(d.id, pt, level);
      // 限制型條例決定這一區的空地能不能長房子，而圖層是照著畫的。這裡沒有別的
      // 東西看得到那個改變，而玩家坐在這個面板前時遊戲往往是暫停的。
      game.notifyDistrictPolicyChanged();
    }
    setVersion(v => v + 1);
  };

  const removePolicy = (pt: PolicyType) => {
    const d = selectedDistrict();
    if (!d) return;
    // 已下架的條例只能移除。走一般的等級設定會把一條 level 0 的紀錄又寫回去 ——
    // 舊存檔就是這樣留下一條玩家看得到卻永遠關不掉的政策。
    getGame().getState().policies.removePolicy(d.id, pt);
    getGame().notifyDistrictPolicyChanged();
    setVersion(v => v + 1);
  };

  const paneTitle = () => isCity() ? 'City Ordinances' : (selectedDistrict()?.name ?? '');
  const paneSubtitle = () => isCity()
    ? 'Billed per resident — the bill grows with the city.'
    : `${selectedDistrict()?.cells.size ?? 0} cells · billed per cell — paint it bigger and the bill grows.`;

  return (
    <Modal
      id="policy-modal"
      title={'\u{1F4CB} Policies'}
      open={props.open}
      onClose={props.onClose}
      style={{ 'min-width': '640px', 'max-width': '760px' }}
    >
      <div class="overview-layout">
        <nav class="overview-sidebar">
          <button
            class="overview-nav-item"
            classList={{ active: isCity() }}
            onClick={() => setPane({ kind: 'city' })}
          >
            <span class="nav-icon">{'\u{1F3D9}'}</span>
            <span>City</span>
          </button>
          <For each={districts()}>
            {(d) => (
              <button
                class="overview-nav-item"
                classList={{ active: !isCity() && selectedDistrict()?.id === d.id }}
                onClick={() => setPane({ kind: 'district', id: d.id })}
              >
                <span class="nav-icon">{'\u{1F3F3}'}</span>
                <span>{d.name}</span>
              </button>
            )}
          </For>
          <Show when={districts().length === 0}>
            <div style="padding:8px 14px;font-size:11px;color:#667;line-height:1.5">
              No districts yet. Use the District Paint tool to create one.
            </div>
          </Show>
        </nav>

        <div class="overview-content">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px">
            <strong style="color:#e0e0e0;font-size:14px">{paneTitle()}</strong>
            <span style="font-size:12px;color:#ce93d8">This cycle: ${total()}</span>
          </div>
          <div style="font-size:11px;color:#777;margin-bottom:10px">{paneSubtitle()}</div>

          <For each={groups()}>
            {(group) => (
              <div style="margin-bottom:10px">
                <div style="font-size:10px;color:#777;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">
                  {group.category}
                </div>
                <For each={group.policies}>
                  {(pt) => (
                    <PolicyRow
                      type={pt}
                      level={levelOf(pt)}
                      scale={scale()}
                      retired={group.category === RETIRED_CATEGORY || !isPolicyImplemented(pt)}
                      onSetLevel={(lv) => setLevel(pt, lv)}
                      onRemove={() => removePolicy(pt)}
                    />
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
    </Modal>
  );
}
