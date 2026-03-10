import { For } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { Modal } from './Modal';

const LAYER_SECTIONS = [
  {
    title: 'Infrastructure',
    items: [
      { key: 'power', label: '\u26A1 Power' },
      { key: 'water', label: '\u{1F4A7} Water' },
    ],
  },
  {
    title: 'City Data',
    items: [
      { key: 'traffic', label: '\u{1F697} Traffic' },
      { key: 'zone', label: '\u{1F3D7} Zones' },
      { key: 'landValue', label: '\u{1F4B0} Land Value' },
      { key: 'pollution', label: '\u{1F32B} Pollution' },
    ],
  },
  {
    title: 'Services',
    items: [
      { key: 'police', label: '\u{1F694} Police' },
      { key: 'fire', label: '\u{1F692} Fire' },
      { key: 'health', label: '\u{1F3E5} Health' },
      { key: 'education', label: '\u{1F3EB} Education' },
      { key: 'park', label: '\u{1F333} Park' },
      { key: 'garbage', label: '\u{1F5D1} Garbage' },
      { key: 'district', label: '\u{1F3F3} District' },
    ],
  },
];

export function LayersModal(props: { open: boolean; onClose: () => void }) {
  const toggleLayer = (key: string) => {
    getGame().toggleOverlay(key as any);
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
    </Modal>
  );
}
