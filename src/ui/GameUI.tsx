import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { initGameStore } from './store/gameStore';
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

import { OverviewModal } from './modals/OverviewModal';
import { LayersModal } from './modals/LayersModal';
import { CitySpecModal } from './modals/CitySpecModal';
import { DistrictModal } from './modals/DistrictModal';
import { TransitModal } from './modals/TransitModal';
import { DebugModal } from './modals/DebugModal';
import { SettingsModal } from './modals/SettingsModal';

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
      <BuildingPanel />
      <TutorialOverlay />

      <OverviewModal open={openModal() === 'overview'} onClose={closeModal} />
      <LayersModal open={openModal() === 'layers'} onClose={closeModal} />
      <CitySpecModal open={openModal() === 'cityspec'} onClose={closeModal} />
      <DistrictModal open={openModal() === 'district'} onClose={closeModal} />
      <TransitModal open={openModal() === 'transit'} onClose={closeModal} />
      <DebugModal open={openModal() === 'debug'} onClose={closeModal} />
      <SettingsModal />
    </div>
  );
}

export function createGameUI(game: Game): HTMLElement {
  initGameStore(game);
  const container = document.createElement('div');
  render(() => <GameUIRoot />, container);
  return container.firstElementChild as HTMLElement;
}
