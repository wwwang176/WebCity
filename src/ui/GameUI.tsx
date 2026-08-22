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

  // 設定畫面不走面板橋（它自己有一個模組層級的 signal），所以 `status()` 另外問它。
  // 少了這一條，玩家開著設定而 agent 以為他在看地圖。
  registerSettingsProbe(() => settingsOpen());
  onCleanup(() => registerSettingsProbe(null));

  const toggleModal = (id: string) => {
    setOpenModal(prev => prev === id ? null : id);
  };

  const closeModal = () => setOpenModal(null);

  // 面板開關是 Solid 內部的一個 signal，外面（AgentApi）拿不到。反過來註冊出去。
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
      {/* 全城與分區是同一個面板 —— 停在哪一層由面板自己挑:選取中的分區優先，
          沒有選取就停在全城。所以工具列只有一顆按鈕。 */}
      <PolicyModal open={openModal() === 'district'} onClose={closeModal} />
      <TransitModal open={openModal() === 'transit'} onClose={closeModal} />
      <DebugModal open={openModal() === 'debug'} onClose={closeModal} />
      <SettingsModal onOpenDebug={() => toggleModal('debug')} />
    </div>
  );
}

/**
 * 上一局的 UI。
 *
 * `render()` 回傳的是**解除函式**，不是可有可無的東西 —— 丟掉它，那個 Solid root
 * 的訂閱與 effect 會一直活著。只把 DOM `remove()` 掉不夠。
 */
let disposePrevious: (() => void) | null = null;
let mountedRoot: HTMLElement | null = null;

/**
 * 拆掉上一局的 UI。
 *
 * 換一局遊戲時，`createGameUI` 會做一個新的 `#game-ui`;沒有人拆舊的話，兩份會
 * **疊在一起** —— 上面那份是舊的，顯示著上一局的人口與市庫，而底下的畫布畫的是
 * 新的城市。玩家看到的數字跟地圖對不起來。
 */
export function removeGameUi(): void {
  disposePrevious?.();
  disposePrevious = null;
  mountedRoot?.remove();
  mountedRoot = null;
}

export function createGameUI(game: Game): HTMLElement {
  // 自己收拾自己的前一份。放在這裡而不是呼叫端 —— 呼叫端每多一個，就多一次
  // 「忘記拆」的機會，而忘記的徵兆是兩份 UI 疊著，不是錯誤訊息。
  removeGameUi();
  initGameStore(game);
  const container = document.createElement('div');
  disposePrevious = render(() => <GameUIRoot />, container);
  mountedRoot = container.firstElementChild as HTMLElement;
  return mountedRoot;
}
