import { describe, it, expect, afterEach } from 'vitest';
import { AgentUi, type UiHost } from '../AgentUi';
import { registerPanelBridge, isPanelId, PANEL_IDS, type PanelId } from '../registry';
import { ViewMode } from '../../core/ViewMode';
import type { ToolType } from '../../Game';

/**
 * 「玩家看得到、按得到」的那一層。
 *
 * 兩件事在這裡最容易出錯:
 *
 * 1. **面板住在 Solid 裡**，單元測試沒有 UI。橋沒註冊時要回 `false`，不能丟例外。
 * 2. **`Game` 只給切換式的 API**（`toggleViewMode`、`togglePause`、`changeSpeed(delta)`），
 *    而程式要的是「設成這個」。用切換去逼近設定值，逼不到就得停，不能轉成無窮迴圈。
 */

const SPEEDS = [1, 3, 5, 10];

function fakeHost(over: Partial<UiHost> = {}): UiHost & { overlaySet: string[] } {
  let overlay = 'none';
  const h = {
    currentTool: 'select' as ToolType,
    viewMode: ViewMode.NORMAL,
    paused: false,
    speed: 1,
    notification: null as string | null,
    overlaySet: [] as string[],
    setTool(t: ToolType) { h.currentTool = t; },
    setOverlay(t: never) { overlay = t as unknown as string; h.overlaySet.push(overlay); },
    getOverlay: () => overlay as never,
    toggleViewMode(m: ViewMode) { h.viewMode = h.viewMode === m ? ViewMode.NORMAL : m; },
    togglePause() { h.paused = !h.paused; },
    changeSpeed(d: number) {
      const i = SPEEDS.indexOf(h.speed);
      const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + d))];
      if (next !== undefined) h.speed = next;
    },
    camera: () => ({ x: 30, y: 30, size: 60, angle: 0.78, elevation: 0.52 }),
    setCamera: (t: Record<string, number | undefined>) => ({
      x: t.x ?? 30, y: t.y ?? 30, size: t.size ?? 60, angle: t.angle ?? 0.78, elevation: t.elevation ?? 0.52,
    }),
    ...over,
  };
  return h as UiHost & { overlaySet: string[] };
}

afterEach(() => registerPanelBridge(null));

describe('面板', () => {
  it('should say no instead of throwing when the UI is not up', () => {
    // 單元測試裡沒有 Solid。丟例外的話呼叫端每一處都得包 try。
    const ui = new AgentUi(fakeHost());
    expect(ui.openPanel('overview')).toBe(false);
    expect(ui.closePanel()).toBe(false);
    expect(ui.panel()).toBeNull();
  });

  it('should open a panel through the bridge', () => {
    let open: PanelId | null = null;
    registerPanelBridge({ get: () => open, set: (id) => { open = id; } });
    const ui = new AgentUi(fakeHost());

    expect(ui.openPanel('overview')).toBe(true);
    expect(ui.panel()).toBe('overview');
    expect(ui.closePanel()).toBe(true);
    expect(ui.panel()).toBeNull();
  });

  it('should refuse a name that is not a panel', () => {
    let open: PanelId | null = null;
    registerPanelBridge({ get: () => open, set: (id) => { open = id; } });
    const ui = new AgentUi(fakeHost());

    expect(ui.openPanel('nope')).toBe(false);
    expect(open, '不存在的名字還是被設進去了').toBeNull();
  });

  it('should list the panels it can open', () => {
    expect(new AgentUi(fakeHost()).panels()).toEqual(PANEL_IDS);
    for (const id of PANEL_IDS) expect(isPanelId(id)).toBe(true);
    expect(isPanelId('overview2')).toBe(false);
  });
});

describe('聚焦視角是「設成」不是「切換」', () => {
  it('should go straight to a mode from NORMAL', () => {
    const h = fakeHost();
    expect(new AgentUi(h).setViewMode(ViewMode.BUS_FOCUS)).toBe(ViewMode.BUS_FOCUS);
  });

  it('should switch between two focus modes without landing on NORMAL', () => {
    // Game 的 toggleViewMode(新模式) 從別的模式叫下去會直接跳過去，但先退回 NORMAL
    // 才是它自己 UI 走的路。重點是結果要是目標模式，不是 NORMAL。
    const h = fakeHost({ viewMode: ViewMode.RAIL_FOCUS });
    expect(new AgentUi(h).setViewMode(ViewMode.BUS_FOCUS)).toBe(ViewMode.BUS_FOCUS);
  });

  it('should not touch the renderers when it is already there', () => {
    // 少了早退，答案還是對的（關掉再開回來），但 applyViewMode 會把九個 renderer
    // 各重設一次 —— 兩趟白工。所以驗的是「有沒有動」，不是「結果對不對」。
    let toggles = 0;
    const h = fakeHost({ viewMode: ViewMode.BUS_FOCUS });
    const inner = h.toggleViewMode.bind(h);
    h.toggleViewMode = (m: ViewMode) => { toggles++; inner(m); };

    expect(new AgentUi(h).setViewMode(ViewMode.BUS_FOCUS)).toBe(ViewMode.BUS_FOCUS);
    expect(toggles, '本來就在這個模式了還去動 renderer').toBe(0);
  });

  it('should be able to go back to NORMAL', () => {
    const h = fakeHost({ viewMode: ViewMode.FERRY_FOCUS });
    expect(new AgentUi(h).setViewMode(ViewMode.NORMAL)).toBe(ViewMode.NORMAL);
  });
});

describe('暫停與速度', () => {
  it('should pause and resume', () => {
    const h = fakeHost();
    const ui = new AgentUi(h);
    expect(ui.setPaused(true)).toBe(true);
    expect(ui.setPaused(false)).toBe(false);
  });

  it('should not toggle when it is already in that state', () => {
    const h = fakeHost({ paused: true });
    expect(new AgentUi(h).setPaused(true), '本來就暫停了，再設一次反而繼續跑').toBe(true);
  });

  it('should walk the speed up to the target', () => {
    const h = fakeHost();
    expect(new AgentUi(h).setSpeed(10)).toBe(10);
  });

  it('should walk the speed back down', () => {
    const h = fakeHost({ speed: 10 });
    expect(new AgentUi(h).setSpeed(1)).toBe(1);
  });

  it('should stop at the gear that passes a target between gears', () => {
    // 檔位是 1 / 3 / 5 / 10。要 7 的話會在 5 與 10 之間來回跳，除非跨過就停。
    let presses = 0;
    const h = fakeHost();
    const inner = h.changeSpeed.bind(h);
    h.changeSpeed = (d: number) => { presses++; inner(d); };

    expect(new AgentUi(h).setSpeed(7)).toBe(10);
    expect(presses, '在目標兩側來回震盪').toBeLessThanOrEqual(3);
  });

  it('should stop at the top instead of pressing forever', () => {
    let presses = 0;
    const h = fakeHost({ speed: 10 });
    const inner = h.changeSpeed.bind(h);
    h.changeSpeed = (d: number) => { presses++; inner(d); };

    expect(new AgentUi(h).setSpeed(99)).toBe(10);
    expect(presses, '已經到頂了還一直按').toBe(1);
  });
});

describe('圖層與工具', () => {
  it('should report the overlay it just set', () => {
    const h = fakeHost();
    const ui = new AgentUi(h);
    expect(ui.setOverlay('traffic' as never)).toBe('traffic');
    expect(ui.overlay()).toBe('traffic');
  });

  it('should switch tools without building anything', () => {
    const h = fakeHost();
    expect(new AgentUi(h).setTool('road_2lane')).toBe('road_2lane');
  });
});
