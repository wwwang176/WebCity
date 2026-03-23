import { For } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { Modal } from './Modal';
import { ViewMode } from '../../core/ViewMode';
import { OverlayType } from '../../renderer/OverlayRenderer';

const LAYER_SECTIONS = [
  {
    title: 'Infrastructure',
    items: [
      { key: OverlayType.POWER, label: '\u26A1 Power' },
      { key: OverlayType.WATER, label: '\u{1F4A7} Water' },
    ],
  },
  {
    title: 'City Data',
    items: [
      { key: OverlayType.TRAFFIC, label: '\u{1F697} Traffic' },
      { key: OverlayType.ZONE, label: '\u{1F3D7} Zones' },
      { key: OverlayType.LAND_VALUE, label: '\u{1F4B0} Land Value' },
      { key: OverlayType.POLLUTION, label: '\u{1F32B} Pollution' },
    ],
  },
  {
    title: 'Services',
    items: [
      { key: OverlayType.POLICE, label: '\u{1F694} Police' },
      { key: OverlayType.FIRE, label: '\u{1F692} Fire' },
      { key: OverlayType.HEALTH, label: '\u{1F3E5} Health' },
      { key: OverlayType.EDUCATION, label: '\u{1F3EB} Education' },
      { key: OverlayType.PARK, label: '\u{1F333} Park' },
      { key: OverlayType.GARBAGE, label: '\u{1F5D1} Garbage' },
      { key: OverlayType.DISTRICT, label: '\u{1F3F3} District' },
    ],
  },
];

const FOCUS_MODES: { mode: ViewMode; label: string; key?: string }[] = [
  { mode: ViewMode.UNDERGROUND, label: '\u{1F687} Metro Underground' },
  { mode: ViewMode.RAIL_FOCUS, label: '\u{1F686} Rail' },
  { mode: ViewMode.FERRY_FOCUS, label: '\u{26F4} Ferry' },
  { mode: ViewMode.BUS_FOCUS, label: '\u{1F68C} Bus' },
];

export function LayersModal(props: { open: boolean; onClose: () => void }) {
  const toggleLayer = (key: OverlayType) => {
    getGame().toggleOverlay(key);
  };

  const toggleFocus = (mode: ViewMode) => {
    getGame().toggleViewMode(mode);
  };

  return (
    <Modal id="layers-modal" title={'\u{1F5FA} Map Layers'} open={props.open} onClose={props.onClose} style={{ 'min-width': '360px', 'max-width': '420px' }}>
      <For each={LAYER_SECTIONS}>
        {(section) => (
          <>
            <div class="section-title">{section.title}</div>
            <div class="overlay-btns">
              <For each={section.items}>
                {(item) => (
                  <button
                    class="ov-btn"
                    classList={{ active: gameSignals.currentOverlay() === item.key }}
                    onClick={() => toggleLayer(item.key)}
                  >
                    {item.label}
                  </button>
                )}
              </For>
            </div>
          </>
        )}
      </For>

      <div class="section-title">Transport Focus</div>
      <div class="overlay-btns">
        <For each={FOCUS_MODES}>
          {(fm) => (
            <button
              class="ov-btn"
              classList={{ active: gameSignals.viewMode() === fm.mode }}
              onClick={() => toggleFocus(fm.mode)}
            >
              {fm.label}
              {fm.key && <span style="margin-left:4px;font-size:10px;color:#888">({fm.key})</span>}
            </button>
          )}
        </For>
      </div>
    </Modal>
  );
}
