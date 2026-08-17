import { createSignal, onCleanup, For } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { RCIBar } from './RCIBar';
import type { ToolType, PlacementMode } from '../../Game';
import { UI_COLORS } from '../constants';
import { PALETTE, toCSS } from '../../ColorPalette';
// AirportSize import removed — airport tools now use separate ToolType entries


interface SubTool { tool: ToolType; label: string; key: string; color: string; icon: string }
/** `tool` 是給只有一支工具的群組用的:群組本身就是那個工具，沒有子按鈕可以挑。 */
interface ToolGroup { id: string; label: string; icon: string; color: string; items: SubTool[]; tool?: ToolType }

const ZONE_GROUP: ToolGroup = {
  id: 'zone', label: 'Zones', icon: '\u{1F3D8}', color: UI_COLORS.STATUS_GOOD,
  items: [
    { tool: 'zone_r', label: 'Res Low', key: '3', color: UI_COLORS.STATUS_GOOD, icon: '\u{1F3E0}' },
    { tool: 'zone_rh', label: 'Res High', key: '', color: toCSS(PALETTE.ZONE.RES_HIGH), icon: '\u{1F3E2}' },
    { tool: 'zone_c', label: 'Com Low', key: '4', color: UI_COLORS.ACCENT, icon: '\u{1F3EC}' },
    { tool: 'zone_ch', label: 'Com High', key: '', color: toCSS(PALETTE.ZONE.COM_HIGH), icon: '\u{1F3EC}' },
    { tool: 'zone_i', label: 'Industrial', key: '5', color: UI_COLORS.STATUS_WARN, icon: '\u{1F3ED}' },
    { tool: 'zone_o', label: 'Office', key: '6', color: toCSS(PALETTE.ZONE.OFFICE), icon: '\u{1F3E2}' },
  ],
};

const ROAD_GROUP: ToolGroup = {
  id: 'road', label: 'Roads', icon: '\u{1F6E3}', color: '#78909c',
  items: [
    { tool: 'road_rural', label: 'Rural', key: '7', color: '#8d6e63', icon: '\u{1F6A7}' },
    { tool: 'road_2lane', label: '2-Lane', key: '', color: '#78909c', icon: '\u{1F6E3}' },
    { tool: 'road_4lane', label: '4-Lane', key: '', color: '#607d8b', icon: '\u{1F6E4}' },
    { tool: 'road_6lane', label: '6-Lane', key: '', color: '#455a64', icon: '\u{1F6E3}' },
    { tool: 'road_highway', label: 'Highway', key: '', color: '#37474f', icon: '\u{1F6E3}' },
  ],
};

const CIVIC_GROUP: ToolGroup = {
  id: 'civic', label: 'Civic', icon: '\u{1F3DB}', color: '#5c6bc0',
  items: [
    { tool: 'police', label: 'Police', key: '', color: toCSS(PALETTE.INFRA.POLICE), icon: '\u{1F694}' },
    { tool: 'fire', label: 'Fire Dept', key: '', color: toCSS(PALETTE.INFRA.FIRE), icon: '\u{1F692}' },
    { tool: 'hospital', label: 'Hospital', key: '', color: toCSS(PALETTE.INFRA.HOSPITAL), icon: '\u{1F3E5}' },
    { tool: 'school', label: 'Elementary', key: '', color: toCSS(PALETTE.INFRA.SCHOOL), icon: '\u{1F3EB}' },
    { tool: 'school_high', label: 'High School', key: '', color: toCSS(PALETTE.INFRA.SCHOOL_HIGH), icon: '\u{1F3E2}' },
    { tool: 'school_univ', label: 'University', key: '', color: toCSS(PALETTE.INFRA.SCHOOL_UNIV), icon: '\u{1F393}' },
    { tool: 'cemetery', label: 'Cemetery', key: '', color: toCSS(PALETTE.INFRA.CEMETERY), icon: '\u{26B0}' },
  ],
};

const UTILITY_GROUP: ToolGroup = {
  id: 'utility', label: 'Utility', icon: '\u{26A1}', color: '#ffb300',
  items: [
    { tool: 'power', label: 'Power', key: '8', color: toCSS(PALETTE.INFRA.POWER), icon: '\u{26A1}' },
    { tool: 'water', label: 'Water', key: '9', color: toCSS(PALETTE.INFRA.WATER), icon: '\u{1F4A7}' },
    { tool: 'sewage', label: 'Sewage', key: '', color: toCSS(PALETTE.INFRA.SEWAGE), icon: '\u{1F6B0}' },
    { tool: 'garbage', label: 'Landfill', key: '', color: toCSS(PALETTE.INFRA.GARBAGE), icon: '\u{1F5D1}' },
    { tool: 'park', label: 'Park', key: '', color: toCSS(PALETTE.INFRA.PARK), icon: '\u{1F333}' },
  ],
};

const TRANSPORT_GROUP: ToolGroup = {
  id: 'transport', label: 'Transit', icon: '\u{1F68C}', color: toCSS(PALETTE.TRANSPORT.BUS),
  items: [
    { tool: 'bus_stop', label: 'Bus Stop', key: '', color: toCSS(PALETTE.TRANSPORT.BUS), icon: '\u{1F68F}' },
    { tool: 'metro_station', label: 'Metro', key: '', color: toCSS(PALETTE.TRANSPORT.METRO), icon: '\u{1F687}' },
    { tool: 'rail_track', label: 'Rail Track', key: '', color: toCSS(PALETTE.TOOL.RAIL_TRACK), icon: '\u{1F6E4}' },
    { tool: 'train_station', label: 'Train Stn', key: '', color: toCSS(PALETTE.INFRA.SCHOOL), icon: '\u{1F689}' },
    { tool: 'ferry_dock', label: 'Ferry', key: '', color: toCSS(PALETTE.TRANSPORT.FERRY_DOCK), icon: '\u{26F4}' },
    { tool: 'airport_s', label: 'Airport(S)', key: '', color: toCSS(PALETTE.TOOL.AIRPORT), icon: '\u{2708}' },
    { tool: 'airport_m', label: 'Airport(M)', key: '', color: toCSS(PALETTE.TOOL.AIRPORT), icon: '\u{2708}' },
    { tool: 'airport_l', label: 'Airport(L)', key: '', color: toCSS(PALETTE.TOOL.AIRPORT), icon: '\u{2708}' },
  ],
};

/**
 * 分區只有一支筆刷，所以整個群組就是那個工具 —— 沒有另外一顆 Paint 可以挑。
 *
 * 原本有。它跟下面那排模式按鈕都是「按了就拿起筆刷」，於是「哪一顆是亮的」沒有
 * 一致的意思:Paint 說的是工具，Add 說的是動作，兩個同時亮著卻在回答不同的問題。
 */
const DISTRICT_GROUP: ToolGroup = {
  id: 'district', label: 'District', icon: '\u{1F3F3}', color: '#ab47bc',
  tool: 'district',
  items: [],
};

/**
 * 下一次拖曳會做什麼。四個動詞，永遠剛好一個亮著。
 *
 * 工具列在拖曳畫布上只該回答這一個問題。「選了誰」歸地圖上的白框，「剛才發生了
 * 什麼」歸當下的提示 —— 三件事擠在同一排就是原本那排按鈕難懂的原因。
 *
 * New 是模式不是動作:點了它就亮著等你拖，拖完分區成立、選取跟著成立，亮的自然
 * 跑到 Add。顏色跟拖曳預覽一致 —— 兩處對不起來的話，玩家會以為預覽的顏色代表
 * 別的東西。
 */
const DISTRICT_MODES = [
  { mode: 'add' as const, label: 'Add', icon: '\uFF0B', color: '#ab47bc',
    hint: 'Drag a rectangle to merge it into this district' },
  { mode: 'replace' as const, label: 'Replace', icon: '\u25A3', color: '#42a5f5',
    hint: 'This district becomes exactly the rectangle you drag' },
  { mode: 'subtract' as const, label: 'Subtract', icon: '\u2212', color: '#ef5350',
    hint: 'Drag a rectangle to carve it out of this district' },
];

const ALL_GROUPS = [ZONE_GROUP, ROAD_GROUP, CIVIC_GROUP, UTILITY_GROUP, TRANSPORT_GROUP, DISTRICT_GROUP];

/**
 * 手上正拿著分區筆刷嗎。
 *
 * 那一排動詞回答的是「我下一次拖曳會做什麼」，沒拿著筆刷時答案是「以上皆非」——
 * 亮著的按鈕就成了假話。工具可以在子選單還開著的時候被換掉:關掉分區圖層會把筆刷
 * 一起放下（`Game.leaveDistrictEditing`），而鍵盤切圖層不經過工具列的關閉處理。
 */
const holdingDistrictBrush = () => gameSignals.currentTool() === 'district';

/**
 * 筆刷現在畫進哪一區。分區被合併掉之後 id 還在，但那一區已經不存在了。
 *
 * 工具列不顯示它 —— 地圖上的白框與名稱已經說了同一件事，而且說在玩家正在看的地方。
 * 這裡只用來決定哪幾顆按鈕按得下去。
 */
function activeDistrict() {
  const id = gameSignals.activeDistrictId();
  if (!id) return undefined;
  gameSignals.tick();   // 一邊畫一邊看格數，數字要跟著動
  return getGame().getState().districts.getDistrict(id);
}


function ToolButton(props: { item: SubTool; onClick: (tool: ToolType) => void }) {
  return (
    <button
      class="tb-btn"
      classList={{ active: gameSignals.currentTool() === props.item.tool }}
      onClick={(e) => { e.stopPropagation(); props.onClick(props.item.tool); }}
    >
      <span class="tb-icon">{props.item.icon}</span>
      <span style={{ color: props.item.color }}>{props.item.label}</span>
      <span class="tb-key">{props.item.key}</span>
    </button>
  );
}

function ToolGroupComponent(props: {
  group: ToolGroup;
  openGroup: string | null;
  onToggleGroup: (id: string) => void;
  onSelectTool: (tool: ToolType) => void;
  onOpenModal?: (id: string) => void;
}) {
  const isChildActive = () =>
    props.group.items.some(i => i.tool === gameSignals.currentTool())
    || props.group.tool === gameSignals.currentTool();
  const isOpen = () => props.openGroup === props.group.id;

  return (
    <div class="tb-group">
      <button
        class="tb-group-btn"
        classList={{ active: isChildActive() }}
        onClick={(e) => {
          e.stopPropagation();
          props.onToggleGroup(props.group.id);
          // 只有一支工具的群組，展開它就等於拿起它 —— 底下沒有別的東西可以挑。
          if (props.group.tool) props.onSelectTool(props.group.tool);
        }}
      >
        <span class="tb-icon">{props.group.icon}</span>
        <span style={{ color: props.group.color }}>{props.group.label}</span>
        <span class="tb-caret">{'\u25B2'}</span>
      </button>
      <div class="tb-sub-panel" classList={{ open: isOpen() }}>
        <For each={props.group.items}>
          {(item) => <ToolButton item={item} onClick={props.onSelectTool} />}
        </For>
        {(props.group.id === 'road' || props.group.id === 'transport') && (
          <div class="tb-sep-v" />
        )}
        {props.group.id === 'road' && (
          <>
            <button
              class="tb-btn"
              classList={{ active: gameSignals.placementMode() === 'ground' }}
              onClick={(e) => { e.stopPropagation(); getGame().setPlacementMode('ground'); }}
              aria-label="Ground mode"
            >
              <span class="tb-icon">{'\u{1F6E3}'}</span>
              <span>Ground</span>
            </button>
            <button
              class="tb-btn"
              classList={{ active: gameSignals.placementMode() === 'elevated' }}
              onClick={(e) => { e.stopPropagation(); getGame().setPlacementMode('elevated'); }}
              aria-label="Elevated mode"
            >
              <span class="tb-icon">{'\u{1F309}'}</span>
              <span>Elevated{gameSignals.placementMode() === 'elevated' ? ` Lv.${gameSignals.elevationLevel()}` : ''}</span>
              <span class="tb-key">PgUp/Dn</span>
            </button>
          </>
        )}
        {props.group.id === 'district' && (
          <>
            {/* New 是四個動詞裡的第一個，不是一顆「按了會做事」的按鈕:點了它就
                亮著等你拖，拖完分區成立、選取跟著成立，亮的自然跑到 Add。

                所以它不停用 —— 沒有選取的時候它正是現在生效的那個模式。 */}
            <button
              class="tb-btn"
              classList={{ active: holdingDistrictBrush() && !activeDistrict() }}
              onClick={(e) => { e.stopPropagation(); getGame().clearDistrictSelection(); }}
              title="The next rectangle you drag becomes a new district"
            >
              <span class="tb-icon">{'\u2795'}</span>
              <span style={{ color: '#ab47bc' }}>New</span>
            </button>
            {/* 其餘三個動詞改的都是「選取中的那一區」，沒有選取時無事可做。停用
                而不是讓它們能按 —— 按了什麼都不會發生，比按不下去更難懂。

                取代與扣除是修邊界用的:少了它們，畫錯一次只能重開一局。 */}
            <For each={DISTRICT_MODES}>
              {(m) => {
                const off = () => !holdingDistrictBrush() || !activeDistrict();
                return (
                  <button
                    class="tb-btn"
                    classList={{ active: !off() && gameSignals.districtPaintMode() === m.mode }}
                    disabled={off()}
                    style={off() ? 'opacity:0.35;cursor:not-allowed' : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      // 挑一個動詞就等於拿起筆刷 —— 這一排沒有別的東西是「工具」。
                      getGame().setTool('district');
                      getGame().setDistrictPaintMode(m.mode);
                    }}
                    title={off() ? 'Click a district on the map first' : m.hint}
                  >
                    <span class="tb-icon">{m.icon}</span>
                    <span style={{ color: m.color }}>{m.label}</span>
                  </button>
                );
              }}
            </For>
            <div class="tb-sep-v" />
            {/* 一顆就夠。全城與分區是同一件事的兩個層級，開的本來就是同一個面板，
                只是停在不同的範圍上 —— 而那個範圍面板自己會挑:選取中的分區優先，
                沒有選取就停在全城。兩顆按鈕等於逼玩家先決定一件面板會替他決定的事。 */}
            <button class="tb-btn" onClick={(e) => { e.stopPropagation(); props.onOpenModal?.('district'); }}>
              <span class="tb-icon">{'\u{1F4CB}'}</span>
              <span style={{ color: '#ab47bc' }}>Policies</span>
            </button>
          </>
        )}
        {props.group.id === 'transport' && (
          <>
            <button
              class="tb-btn"
              classList={{ active: gameSignals.placementMode() === 'ground' }}
              onClick={(e) => { e.stopPropagation(); getGame().setPlacementMode('ground'); }}
              aria-label="Ground mode"
            >
              <span class="tb-icon">{'\u{1F6E3}'}</span>
              <span>Ground</span>
            </button>
            <button
              class="tb-btn"
              classList={{ active: gameSignals.placementMode() === 'elevated' }}
              onClick={(e) => { e.stopPropagation(); getGame().setPlacementMode('elevated'); }}
              aria-label="Elevated mode"
            >
              <span class="tb-icon">{'\u{1F309}'}</span>
              <span>Elevated{gameSignals.placementMode() === 'elevated' ? ` Lv.${gameSignals.elevationLevel()}` : ''}</span>
              <span class="tb-key">PgUp/Dn</span>
            </button>
            <button class="tb-btn" onClick={(e) => { e.stopPropagation(); props.onOpenModal?.('transit'); }}>
              <span class="tb-icon">{'\u{1F5FA}'}</span>
              <span style={{ color: '#ff9800' }}>Routes</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function Toolbar(props: { onOpenModal: (id: string) => void }) {
  const [openGroup, setOpenGroup] = createSignal<string | null>(null);

  // A group button SELECTS its group; it does not toggle.
  //
  // Toggling made the second click a close, and the natural way to pick two
  // tools from one group — press the group, press a tool, press the group,
  // press the next tool — therefore shut the panel on the third press.
  // Keyboard and automated flows always go through the group button and hit it
  // every time; a mouse user usually leaves the panel open and does not.
  //
  // The panel closes by opening another group, choosing a standalone tool, or
  // clicking away from the toolbar (below).
  const openGroupById = (groupId: string) => setOpenGroup(groupId);

  const closeOnOutsideClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('#toolbar')) return;
    // 點地圖不算「點到外面」—— 那是在用剛剛挑的工具，不是把選單撥掉。
    //
    // 分區筆刷上這件事最明顯:選一個模式、在地圖上拖一塊、想換個模式，子選單卻已經
    // 收起來了，而換模式正是這支筆刷的日常。畫分區、鋪路、劃地全都是「挑一個設定
    // 再到地圖上動手」的循環。
    if (target instanceof HTMLCanvasElement) return;
    // 面板裡的操作也不算 —— 在條例面板裡切分區跟手上拿著什麼工具是兩回事，
    // 關掉面板之後子選單卻收起來了，玩家得再點一次才能繼續畫。
    if (target?.closest('[role="dialog"]')) return;
    setOpenGroup(null);
  };
  document.addEventListener('click', closeOnOutsideClick);
  onCleanup(() => document.removeEventListener('click', closeOnOutsideClick));

  const selectTool = (tool: ToolType) => {
    getGame().setTool(tool);
  };

  const selectStandalone = (tool: ToolType) => {
    getGame().setTool(tool);
    setOpenGroup(null);
  };

  return (
    <div id="toolbar" role="toolbar" aria-label="City building tools">
      <ToolButton
        item={{ tool: 'select', label: 'Select', key: '1', color: '#b0bec5', icon: '\u{1F5B1}' }}
        onClick={selectStandalone}
      />

      <For each={ALL_GROUPS}>
        {(group) => (
          <ToolGroupComponent
            group={group}
            openGroup={openGroup()}
            onToggleGroup={openGroupById}
            onSelectTool={selectTool}
            onOpenModal={props.onOpenModal}
          />
        )}
      </For>

      <ToolButton
        item={{ tool: 'demolish', label: 'Demolish', key: '0', color: UI_COLORS.STATUS_BAD, icon: '\u{1F4A5}' }}
        onClick={selectStandalone}
      />


      <div class="tb-sep" />
      <RCIBar />
      <div class="tb-sep" />

      <button class="tb-action" classList={{ 'panel-open': false }} onClick={() => props.onOpenModal('overview')} title="City Overview">
        <span class="tb-icon">{'\u{1F3D9}'}</span>
        <span>Overview</span>
      </button>
      <button class="tb-action" onClick={() => props.onOpenModal('layers')} title="Layers / Overlays">
        <span class="tb-icon">{'\u{1F5FA}'}</span>
        <span>Layers</span>
      </button>
      <button class="tb-action" onClick={() => props.onOpenModal('cityspec')} title="City Specialization">
        <span class="tb-icon">{'\u2B50'}</span>
        <span>Specialize</span>
      </button>
    </div>
  );
}
