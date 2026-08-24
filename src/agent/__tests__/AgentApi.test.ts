import { describe, it, expect } from 'vitest';
import { AgentApi, AGENT_LIMITS, type PlacementMode, type Rotation, type ToolHost } from '../AgentApi';
import type { ToolType } from '../../Game';
import { EMPTY_DEMOLISH_TALLY } from '../../core/building/DemolishTally';

/**
 * The layer a program builds through.
 *
 * Mostly one thing is guarded here: `Game.handleToolAction()` reads **state left on Game**, and
 * `setTool()` resets `placementMode` only for non-drag tools, so roads and rails keep the
 * previous value. After the player builds an elevated section, a program that then builds a
 * road gets a bridge, with no error message.
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

/** Mirrors the real `Game.setTool()` / `handleToolAction()` behaviour, including the branch that
 *  does not reset. */
function fakeHost(opts: { funds?: number; onAction?: (h: FakeHost) => void } = {}): FakeHost {
  const budget = { funds: opts.funds ?? 100_000 };
  const h: FakeHost = {
    currentTool: 'select',
    placementMode: 'ground',
    elevationLevel: 1,
    currentRotation: 0,
    notification: null,
    lastDistrictGesture: null,
    lastDemolishTally: null,
    getState: () => ({ budget }),
    calls: [],
    get funds() { return budget.funds; },
    set funds(v: number) { budget.funds = v; },
    setTool(tool: ToolType) {
      h.currentTool = tool;
      h.currentRotation = 0;
      // The real setTool resets these two only for tools that are not drag-build tools.
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
    // The player hands over control right after building an elevated section.
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
    // setTool zeroes rotation itself, so setting it beforehand is the same as not setting it.
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
    // The notification is a single string left on Game and does not clear itself.
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
    // Zoning a whole block of housing is ordinary, and getting it wrong destroys nothing that
    // was already there.
    const h = fakeHost();
    const r = new AgentApi(h).act({ tool: 'zone_r', x1: 0, y1: 0, x2: 30, y2: 30 });

    expect(r.ok).toBe(true);
    expect(h.calls).toHaveLength(1);
  });
});

describe('拆除要說出自己拆了什麼', () => {
  // Demolition neither touches the wallet nor speaks, so `cost` is always 0 and `ok` always
  // true, and demolishing 42 cells and demolishing 0 produced word-for-word identical responses
  // (BUG-366).
  it('should say plainly that it did nothing', () => {
    const h = fakeHost({ onAction: (host) => { host.lastDemolishTally = { ...EMPTY_DEMOLISH_TALLY }; } });
    const r = new AgentApi(h).act({ tool: 'demolish', x1: 0, y1: 0, x2: 5, y2: 5 });

    expect(r.ok).toBe(true);
    expect(r.cost).toBe(0);
    expect(r.demolished, '白做工看不出來').toEqual(EMPTY_DEMOLISH_TALLY);
  });

  it('should report what actually came down', () => {
    const tally = { ...EMPTY_DEMOLISH_TALLY, cells: 7, buildings: 3, roads: 4 };
    const h = fakeHost({ onAction: (host) => { host.lastDemolishTally = tally; } });
    const r = new AgentApi(h).act({ tool: 'demolish', x1: 0, y1: 0, x2: 5, y2: 5 });

    expect(r.demolished).toEqual(tally);
  });

  it('should report zeros when the cap refused the action', () => {
    // A refusal never calls handleToolAction, so the game writes no tally. The field is present
    // anyway, so callers need no extra undefined check for the refusal path.
    const h = fakeHost();
    const side = Math.ceil(Math.sqrt(AGENT_LIMITS.DEMOLISH_CELLS)) + 1;
    const r = new AgentApi(h).act({ tool: 'demolish', x1: 0, y1: 0, x2: side - 1, y2: side - 1 });

    expect(r.ok).toBe(false);
    expect(r.demolished).toEqual(EMPTY_DEMOLISH_TALLY);
  });

  it('should not put a tally on anything other than demolish', () => {
    const h = fakeHost({ onAction: (host) => { host.lastDemolishTally = { ...EMPTY_DEMOLISH_TALLY, cells: 9 }; } });
    const r = new AgentApi(h).act({ tool: 'road_2lane', x1: 0, y1: 0, x2: 5, y2: 0 });

    expect(r.demolished, '蓋路也回報拆了幾格').toBeUndefined();
  });

  it('should not inherit the tally from an earlier demolish', () => {
    // `lastDemolishTally` is state left on Game, like `notification`.
    const h = fakeHost({ onAction: () => {} });
    const api = new AgentApi(h);
    h.lastDemolishTally = { ...EMPTY_DEMOLISH_TALLY, cells: 42 };
    const r = api.act({ tool: 'demolish', x1: 0, y1: 0, x2: 1, y2: 1 });

    expect(r.demolished, '上一次拆掉的東西被算到這一次頭上').toEqual(EMPTY_DEMOLISH_TALLY);
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

describe('分區筆刷的成敗不能看通知', () => {
  /** A finished stroke says "Downtown +15 cells", which is what success looks like, not
   *  failure. */
  function districtHost(gesture: 'select' | 'deselect' | 'paint' | null, note: string) {
    return fakeHost({
      onAction: (h) => { h.notification = note; h.lastDistrictGesture = gesture; },
    });
  }

  it('should count a stroke that painted cells as a success', () => {
    // Speaking on every stroke is deliberate: when the selected district is off screen, that
    // line is the only trace.
    const h = districtHost('paint', 'Downtown +15 cells');
    const r = new AgentApi(h).act({ tool: 'district', x1: 10, y1: 12, x2: 14, y2: 14 });

    expect(r.ok, '畫成功了卻回報失敗').toBe(true);
    expect(r.reason, '成功的訊息被當成失敗理由').toBeUndefined();
    expect(r.info, '遊戲說的話被吃掉了').toBe('Downtown +15 cells');
  });

  it('should count picking a district up as a success', () => {
    const h = districtHost('select', 'Now editing Docks');
    expect(new AgentApi(h).act({ tool: 'district', x1: 3, y1: 3 }).ok).toBe(true);
  });

  it('should still report a stroke the game refused', () => {
    // In subtract mode with no district in hand the brush does nothing and only leaves a line.
    const h = districtHost(null, 'Pick a district first — click one on the map, or press New.');
    const r = new AgentApi(h).act({ tool: 'district', x1: 3, y1: 3 });

    expect(r.ok, '什麼都沒發生卻回報成功').toBe(false);
    expect(r.reason).toContain('Pick a district');
  });

  it('should not let the previous stroke make this one look successful', () => {
    const h = districtHost('paint', 'Downtown +15 cells');
    const api = new AgentApi(h);
    api.act({ tool: 'district', x1: 10, y1: 12, x2: 14, y2: 14 });

    // This stroke is refused, so handleToolAction never touches that field.
    h.notification = null;
    const blocked = fakeHost({ onAction: (x) => { x.notification = 'Pick a district first'; } });
    blocked.lastDistrictGesture = 'paint';
    const r = new AgentApi(blocked).act({ tool: 'district', x1: 3, y1: 3 });

    expect(r.ok, '上一筆的結果留著，這一筆跟著變成成功').toBe(false);
  });

  it('should leave every other tool judging by the notification', () => {
    const h = fakeHost({ onAction: (x) => { x.notification = 'Cannot build on water'; } });
    const r = new AgentApi(h).act({ tool: 'road', x1: 1, y1: 1, x2: 5, y2: 1 });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('Cannot build on water');
  });
});
