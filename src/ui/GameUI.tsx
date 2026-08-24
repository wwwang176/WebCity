import { render } from 'solid-js/web';
import { createSignal, createEffect, on, onCleanup } from 'solid-js';
import { registerPanelBridge, registerSettingsProbe, type PanelId } from '../agent/registry';
import { settingsOpen } from './components/SettingsMenu';
import { initGameStore, gameSignals } from './store/gameStore';
import type { Game } from '../Game';
import './styles/game-ui.css';

import { Notification } from './components/Notification';
import { RotationIndicator } from './components/RotationIndicator';
import { TopBar } from './components/TopBar';
import { Toolbar } from './components/Toolbar';
import { OverlayIndicator } from './components/OverlayIndicator';
import { MiniMap } from './components/MiniMap';
import { BuildingPanel } from './components/BuildingPanel';
import { TutorialOverlay } from './components/Tutorial';
import { TransferOverlayPanel } from './components/TransferOverlayPanel';
import { CitizenDetailPanel } from './components/CitizenDetailPanel';

import { OverviewModal } from './modals/OverviewModal';
import { LayersModal } from './modals/LayersModal';
import { CitySpecModal } from './modals/CitySpecModal';
import { PolicyModal } from './modals/PolicyModal';
import { TransitModal } from './modals/TransitModal';
import { DebugModal } from './modals/DebugModal';
import { SettingsModal } from './modals/SettingsModal';

function LeftPanelStack() {
  const [nextOrder, setNextOrder] = createSignal(0);
  const [buildingOrder, setBuildingOrder] = createSignal(0);
  const [transferOrder, setTransferOrder] = createSignal(0);
  const [citizenOrder, setCitizenOrder] = createSignal(0);

  const hasBuilding = () => gameSignals.selectedBuilding() !== null;
  const hasTransfer = () => gameSignals.selectedTransferRoute() !== null;
  const hasCitizen = () => gameSignals.selectedCitizenId() !== null;

  createEffect(on(hasBuilding, (v, prev) => {
    if (v && !prev) { setBuildingOrder(nextOrder()); setNextOrder(n => n + 1); }
  }));

  createEffect(on(hasTransfer, (v, prev) => {
    if (v && !prev) { setTransferOrder(nextOrder()); setNextOrder(n => n + 1); }
  }));

  createEffect(on(hasCitizen, (v, prev) => {
    if (v && !prev) { setCitizenOrder(nextOrder()); setNextOrder(n => n + 1); }
  }));

  return (
    <div id="left-panels">
      <BuildingPanel panelOrder={buildingOrder()} />
      <TransferOverlayPanel panelOrder={transferOrder()} />
      <CitizenDetailPanel panelOrder={citizenOrder()} />
    </div>
  );
}

function GameUIRoot() {
  const [openModal, setOpenModal] = createSignal<string | null>(null);

  // The settings screen does not go through the panel bridge — it has a module-level signal of its
  // own — so `status()` asks it separately. Without this, the player has settings open while the agent
  // believes they are looking at the map.
  registerSettingsProbe(() => settingsOpen());
  onCleanup(() => registerSettingsProbe(null));

  const toggleModal = (id: string) => {
    setOpenModal(prev => prev === id ? null : id);
  };

  const closeModal = () => setOpenModal(null);

  // The panel's open state is a signal inside Solid that nothing outside, AgentApi included, can
  // reach, so it is registered outward instead.
  registerPanelBridge({
    get: () => openModal() as PanelId | null,
    set: (id) => setOpenModal(id),
  });
  onCleanup(() => registerPanelBridge(null));

  return (
    <div id="game-ui">
      <Notification />
      <RotationIndicator />
      <TopBar />
      <Toolbar onOpenModal={toggleModal} />
      <OverlayIndicator />
      <MiniMap />
      <LeftPanelStack />
      <TutorialOverlay />

      <OverviewModal open={openModal() === 'overview'} onClose={closeModal} />
      <LayersModal open={openModal() === 'layers'} onClose={closeModal} />
      <CitySpecModal open={openModal() === 'cityspec'} onClose={closeModal} />
      {/* City-wide and district share one panel, and the panel picks its own scope: the selected
          district first, city-wide with no selection. So the toolbar has one button. */}
      <PolicyModal open={openModal() === 'district'} onClose={closeModal} />
      <TransitModal open={openModal() === 'transit'} onClose={closeModal} />
      <DebugModal open={openModal() === 'debug'} onClose={closeModal} />
      <SettingsModal onOpenDebug={() => toggleModal('debug')} />
    </div>
  );
}

/**
 * The previous game's UI.
 *
 * `render()` returns a **dispose function**, and it is not optional: discard it and that Solid root's
 * subscriptions and effects stay alive. Calling `remove()` on the DOM is not enough.
 */
let disposePrevious: (() => void) | null = null;
let mountedRoot: HTMLElement | null = null;

/**
 * Tears down the previous game's UI.
 *
 * Starting another game, `createGameUI` builds a fresh `#game-ui`; with nothing tearing the old one
 * down, the two **stack**: the old one on top, showing the previous game's population and treasury,
 * over a canvas drawing the new city. The numbers the player sees do not match the map.
 */
export function removeGameUi(): void {
  disposePrevious?.();
  disposePrevious = null;
  mountedRoot?.remove();
  mountedRoot = null;
}

export function createGameUI(game: Game): HTMLElement {
  // It clears its own predecessor. Here rather than at the callers: each additional caller is another
  // chance to forget, and the symptom of forgetting is two stacked UIs rather than an error.
  removeGameUi();
  initGameStore(game);
  const container = document.createElement('div');
  disposePrevious = render(() => <GameUIRoot />, container);
  mountedRoot = container.firstElementChild as HTMLElement;
  return mountedRoot;
}
