import { describe, it, expect } from 'vitest';
import { AgentApi, AGENT_LIMITS, type PlacementMode, type Rotation, type ToolHost } from '../AgentApi';
import type { ToolType } from '../../Game';

/**
 * 程式動手蓋東西的那一層。
 *
 * 這裡守的主要是一件事:`Game.handleToolAction()` 讀的是**留在 Game 上的狀態**，而
 * `setTool()` 只對非拖曳工具重設 `placementMode` —— 道路與鐵軌會留著上一次的值。
 * 玩家剛蓋完高架、程式接著蓋路，蓋出來的會是高架橋，而且沒有任何錯誤訊息。
 */

interface Recorded {
  x1: number; y1: number; x2: number; y2: number;
  tool: ToolType;
  placementMode: PlacementMode;
  elevationLevel: number;
  rotation: Rotation;
}

interface FakeHost extends ToolHost {
  calls: Recorded[];
  funds: number;
}

/** 照著真的 `Game.setTool()` / `handleToolAction()` 的行為做，包括那個不重設的分支。 */
function fakeHost(opts: { funds?: number; onAction?: (h: FakeHost) => void } = {}): FakeHost {
  const budget = { funds: opts.funds ?? 100_000 };
  const h: FakeHost = {
    currentTool: 'select',
    placementMode: 'ground',
    elevationLevel: 1,
    currentRotation: 0,
    notification: null,
    getState: () => ({ budget }),
    calls: [],
    get funds() { return budget.funds; },
    set funds(v: number) { budget.funds = v; },
    setTool(tool: ToolType) {
      h.currentTool = tool;
      h.currentRotation = 0;
      // 真的 setTool 只在「不是拖曳建造工具」時才重設這兩個。
      const isDragBuild = tool.startsWith('road') || tool === 'rail_track';
      if (!isDragBuild) { h.placementMode = 'ground'; h.elevationLevel = 1; }
    },
    handleToolAction(x1: number, y1: number, x2: number, y2: number) {
      h.calls.push({
        x1, y1, x2, y2,
        tool: h.currentTool,
        placementMode: h.placementMode,
        elevationLevel: h.elevationLevel,
        rotation: h.currentRotation,
      });
      opts.onAction?.(h);
    },
  };
  return h;
}

describe('每個動作自己把工具狀態設滿', () => {
  it('should not inherit an elevated placement mode from whatever happened before', () => {
    // 玩家剛蓋完一段高架就把控制權交出來。
    const h = fakeHost();
    h.placementMode = 'elevated';
    h.elevationLevel = 2;

    new AgentApi(h).act({ tool: 'road_2lane', x1: 5, y1: 5, x2: 10, y2: 5 });

    expect(h.calls[0]!.placementMode, '默默蓋成了高架橋').toBe('ground');
    expect(h.calls[0]!.elevationLevel, '還留在上一次的樓層').toBe(1);
  });

  it('should build elevated when that is what was asked for', () => {
    const h = fakeHost();
    new AgentApi(h).act({ tool: 'road_2lane', x1: 5, y1: 5, x2: 10, y2: 5, elevated: true, elevationLevel: 2 });

    expect(h.calls[0]!.placementMode).toBe('elevated');
    expect(h.calls[0]!.elevationLevel).toBe(2);
  });

  it('should set rotation after setTool has reset it, not before', () => {
    // setTool 自己會把 rotation 歸零。在它之前設就等於沒設。
    const h = fakeHost();
    new AgentApi(h).act({ tool: 'police', x1: 3, y1: 4, rotation: 90 });

    expect(h.calls[0]!.rotation, '轉向被 setTool 洗掉了').toBe(90);
  });

  it('should not inherit a rotation either', () => {
    const h = fakeHost();
    h.currentRotation = 180;
    new AgentApi(h).act({ tool: 'police', x1: 3, y1: 4 });

    expect(h.calls[0]!.rotation).toBe(0);
  });

  it('should treat a missing second corner as a single cell', () => {
    const h = fakeHost();
    const r = new AgentApi(h).act({ tool: 'police', x1: 7, y1: 8 });

    expect(h.calls[0]).toMatchObject({ x1: 7, y1: 8, x2: 7, y2: 8 });
    expect(r.rect).toEqual({ x1: 7, y1: 8, x2: 7, y2: 8 });
  });
});

describe('動作要說得出結果', () => {
  it('should report what the action cost', () => {
    const h = fakeHost({ funds: 10_000, onAction: (host) => { host.funds -= 500; } });
    const r = new AgentApi(h).act({ tool: 'road_2lane', x1: 0, y1: 0, x2: 4, y2: 0 });

    expect(r.cost).toBe(500);
    expect(r.ok).toBe(true);
  });

  it('should report the reason when the game refuses', () => {
    const h = fakeHost({ onAction: (host) => { host.notification = 'Cannot build road: blocked'; } });
    const r = new AgentApi(h).act({ tool: 'road_2lane', x1: 0, y1: 0, x2: 4, y2: 0 });

    expect(r.ok).toBe(false);
    expect(r.reason, '被拒絕了卻沒說為什麼').toBe('Cannot build road: blocked');
  });

  it('should not blame this action for the previous notification', () => {
    // 通知是留在 Game 上的一格字串，不會自己消失。
    const h = fakeHost();
    h.notification = 'Cannot build road: blocked';

    const r = new AgentApi(h).act({ tool: 'police', x1: 1, y1: 1 });

    expect(r.ok, '上一則通知被算到這次頭上').toBe(true);
    expect(r.reason).toBeUndefined();
  });
});

describe('沒有復原功能，所以爆炸半徑要有上限', () => {
  it('should refuse a demolish larger than the cap without touching the city', () => {
    const h = fakeHost();
    const side = Math.ceil(Math.sqrt(AGENT_LIMITS.DEMOLISH_CELLS)) + 1;
    const r = new AgentApi(h).act({ tool: 'demolish', x1: 0, y1: 0, x2: side - 1, y2: side - 1 });

    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/too large/);
    expect(h.calls, '已經拆下去了才說不行').toHaveLength(0);
  });

  it('should allow a demolish exactly at the cap', () => {
    const h = fakeHost();
    const side = Math.sqrt(AGENT_LIMITS.DEMOLISH_CELLS);
    const r = new AgentApi(h).act({ tool: 'demolish', x1: 0, y1: 0, x2: side - 1, y2: side - 1 });

    expect(r.ok, '剛好等於上限就被擋掉').toBe(true);
    expect(h.calls).toHaveLength(1);
  });

  it('should count the area regardless of which corner came first', () => {
    const h = fakeHost();
    const side = Math.ceil(Math.sqrt(AGENT_LIMITS.DEMOLISH_CELLS)) + 1;
    const r = new AgentApi(h).act({ tool: 'demolish', x1: side - 1, y1: side - 1, x2: 0, y2: 0 });

    expect(r.ok, '從右下往左上拉就繞過了上限').toBe(false);
  });

  it('should not cap anything other than demolish', () => {
    // 劃一整片住宅區是正常操作，而且劃錯不會毀掉既有的東西。
    const h = fakeHost();
    const r = new AgentApi(h).act({ tool: 'zone_r', x1: 0, y1: 0, x2: 30, y2: 30 });

    expect(r.ok).toBe(true);
    expect(h.calls).toHaveLength(1);
  });
});

describe('動作記錄', () => {
  it('should keep the actions in the order they happened', () => {
    const api = new AgentApi(fakeHost());
    api.act({ tool: 'police', x1: 1, y1: 1 });
    api.act({ tool: 'fire', x1: 2, y1: 2 });

    expect(api.history().map(a => a.tool)).toEqual(['police', 'fire']);
  });

  it('should record refusals too', () => {
    const api = new AgentApi(fakeHost());
    api.act({ tool: 'demolish', x1: 0, y1: 0, x2: 40, y2: 40 });

    expect(api.history(), '被擋下來的動作沒有留下痕跡').toHaveLength(1);
    expect(api.history()[0]!.ok).toBe(false);
  });

  it('should stay bounded', () => {
    const api = new AgentApi(fakeHost());
    for (let i = 0; i < AGENT_LIMITS.LOG_SIZE + 10; i++) api.act({ tool: 'police', x1: i, y1: 0 });

    const log = api.history();
    expect(log).toHaveLength(AGENT_LIMITS.LOG_SIZE);
    expect(log[log.length - 1]!.rect.x1, '留下的是最舊的而不是最新的')
      .toBe(AGENT_LIMITS.LOG_SIZE + 9);
  });

  it('should hand out a copy, not the live list', () => {
    const api = new AgentApi(fakeHost());
    api.act({ tool: 'police', x1: 1, y1: 1 });
    (api.history() as AgentActionResultArray).length = 0;

    expect(api.history(), '外面清掉陣列就把記錄弄丟了').toHaveLength(1);
  });
});

type AgentActionResultArray = { length: number };
