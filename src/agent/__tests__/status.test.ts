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
 * What the player is looking at.
 *
 * Why this exists: an AI playing alongside the player has to answer which screen they are on in
 * its first sentence. Without it, the only inference available is that on the main menu
 * `read.city` answers `nothing at path read.city`, which reads like its own typo rather than
 * "you have not started a game".
 *
 * Three owners hold the state — `main.ts` the screen, `MainMenu` the menu page, `GameUI` the
 * settings and tutorial — so there are two mechanisms: **navigation is pushed** (rare, discrete,
 * changing only on a page change) and **live state is pulled** (potentially different every
 * frame, where pushing would require a notification at every transition and one omission goes
 * quietly stale).
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
    // Returning 0 or 'select' would let the AI believe a game is running and paused. With no
    // game, nothing is invented.
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
    // Pressing Load Game from inside a game leaves `window.__agent` pointing at the **previous
    // session** until the new `Game` is built. Checking only whether `ui` exists is not enough:
    // it does, and it answers with the previous session's tool and speed, so the agent would
    // answer questions about a city being discarded.
    setScreen('loading');
    const s = buildStatus(fakeUi());

    expect(s.screen).toBe('loading');
    expect(s.tool, '報的是上一局的工具').toBeUndefined();
    expect(s.speed).toBeUndefined();
  });
});

describe('模組剛載入的時候', () => {
  it('should start out on the menu, not in a game', async () => {
    // The direction of a wrong default matters: claiming "in game" before a game exists makes
    // the caller talk about a city that is not there, while claiming "in the main menu" is at
    // worst one step behind.
    //
    // The module is reloaded to observe the real initial value, which other tests overwrite.
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
    // Settings does not go through the panel bridge — it has a signal of its own — so
    // `ui.panel()` never sees it. Without this field the player has settings open while the AI
    // believes they are looking at the map.
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
    // Their owners differ: settings is a module signal and the tutorial lives in a component.
    // Registering one must leave the other with a sensible answer rather than taking it down
    // too.
    setScreen('game');
    registerTutorialProbe(() => ({ active: true, step: 1, total: 9 }));

    const s = buildStatus(fakeUi());
    expect(s.tutorial).not.toBeNull();
    expect(s.settingsOpen, '沒註冊的那個把有註冊的一起拖下水').toBe(false);
  });

  it('should not invent an answer when the UI has not registered', () => {
    // Unit tests have no UI, and throwing would make status() unusable in them.
    setScreen('game');
    const s = buildStatus(fakeUi());

    expect(s.settingsOpen).toBe(false);
    expect(s.tutorial).toBeNull();
  });
});


describe('工具與介面的即時狀態', () => {
  it('should say which way the next building will face', () => {
    // The `R: 90°` indicator in the bottom-right corner. Without it only the player can see the
    // rotation, so an AI offering to rotate has no idea where it currently is.
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
    // The UI computes it on hover; it is not game state and API actions never go near it.
    // Returning 0 would read as "this cell is free".
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
    // The three switches are independent: with the master unmuted but sound effects muted, the
    // player still hears no effects.
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
    // The main menu has no Game. A plausible rotation 0 / ground would let the AI believe one is
    // running.
    setScreen('menu', 'main');
    const st = buildStatus(null);

    for (const k of ['rotation', 'placementMode', 'roadType', 'elevationLevel',
      'previewCost', 'selectedTransferRoute', 'selectedCitizenId', 'audio', 'loadedSave']) {
      expect(k in st, `${k} 在主選單上還在`).toBe(false);
    }
  });
});
