import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildStatus } from '../status';
import {
  setScreen, registerSettingsProbe, registerTutorialProbe, registerPanelBridge,
} from '../registry';
import { AgentUi, type UiHost } from '../AgentUi';
import { ViewMode } from '../../core/ViewMode';
import type { ToolType } from '../../Game';
import type { GameSpeed } from '../../core/simulation/GameClock';

/**
 * 「玩家現在在看什麼」。
 *
 * 這一支存在的理由:AI 在旁邊陪玩的時候，開場第一句就要答得出玩家在哪一個畫面。
 * 在這之前它只能間接猜 —— 主選單時 `read.city` 會回 `nothing at path read.city`，
 * 那句話讀起來像是它自己打錯字，不像「你還沒開始遊戲」。
 *
 * 狀態的擁有者有三個（`main.ts` 管畫面、`MainMenu` 管選單分頁、`GameUI` 管設定與
 * 教學），所以分兩種機制:**導覽用推的**（少、離散、換頁時才變），**即時狀態用拉的**
 * （每一幀都可能不一樣，推的話每個切換點都要記得通知，漏一個就是靜靜地過時）。
 */

function fakeUi(over: Partial<UiHost> = {}): AgentUi {
  const h = {
    currentTool: 'road' as ToolType,
    viewMode: ViewMode.NORMAL,
    paused: false,
    speed: 3,
    notification: null as string | null,
    setTool() {},
    setOverlay() {},
    getOverlay: () => 'traffic' as never,
    toggleViewMode() {},
    togglePause() {},
    setSpeed(_s: GameSpeed) {},
    deselectBuilding() {},
    camera: () => ({ x: 30, y: 30, size: 60, angle: 0.78, elevation: 0.52 }),
    setCamera: () => ({ x: 30, y: 30, size: 60, angle: 0.78, elevation: 0.52 }),
    rotation: () => 0,
    placementMode: () => 'ground',
    roadType: () => 'TWO_LANE',
    elevationLevel: () => 1,
    previewCost: () => null,
    selectedTransferRoute: () => null,
    selectedCitizenId: () => null,
    audio: () => ({ muted: false, sfxMuted: false, musicMuted: false }),
    loadedSave: () => ({ slot: null, name: null }),
    ...over,
  } as UiHost;
  return new AgentUi(h);
}

afterEach(() => {
  setScreen('menu', 'main');
  registerSettingsProbe(null);
  registerTutorialProbe(null);
  registerPanelBridge(null);
});

describe('還沒開始遊戲', () => {
  it('should say it is on the main menu rather than looking broken', () => {
    setScreen('menu', 'main');
    const s = buildStatus(null);

    expect(s.screen).toBe('menu');
    expect(s.menuPage).toBe('main');
  });

  it('should not report a tool or a speed there is no game for', () => {
    // 回 0 或 'select' 的話,AI 會以為遊戲正在跑而且暫停著。沒有遊戲就不要編。
    setScreen('menu', 'load');
    const s = buildStatus(null);

    expect(s.tool, '主選單上憑空生出一個工具').toBeUndefined();
    expect(s.speed).toBeUndefined();
    expect(s.paused).toBeUndefined();
  });

  it('should say which page of the menu is showing', () => {
    setScreen('menu', 'newGame');
    expect(buildStatus(null).menuPage).toBe('newGame');
  });


});

describe('載入中', () => {
  it('should say so instead of pretending the game is ready', () => {
    setScreen('loading');
    const s = buildStatus(null);

    expect(s.screen).toBe('loading');
    expect(s.menuPage, '載入中還停在某個選單分頁').toBeNull();
  });

  it('should not report the outgoing game while a new one is loading', () => {
    // 遊戲中按「載入存檔」時，`window.__agent` 還指著**上一局**（要等新的 Game
    // 做好才換）。這時候只看 `ui` 在不在是不夠的 —— 它在，而且答得出上一局的
    // 工具與速度。照著回報的話，agent 會用一座正在被丟掉的城市回答問題。
    setScreen('loading');
    const s = buildStatus(fakeUi());

    expect(s.screen).toBe('loading');
    expect(s.tool, '報的是上一局的工具').toBeUndefined();
    expect(s.speed).toBeUndefined();
  });
});

describe('模組剛載入的時候', () => {
  it('should start out on the menu, not in a game', async () => {
    // 預設值猜錯的方向很重要:說「在遊戲中」而其實還沒開局，呼叫端會照著一個
    // 不存在的城市講話;說「在主選單」最多只是慢一步。
    //
    // 要重新載入模組才測得到真正的初始值 —— 其他測試會把它改掉。
    vi.resetModules();
    const fresh = await import('../registry');
    expect(fresh.getScreen()).toBe('menu');
  });
});

describe('遊戲中', () => {
  it('should report everything the player can see', () => {
    setScreen('game');
    const s = buildStatus(fakeUi());

    expect(s).toMatchObject({
      screen: 'game',
      menuPage: null,
      tool: 'road',
      paused: false,
      speed: 3,
      viewMode: ViewMode.NORMAL,
      overlay: 'traffic',
      notification: null,
    });
  });

  it('should carry the notification the player is looking at', () => {
    setScreen('game');
    const s = buildStatus(fakeUi({ notification: 'Cannot build on water' }));
    expect(s.notification).toBe('Cannot build on water');
  });

  it('should report which panel is open', () => {
    setScreen('game');
    registerPanelBridge({ get: () => 'overview', set: () => {} });

    expect(buildStatus(fakeUi()).panel).toBe('overview');
  });

  it('should report no panel when none is open', () => {
    setScreen('game');
    registerPanelBridge({ get: () => null, set: () => {} });

    expect(buildStatus(fakeUi()).panel).toBeNull();
  });
});

describe('自己管自己開關的那兩個', () => {
  it('should report the settings dialog, which no panel bridge knows about', () => {
    // Settings 不走面板橋（它自己有一個 signal），所以 `ui.panel()` 永遠看不到它。
    // 少了這一欄，玩家開著設定畫面而 AI 以為他在看地圖。
    setScreen('game');
    registerSettingsProbe(() => true);

    expect(buildStatus(fakeUi()).settingsOpen).toBe(true);
  });

  it('should report where the tutorial has got to', () => {
    setScreen('game');
    registerTutorialProbe(() => ({ active: true, step: 3, total: 9 }));

    expect(buildStatus(fakeUi()).tutorial).toEqual({ active: true, step: 3, total: 9 });
  });

  it('should report them independently, not as one lump', () => {
    // 這兩個的擁有者不同（設定是模組 signal、教程住在元件裡）。只註冊一個的時候
    // 另一個要照樣有合理的答案，不能一起消失。
    setScreen('game');
    registerTutorialProbe(() => ({ active: true, step: 1, total: 9 }));

    const s = buildStatus(fakeUi());
    expect(s.tutorial).not.toBeNull();
    expect(s.settingsOpen, '沒註冊的那個把有註冊的一起拖下水').toBe(false);
  });

  it('should not invent an answer when the UI has not registered', () => {
    // 單元測試裡沒有 UI。丟例外的話 status() 就變成一支在測試中不能用的東西。
    setScreen('game');
    const s = buildStatus(fakeUi());

    expect(s.settingsOpen).toBe(false);
    expect(s.tutorial).toBeNull();
  });
});


describe('工具與介面的即時狀態', () => {
  it('should say which way the next building will face', () => {
    // 畫面右下角那個 `R: 90°`。以前只有玩家看得到 —— AI 說「幫你轉一下」之前
    // 根本不知道現在轉到哪。
    setScreen('game');
    const st = buildStatus(fakeUi({ rotation: () => 180 }));

    expect(st.rotation).toBe(180);
  });

  it('should say whether the next road goes on the ground or overhead', () => {
    setScreen('game');
    const st = buildStatus(fakeUi({
      placementMode: () => 'elevated', elevationLevel: () => 3, roadType: () => 'HIGHWAY',
    }));

    expect(st.placementMode).toBe('elevated');
    expect(st.elevationLevel).toBe(3);
    expect(st.roadType, '路型只給數字的話呼叫端得自己去查表').toBe('HIGHWAY');
  });

  it('should pass the hover price through as null when nothing is hovered', () => {
    // 這是 UI 在 hover 時算的,不是遊戲狀態 —— 用 API 操作永遠不會經過它。
    // 給 0 的話呼叫端會以為「這一格免費」。
    setScreen('game');

    expect(buildStatus(fakeUi()).previewCost).toBeNull();
  });

  it('should say which transfer route and which citizen are open', () => {
    setScreen('game');
    const st = buildStatus(fakeUi({
      selectedTransferRoute: () => 'bus-3', selectedCitizenId: () => 42,
    }));

    expect(st.selectedTransferRoute).toBe('bus-3');
    expect(st.selectedCitizenId).toBe(42);
  });

  it('should say which switches are muted', () => {
    // 三個開關是獨立的:總靜音關著但音效單獨靜音，玩家還是聽不到音效。
    setScreen('game');
    const st = buildStatus(fakeUi({
      audio: () => ({ muted: false, sfxMuted: true, musicMuted: false }),
    }));

    expect(st.audio).toEqual({ muted: false, sfxMuted: true, musicMuted: false });
  });

  it('should say which save this game came from', () => {
    setScreen('game');
    const st = buildStatus(fakeUi({ loadedSave: () => ({ slot: 2, name: 'PlayerCity' }) }));

    expect(st.loadedSave).toEqual({ slot: 2, name: 'PlayerCity' });
  });

  it('should leave every one of them out on the main menu', () => {
    // 主選單沒有 Game。回一個假的 rotation 0 / ground，AI 會以為遊戲正在跑。
    setScreen('menu', 'main');
    const st = buildStatus(null);

    for (const k of ['rotation', 'placementMode', 'roadType', 'elevationLevel',
      'previewCost', 'selectedTransferRoute', 'selectedCitizenId', 'audio', 'loadedSave']) {
      expect(k in st, `${k} 在主選單上還在`).toBe(false);
    }
  });
});
