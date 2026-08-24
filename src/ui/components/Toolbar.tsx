import { createSignal, onCleanup, For } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { RCIBar } from './RCIBar';
import type { ToolType, PlacementMode } from '../../Game';
import { UI_COLORS } from '../constants';
import { PALETTE, toCSS } from '../../ColorPalette';
// AirportSize import removed — airport tools now use separate ToolType entries


interface SubTool { tool: ToolType; label: string; key: string; color: string; icon: string }
/** `tool` is for a group holding one tool: the group is that tool, with no sub-buttons to choose from. */
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
 * Districts have one brush, so the group is that tool and there is no separate Paint button.
 *
 * With one, it and the mode buttons below both mean "press this and you are holding the brush", and
 * which button is lit no longer means one thing: Paint names a tool, Add names an action, and the two
 * light up together while answering different questions.
 */
const DISTRICT_GROUP: ToolGroup = {
  id: 'district', label: 'District', icon: '\u{1F3F3}', color: '#ab47bc',
  tool: 'district',
  items: [],
};

/**
 * What the next drag will do. Four verbs, exactly one lit at any time.
 *
 * That is the only question the toolbar should answer about dragging on the canvas. What is selected
 * belongs to the outline on the map, and what just happened belongs to the current hint; three things
 * crowded into one row is what made the old buttons hard to read.
 *
 * New is a mode rather than an action: pressing it leaves it lit awaiting a drag, and once the drag
 * creates the district and selects it, the lit button moves to Add on its own. The colour matches the
 * drag preview — out of step, the player takes the preview's colour to mean something else.
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
 * Whether the district brush is currently held.
 *
 * The row of verbs answers what the next drag will do, and without the brush in hand the answer is
 * none of them, which makes a lit button a lie. The tool can change while the submenu is still open:
 * closing the district overlay puts the brush down (`Game.leaveDistrictEditing`), and switching
 * overlays by keyboard does not go through the toolbar's close handling.
 */
const holdingDistrictBrush = () => gameSignals.currentTool() === 'district';

/**
 * Which district the brush paints into. After a merge the id remains while that district does not.
 *
 * The toolbar does not display it: the map's outline and name already say the same thing, and say it
 * where the player is looking. This only decides which buttons are enabled.
 */
function activeDistrict() {
  const id = gameSignals.activeDistrictId();
  if (!id) return undefined;
  gameSignals.tick();   // the cell count is watched while painting, so it has to move
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
          // In a group holding one tool, opening it is taking it: there is nothing else below to
          // choose.
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
            {/* New is the first of the four verbs rather than a button that acts when pressed: pressing
                it leaves it lit awaiting a drag, and once the drag creates the district and selects it,
                the lit button moves to Add on its own.

                So it is never disabled: with no selection it is precisely the mode in effect. */}
            <button
              class="tb-btn"
              classList={{ active: holdingDistrictBrush() && !activeDistrict() }}
              onClick={(e) => { e.stopPropagation(); getGame().clearDistrictSelection(); }}
              title="The next rectangle you drag becomes a new district"
            >
              <span class="tb-icon">{'\u2795'}</span>
              <span style={{ color: '#ab47bc' }}>New</span>
            </button>
            {/* The other three verbs all act on the selected district and have nothing to do without a
                selection. Disabled rather than enabled: a press that does nothing is harder to read
                than a button that cannot be pressed.

                Replace and subtract are for correcting boundaries; without them, one mistake means
                starting over. */}
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
                      // Choosing a verb is taking the brush: nothing else in this row is a tool.
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
            {/* One button is enough. City-wide and district are two levels of one thing and open the
                same panel, differing only in the scope it rests on — and the panel picks that scope
                itself: the selected district first, city-wide with no selection. Two buttons force the
                player to decide something the panel decides for them. */}
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
    // Clicking the map does not count as clicking outside: that is using the tool just chosen, not
    // dismissing the menu.
    //
    // It shows most clearly on the district brush: choose a mode, drag a patch on the map, want
    // another mode — and the submenu has already closed, while changing modes is this brush's daily
    // work. Painting districts, laying roads and zoning are all a cycle of choosing a setting and then
    // acting on the map.
    if (target instanceof HTMLCanvasElement) return;
    // Nor does acting inside a panel: switching districts in the policy panel is a separate matter
    // from which tool is held, and closing the panel with the submenu shut costs the player another
    // click before they can paint again.
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
