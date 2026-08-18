import { createSignal, createEffect, For, Show } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { Modal } from './Modal';
import { PolicyRow } from './PolicyRow';
import { isPolicyImplemented } from '../../core/district/PolicyManager';
import { computeCityScales } from '../../core/district/PolicyBilling';
import { countRoadCellsInDistrict } from '../../core/district/DistrictManager';
import {
  policiesByCategory, districtPolicyTotal, RETIRED_CATEGORY,
} from '../../core/district/PolicyPresentation';
import type { PolicyType } from '../../core/district/types';
import { sanitiseDistrictName, DISTRICT_NAME_MAX } from '../../core/district/DistrictNaming';
import { DISTRICT_SWATCHES, swatchCssFor } from '../../core/district/DistrictPalette';

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
    // **訂閱** signal，不是讀 `game.activeDistrictId` 那個普通欄位。面板開著的時候
    // 選取可能被外面清掉（關圖層、鍵盤切圖層、刪掉分區），讀普通欄位的話這個 effect
    // 不會再跑，側邊欄就停在一個已經不是作用中的分區上。
    const active = gameSignals.activeDistrictId();
    setVersion(v => v + 1);
    const game = getGame();
    // 已經在畫某一區的話就停在那一區 —— 玩家剛畫完打開面板，想看的是那一區。
    const districts = game.getState().districts.getAllDistricts();
    const target = districts.find(d => d.id === active);
    setPane(target ? { kind: 'district', id: target.id } : { kind: 'city' });
  });

  /**
   * 側邊選誰，筆刷就畫誰。
   *
   * 少了這一條，玩家在面板裡點了 Docklands、關掉面板繼續畫，格子還是進 Riverside
   * —— 而畫面上沒有任何東西說明為什麼。
   */
  const selectDistrict = (id: string) => {
    setPane({ kind: 'district', id });
    getGame().setActiveDistrict(id);
  };

  const population = () => { version(); return getGame().getState().citizens.getPopulation(); };

  /** 目前選到的分區。分區被刪掉的話回 undefined，畫面退回全城。 */
  const selectedDistrict = () => {
    const p = pane();
    if (p.kind !== 'district') return undefined;
    return districts().find(d => d.id === p.id);
  };

  const isCity = () => pane().kind === 'city' || !selectedDistrict();

  /**
   * 計費規模。育兒補貼與免費診所按實際受益人頭收費，所以要走一趟市民清單 ——
   * 只在面板開著的時候算，關掉就不再走。
   */
  const scale = () => {
    version();
    const state = getGame().getState();
    return {
      ...computeCityScales(state.citizens.getCitizens(),
        (x: number, y: number) => state.health.getCoverage(x, y)),
      chargedDrivers: getGame().getCommuteStats()
        .chargedDriversByDistrict.get(selectedDistrict()?.id ?? '') ?? 0,
      districtCells: selectedDistrict()?.cells.size ?? 0,
      districtRoadCells: (() => {
        const d = selectedDistrict();
        return d ? countRoadCellsInDistrict(state.grid, d) : 0;
      })(),
    };
  };

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
    if (isCity() || !d) return Math.round(state.ordinances.totalCost(scale()));
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

  const rename = (raw: string) => {
    const d = selectedDistrict();
    if (!d) return;
    getGame().getState().districts.renameDistrict(d.id, sanitiseDistrictName(raw, d.name));
    // 圖層上的標籤是拿名字畫的，不重畫的話地圖上還是舊名字。
    getGame().refreshOverlay();
    setVersion(v => v + 1);
  };

  const recolour = (index: number) => {
    const d = selectedDistrict();
    if (!d) return;
    getGame().getState().districts.setDistrictColor(d.id, index);
    // 圖層是拿分區顏色畫的，換色之後要重畫一次才看得到。
    getGame().refreshOverlay();
    setVersion(v => v + 1);
  };

  /**
   * 刪掉整個分區。
   *
   * 把格子扣光不會讓分區消失（它身上的條例設定不該因為擦掉一次就消失），所以要有
   * 一條明確的路徑，不然側邊欄會慢慢積滿碰不到的名字。
   */
  const removeDistrict = () => {
    const d = selectedDistrict();
    if (!d) return;
    const game = getGame();
    game.getState().districts.deleteDistrict(d.id);
    // 刪掉的可能正是筆刷手上那一區 —— 不放掉的話工具列會停在一個不存在的名字上。
    if (game.activeDistrictId === d.id) game.setActiveDistrict(null);
    game.notifyDistrictPolicyChanged();
    game.refreshOverlay();
    setPane({ kind: 'city' });
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
          {/* 切到全城也要放掉選取。只改本地的 pane 的話，側邊欄寫著 City，而地圖上
              的白框與筆刷都還在那一區 —— 兩邊各說各話。 */}
          <button
            class="overview-nav-item"
            classList={{ active: isCity() }}
            onClick={() => { setPane({ kind: 'city' }); getGame().setActiveDistrict(null); }}
          >
            <span class="nav-icon">{'\u{1F3D9}'}</span>
            <span>City</span>
          </button>
          <For each={districts()}>
            {(d) => {
              // 名字與顏色要透過會追蹤 version() 的 memo 讀。<For> 重用同一個
              // District 物件，所以這個 body 不會重跑 —— 直接寫 {d.name} 的話，
              // 改完名字側邊欄還是舊的，直到關掉面板重開。
              const name = () => { version(); gameSignals.tick(); return d.name; };
              const swatch = () => { version(); return swatchCssFor(d.colorIndex); };
              // 格數是這一列唯一說得出「這一區在地圖上還在不在」的東西。0 格的分區
              // 在地圖上沒有任何格子可以點，側邊欄是唯一碰得到它的地方。
              const cells = () => { version(); gameSignals.tick(); return d.cells.size; };
              return (
                <button
                  class="overview-nav-item"
                  classList={{ active: !isCity() && selectedDistrict()?.id === d.id }}
                  onClick={() => selectDistrict(d.id)}
                >
                  <span
                    class="nav-icon"
                    style={{
                      width: '10px', height: '10px', 'border-radius': '3px',
                      background: swatch() ?? '#667', display: 'inline-block',
                    }}
                  />
                  <span>{name()}</span>
                  <span style={{
                    'margin-left': 'auto', 'font-size': '10px',
                    color: cells() === 0 ? '#a1655f' : '#667',
                  }}>
                    {cells() === 0 ? 'empty' : cells()}
                  </span>
                </button>
              );
            }}
          </For>
          <Show when={districts().length === 0}>
            <div style="padding:8px 14px;font-size:11px;color:#667;line-height:1.5">
              No districts yet. Use the District Paint tool to create one.
            </div>
          </Show>
        </nav>

        <div class="overview-content">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:2px">
            <Show
              when={!isCity()}
              fallback={<strong style="color:#e0e0e0;font-size:14px">{paneTitle()}</strong>}
            >
              {/* 名字直接可以改，不用先按一顆編輯鈕 —— 分區的名字是玩家在地圖上
                  唯一認得出這是哪一區的線索，改名不該是藏起來的功能。 */}
              <input
                value={paneTitle()}
                maxLength={DISTRICT_NAME_MAX}
                aria-label="District name"
                onInput={(e) => rename(e.currentTarget.value)}
                onBlur={(e) => { e.currentTarget.value = paneTitle(); }}
                style="background:transparent;border:none;border-bottom:1px dashed #445;color:#e0e0e0;font-size:14px;font-weight:600;padding:2px 0;outline:none;min-width:0;flex:1"
              />
            </Show>
            <span style="font-size:12px;color:#ce93d8;white-space:nowrap">This cycle: ${total()}</span>
            {/* 刪除放在標題列而不是清單最後面:格子被扣光的分區在地圖上點不到，
                側邊欄是唯一碰得到它的地方，而那時候唯一想做的事就是刪掉它 ——
                為此滾過十六條條例是說不過去的。
                旁邊沒有任何會連按的按鈕，所以不會誤觸。 */}
            <Show when={!isCity()}>
              <button
                onClick={removeDistrict}
                title="Delete this district and the policies set on it. Erasing its cells alone keeps them."
                style="background:transparent;border:1px solid #5d3a3a;color:#e57373;border-radius:4px;font-size:11px;padding:2px 8px;cursor:pointer;white-space:nowrap"
              >
                Delete
              </button>
            </Show>
          </div>
          <div style="font-size:11px;color:#777;margin-bottom:10px">{paneSubtitle()}</div>

          <Show when={!isCity()}>
            {/* 色票。圖層上就是這個顏色 —— 色塊的色相跟圖層算出來的是同一個數字，
                有測試釘著。 */}
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">
              <span style="font-size:11px;color:#777">Colour</span>
              <For each={DISTRICT_SWATCHES}>
                {(sw, i) => (
                  <button
                    onClick={() => recolour(i())}
                    aria-label={`Colour ${i() + 1}`}
                    aria-pressed={selectedDistrict()?.colorIndex === i()}
                    style={{
                      width: '18px', height: '18px', 'border-radius': '4px',
                      cursor: 'pointer', background: sw.css,
                      border: selectedDistrict()?.colorIndex === i()
                        ? '2px solid #fff' : '1px solid #0006',
                    }}
                  />
                )}
              </For>
            </div>
          </Show>

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
