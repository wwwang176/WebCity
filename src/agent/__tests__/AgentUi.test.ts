import { describe, it, expect, afterEach } from 'vitest';
import { AgentUi, type UiHost } from '../AgentUi';
import { registerPanelBridge, isPanelId, PANEL_IDS, type PanelId } from '../registry';
import { ViewMode } from '../../core/ViewMode';
import type { ToolType } from '../../Game';
import type { GameSpeed } from '../../core/simulation/GameClock';

/**
 * What the player can see and press.
 *
 * Two things go wrong here most easily:
 *
 * 1. **Panels live in Solid**, and unit tests have no UI. An unregistered bridge returns
 *    `false` rather than throwing.
 * 2. **`Game` only offers toggles** (`toggleViewMode`, `togglePause`, `changeSpeed(delta)`)
 *    while a program wants "set to this". Approaching a target by toggling has to stop when it
 *    cannot reach it rather than spinning forever.
 */


function fakeHost(over: Partial<UiHost> = {}): UiHost & { overlaySet: string[]; speedSet: number[]; deselects: number } {
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
    deselects: 0,
    deselectBuilding() { h.deselects++; },
    speedSet: [] as number[],
    setSpeed(s: GameSpeed) { h.speedSet.push(s); h.speed = s; h.paused = false; },
    camera: () => ({ x: 30, y: 30, size: 60, angle: 0.78, elevation: 0.52 }),
    setCamera: (t: Record<string, number | undefined>) => ({
      x: t.x ?? 30, y: t.y ?? 30, size: t.size ?? 60, angle: t.angle ?? 0.78, elevation: t.elevation ?? 0.52,
    }),
    ...over,
  };
  return h as UiHost & { overlaySet: string[]; speedSet: number[]; deselects: number };
}

afterEach(() => registerPanelBridge(null));

describe('面板', () => {
  it('should say no instead of throwing when the UI is not up', () => {
    // Unit tests have no Solid, and throwing would make every call site need a try block.
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
    // Game's toggleViewMode(newMode) jumps straight across from another mode, but returning to
    // NORMAL first is the path its own UI takes. What matters is ending in the target mode
    // rather than NORMAL.
    const h = fakeHost({ viewMode: ViewMode.RAIL_FOCUS });
    expect(new AgentUi(h).setViewMode(ViewMode.BUS_FOCUS)).toBe(ViewMode.BUS_FOCUS);
  });

  it('should not touch the renderers when it is already there', () => {
    // Without the early return the answer is still right — off and back on — but applyViewMode
    // resets nine renderers each way, two rounds of wasted work. So what is checked is whether
    // anything moved, not whether the result is right.
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

  it('should go straight to a gear that exists', () => {
    const h = fakeHost();
    expect(new AgentUi(h).setSpeed(10)).toBe(10);
    expect(h.speedSet, '一檔一檔按上去，不是直接設').toEqual([10]);
  });

  it('should go straight back down', () => {
    const h = fakeHost({ speed: 10 });
    expect(new AgentUi(h).setSpeed(1)).toBe(1);
    expect(h.speedSet).toEqual([1]);
  });

  it('should snap a target between gears to the nearest one', () => {
    // The gears are 1 / 3 / 5 / 10, and 7 is nearer 5 than 10.
    const h = fakeHost();
    expect(new AgentUi(h).setSpeed(7)).toBe(5);
    expect(h.speedSet, '設了一個不存在的檔位').toEqual([5]);
  });

  it('should break a tie towards the slower gear', () => {
    // 4 is equidistant from 3 and 5. The slower gear is safer: fast-forward runs past things the
    // player has not seen.
    expect(new AgentUi(fakeHost()).setSpeed(4)).toBe(3);
  });

  it('should clamp instead of running off either end', () => {
    expect(new AgentUi(fakeHost()).setSpeed(99), '超出最高檔').toBe(10);
    expect(new AgentUi(fakeHost({ speed: 10 })).setSpeed(-5), '低於最低檔').toBe(1);
  });

  it('should treat zero as the slowest gear, not as a pause', () => {
    // `0` means paused in `GameSpeed`, but `Game.setSpeed(0)` ignores it. Pausing has its own
    // entry point.
    expect(new AgentUi(fakeHost({ speed: 10 })).setSpeed(0)).toBe(1);
  });

  it('should resume the game the way the toolbar speed buttons do', () => {
    // Choosing a speed means wanting it to run. That is the game's own rule — `Game.setSpeed`
    // clears paused — and this layer does not override it.
    const h = fakeHost({ paused: true });
    new AgentUi(h).setSpeed(3);

    expect(h.paused, '選了速度卻還停著').toBe(false);
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

describe('取消選取', () => {
  it('should close the details panel', () => {
    // Selecting is done by clicking (`act({ tool: 'select' })`), but closing has no
    // corresponding click; the panel's X button calls this.
    const h = fakeHost();
    new AgentUi(h).deselect();

    expect(h.deselects).toBe(1);
  });
});


describe('可以開哪些圖層與視角', () => {
  it('should list the overlays without listing "none" as one of them', () => {
    // `none` means "off", not an overlay. Listing it would send the caller asking for its data.
    const list = new AgentUi(fakeHost()).overlays();

    expect(list.some(o => o.type === 'none'), '把關閉當成一張圖層').toBe(false);
    expect(list.length).toBeGreaterThan(10);
  });

  it('should say which overlays the player can actually reach', () => {
    // The renderer can draw crime, but the Layers panel has no tile for it and there is no
    // keyboard shortcut: the API can switch it on and the player cannot. That difference is
    // stated rather than left implicit.
    const list = new AgentUi(fakeHost()).overlays();
    const crime = list.find(o => o.type === 'crime')!;
    const police = list.find(o => o.type === 'police')!;

    expect(crime, 'crime 圖層不見了').toBeDefined();
    expect(crime.inLayersPanel, 'crime 在面板上其實按不到').toBe(false);
    expect(police.inLayersPanel).toBe(true);
  });

  it('should list the focus modes without listing NORMAL', () => {
    // NORMAL means "no focus", not a kind of focus.
    const list = new AgentUi(fakeHost()).viewModes();

    expect(list.some(m => m.mode === 'NORMAL')).toBe(false);
    expect(list.find(m => m.mode === 'UNDERGROUND')!.inLayersPanel).toBe(true);
  });

  it('should say the transfer focus has no button of its own', () => {
    // It is entered automatically by clicking a transfer route.
    const transfer = new AgentUi(fakeHost()).viewModes().find(m => m.mode === 'TRANSFER_FOCUS')!;

    expect(transfer.inLayersPanel).toBe(false);
  });

  it('should only name overlays that setOverlay would accept', () => {
    // If the list and the settable values drift apart, setting from the list is rejected.
    const ui = new AgentUi(fakeHost());
    for (const { type } of ui.overlays()) {
      expect(() => ui.setOverlay(type), `${type} 設不進去`).not.toThrow();
    }
  });
});
