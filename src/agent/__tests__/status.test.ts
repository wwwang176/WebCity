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
