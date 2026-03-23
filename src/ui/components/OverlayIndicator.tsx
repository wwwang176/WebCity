import { Show } from 'solid-js';
import { gameSignals, getGame } from '../store/gameStore';
import { ViewMode } from '../../core/ViewMode';
import { OverlayType } from '../../renderer/OverlayRenderer';

const OVERLAY_NAMES: Record<string, string> = {
  [OverlayType.POWER]: 'Power', [OverlayType.WATER]: 'Water', [OverlayType.ZONE]: 'Zones',
  [OverlayType.TRAFFIC]: 'Traffic', [OverlayType.POLLUTION]: 'Pollution', [OverlayType.LAND_VALUE]: 'Land Value',
  [OverlayType.POLICE]: 'Police', [OverlayType.FIRE]: 'Fire', [OverlayType.HEALTH]: 'Health',
  [OverlayType.EDUCATION]: 'Education', [OverlayType.PARK]: 'Park', [OverlayType.GARBAGE]: 'Garbage', [OverlayType.DISTRICT]: 'Districts',
};

const FOCUS_NAMES: Record<string, string> = {
  [ViewMode.UNDERGROUND]: '\u{1F687} Metro Underground',
  [ViewMode.RAIL_FOCUS]: '\u{1F686} Rail Focus',
  [ViewMode.FERRY_FOCUS]: '\u{26F4} Ferry Focus',
  [ViewMode.BUS_FOCUS]: '\u{1F68C} Bus Focus',
};

export function OverlayIndicator() {
  const ov = () => gameSignals.currentOverlay();
  const vm = () => gameSignals.viewMode();
  const overlayVisible = () => ov() !== OverlayType.NONE;
  const focusVisible = () => vm() !== ViewMode.NORMAL;

  const closeOverlay = () => {
    getGame().setOverlay(OverlayType.NONE);
  };

  const closeFocus = () => {
    getGame().toggleViewMode(vm());
  };

  const anyVisible = () => overlayVisible() || focusVisible();

  return (
    <div id="indicator-stack" classList={{ visible: anyVisible() }}>
      <Show when={overlayVisible()}>
        <div class="indicator-pill">
          <span class="oi-label">Overlay:</span>
          <span class="oi-name">{OVERLAY_NAMES[ov()] ?? ov()}</span>
          <button class="indicator-close" onClick={closeOverlay}>Close</button>
        </div>
      </Show>
      <Show when={focusVisible()}>
        <div class="indicator-pill">
          <span class="oi-label">Focus:</span>
          <span class="oi-name">{FOCUS_NAMES[vm()] ?? vm()}</span>
          <button class="indicator-close" onClick={closeFocus}>Close</button>
        </div>
      </Show>
    </div>
  );
}
