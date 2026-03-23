import { createSignal, For, Show } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { RCIBar } from './RCIBar';
import type { ToolType, PlacementMode } from '../../Game';
import { UI_COLORS } from '../constants';
import { PALETTE, toCSS } from '../../ColorPalette';
// AirportSize import removed — airport tools now use separate ToolType entries


interface SubTool { tool: ToolType; label: string; key: string; color: string; icon: string }
interface ToolGroup { id: string; label: string; icon: string; color: string; items: SubTool[] }

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

const DISTRICT_GROUP: ToolGroup = {
  id: 'district', label: 'District', icon: '\u{1F3F3}', color: '#ab47bc',
  items: [
    { tool: 'district', label: 'Paint', key: '', color: '#ab47bc', icon: '\u{1F58C}' },
  ],
};

const ALL_GROUPS = [ZONE_GROUP, ROAD_GROUP, CIVIC_GROUP, UTILITY_GROUP, TRANSPORT_GROUP, DISTRICT_GROUP];

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
  const isChildActive = () => props.group.items.some(i => i.tool === gameSignals.currentTool());
  const isOpen = () => props.openGroup === props.group.id;

  return (
    <div class="tb-group">
      <button
        class="tb-group-btn"
        classList={{ active: isChildActive() }}
        onClick={(e) => { e.stopPropagation(); props.onToggleGroup(props.group.id); }}
      >
        <span class="tb-icon">{props.group.icon}</span>
        <span style={{ color: props.group.color }}>{props.group.label}</span>
        <span class="tb-caret">{'\u25B2'}</span>
      </button>
      <div class="tb-sub-panel" classList={{ open: isOpen() }}>
        <For each={props.group.items}>
          {(item) => <ToolButton item={item} onClick={props.onSelectTool} />}
        </For>
        {props.group.id === 'district' && (
          <button class="tb-btn" onClick={(e) => { e.stopPropagation(); props.onOpenModal?.('district'); }}>
            <span class="tb-icon">{'\u2699'}</span>
            <span style={{ color: '#ab47bc' }}>Manage</span>
          </button>
        )}
        {props.group.id === 'transport' && (
          <button class="tb-btn" onClick={(e) => { e.stopPropagation(); props.onOpenModal?.('transit'); }}>
            <span class="tb-icon">{'\u{1F5FA}'}</span>
            <span style={{ color: '#ff9800' }}>Routes</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function Toolbar(props: { onOpenModal: (id: string) => void }) {
  const [openGroup, setOpenGroup] = createSignal<string | null>(null);

  const toggleGroup = (groupId: string) => {
    setOpenGroup(prev => prev === groupId ? null : groupId);
  };

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
            onToggleGroup={toggleGroup}
            onSelectTool={selectTool}
            onOpenModal={props.onOpenModal}
          />
        )}
      </For>

      <ToolButton
        item={{ tool: 'demolish', label: 'Demolish', key: '0', color: UI_COLORS.STATUS_BAD, icon: '\u{1F4A5}' }}
        onClick={selectStandalone}
      />

      <Show when={gameSignals.currentTool() === 'road_rural' || gameSignals.currentTool() === 'road_2lane' || gameSignals.currentTool() === 'road_4lane' || gameSignals.currentTool() === 'road_6lane' || gameSignals.currentTool() === 'road_highway' || gameSignals.currentTool() === 'road' || gameSignals.currentTool() === 'rail_track'}>
        <div class="tb-sep" />
        <div class="tb-elevation-mode" role="radiogroup" aria-label="Placement mode">
          <button
            class="tb-btn"
            classList={{ active: gameSignals.placementMode() === 'ground' }}
            onClick={() => getGame().setPlacementMode('ground')}
            aria-label="Ground mode"
          >
            <span class="tb-icon">{'\u{1F6E3}'}</span>
            <span>Ground</span>
          </button>
          <button
            class="tb-btn"
            classList={{ active: gameSignals.placementMode() === 'elevated' }}
            onClick={() => getGame().setPlacementMode('elevated')}
            aria-label="Elevated mode"
          >
            <span class="tb-icon">{'\u{1F309}'}</span>
            <span>Elevated</span>
          </button>
          <Show when={gameSignals.placementMode() === 'elevated'}>
            <span class="tb-elevation-level" aria-label="Elevation level">
              Lv.{gameSignals.elevationLevel()}
            </span>
          </Show>
        </div>
      </Show>

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
