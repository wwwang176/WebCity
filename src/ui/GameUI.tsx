import { render } from 'solid-js/web';
import { createSignal, createEffect, on } from 'solid-js';
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

  const toggleModal = (id: string) => {
    setOpenModal(prev => prev === id ? null : id);
  };

  const closeModal = () => setOpenModal(null);

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
      {/* 全城與分區是同一個面板 —— 停在哪一層由面板自己挑:選取中的分區優先，
          沒有選取就停在全城。所以工具列只有一顆按鈕。 */}
      <PolicyModal open={openModal() === 'district'} onClose={closeModal} />
      <TransitModal open={openModal() === 'transit'} onClose={closeModal} />
      <DebugModal open={openModal() === 'debug'} onClose={closeModal} />
      <SettingsModal onOpenDebug={() => toggleModal('debug')} />
    </div>
  );
}

export function createGameUI(game: Game): HTMLElement {
  initGameStore(game);
  const container = document.createElement('div');
  render(() => <GameUIRoot />, container);
  return container.firstElementChild as HTMLElement;
}
