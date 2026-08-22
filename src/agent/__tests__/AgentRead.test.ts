import { describe, it, expect } from 'vitest';
import { AgentRead, type StatsHost } from '../AgentRead';
import { createGameState } from '../../core/simulation/GameState';
import { ZoneType } from '../../core/grid/types';

/**
 * 讀城市。
 *
 * 這一層的規矩是**吐事實、不吐彙總** —— 面板把一百棟房子縮成一行是因為人只看得下
 * 一行，程式自己會加總。所以測的是「範圍、篩選、上限有沒有守住」，不是「總數對不對」。
 */

/** 只讀網格的測試碰不到 `Game`，給一個叫了就爆的空殼。 */
function noStats(): StatsHost {
  return new Proxy({}, {
    get(_t, prop) {
      return () => { throw new Error(`這個測試不該問 Game 要 ${String(prop)}`); };
    },
  }) as StatsHost;
}

function city() {
  const state = createGameState(20, 20);
  // 兩棟住宅、一棟商業，外加一棟燒毀的。
  state.grid.setCell(3, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(4, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(9, 9, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  state.grid.setCell(5, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: 2 });
  return new AgentRead(() => state, noStats());
}

/** 同一座城，但數得出 `getCell` 被問過幾次。 */
function countingCity() {
  const state = createGameState(20, 20);
  state.grid.setCell(3, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  let calls = 0;
  const grid = state.grid;
  const inner = grid.getCell.bind(grid);
  (grid as unknown as { getCell: typeof inner }).getCell = (x: number, y: number) => {
    calls++;
    return inner(x, y);
  };
  return { read: new AgentRead(() => state, noStats()), counted: () => calls };
}

describe('城市數字', () => {
  it('should report the headline numbers without throwing on an empty city', () => {
    const c = new AgentRead(() => createGameState(10, 10), noStats()).city();

    expect(c.population).toBe(0);
    expect(typeof c.funds).toBe('number');
    expect(c.rci).toHaveProperty('residential');
    expect(c.power).toHaveProperty('supply');
    expect(c.water).toHaveProperty('demand');
  });
});

describe('建築', () => {
  it('should find every building when nothing is filtered', () => {
    expect(city().buildings()).toHaveLength(4);
  });

  it('should filter by zone', () => {
    const only = city().buildings({ zone: ['commercial_low'] });
    expect(only).toHaveLength(1);
    expect(only[0]).toMatchObject({ x: 9, y: 9, zone: 'commercial_low' });
  });

  it('should filter by rectangle', () => {
    const near = city().buildings({ rect: { x1: 0, y1: 0, x2: 5, y2: 5 } });
    expect(near, '範圍外的也被撈進來了').toHaveLength(3);
  });

  it('should accept a rectangle given from the far corner', () => {
    const near = city().buildings({ rect: { x1: 5, y1: 5, x2: 0, y2: 0 } });
    expect(near, '反向的矩形被當成空的').toHaveLength(3);
  });

  it('should not scan outside the map for an oversized rectangle', () => {
    // getCell 界外回 null，所以不夾也不會壞 —— 只是把 550×550 掃完（三十萬格）而不是
    // 20×20。這是效能守衛，看得到的只有呼叫次數。
    const { read, counted } = countingCity();
    read.buildings({ rect: { x1: -50, y1: -50, x2: 500, y2: 500 } });
    expect(counted(), '掃到地圖外面去了').toBeLessThanOrEqual(20 * 20);
  });

  it('should respect the limit', () => {
    expect(city().buildings({ limit: 2 })).toHaveLength(2);
  });

  it('should be able to list only the derelict ones', () => {
    const dead = city().buildings({ derelictOnly: true });
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({ x: 5, y: 3, derelict: true });
  });

  it('should name the building rather than only numbering it', () => {
    const b = city().buildings({ rect: { x1: 3, y1: 3, x2: 3, y2: 3 } })[0]!;
    expect(b.name, '只給了編號，讀的人不知道那是什麼').not.toMatch(/^#/);
    expect(b.level).toBeGreaterThan(0);
  });
});

describe('居民', () => {
  it('should return nobody for an empty city', () => {
    expect(new AgentRead(() => createGameState(10, 10), noStats()).citizens()).toHaveLength(0);
  });

  it('should respect the limit', () => {
    const state = createGameState(20, 20);
    state.grid.setCell(3, 3, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 4 });
    for (let i = 0; i < 30; i++) state.citizens.createCitizen({ age: 300, homeId: '3,3' });

    const read = new AgentRead(() => state, noStats());
    expect(read.citizens({ limit: 5 })).toHaveLength(5);
    expect(read.citizens().length, '預設也要有上限').toBeLessThanOrEqual(200);
  });

  it('should look up only the people who live in that building', () => {
    // 一戶人家看不出差別 —— 全部回傳跟查對了長得一樣。
    const state = createGameState(20, 20);
    state.grid.setCell(3, 3, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 4 });
    state.grid.setCell(8, 8, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 4 });
    state.citizens.createCitizen({ age: 300, homeId: '3,3' });
    for (let i = 0; i < 5; i++) state.citizens.createCitizen({ age: 300, homeId: '8,8' });

    const found = new AgentRead(() => state, noStats()).citizens({ homeId: '3,3' });
    expect(found, '把別戶的人也一起撈回來了').toHaveLength(1);
    expect(found[0]!.homeId).toBe('3,3');
  });
});

describe('服務與運輸', () => {
  it('should itemise the services by name, not by index', () => {
    const s = city().services();
    expect(s.items.map(i => i.key)).toContain('police');
    expect(s.items.map(i => i.key)).toContain('deathCare');
    expect(typeof s.total).toBe('number');
  });

  it('should report transit through the same helper the panel uses', () => {
    // 面板與這裡各算一次的話，兩邊會靜靜地分家 —— BUG-342 就是這樣來的。
    const rows = city().transit();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('usage');
    expect(rows[0]).toHaveProperty('loadFactor');
  });
});

describe('逐格資料', () => {
  it('should clamp the rectangle to the map', () => {
    const { read, counted } = countingCity();
    const cells = read.cells({ x1: -5, y1: -5, x2: 2, y2: 2 });

    expect(cells).toHaveLength(9);
    expect(cells.every(c => c.x >= 0 && c.y >= 0)).toBe(true);
    expect(counted(), '界外那幾格也去問了').toBe(9);
  });

  it('should carry the raw fields through', () => {
    const cell = city().cells({ x1: 3, y1: 3, x2: 3, y2: 3 })[0]!;
    expect(cell).toMatchObject({ x: 3, y: 3, buildingId: 1 });
    expect(cell).toHaveProperty('landValue');
    expect(cell).toHaveProperty('pollution');
  });
});

/**
 * `Game` 自己已經算好的那幾份數字。
 *
 * 這裡測的不是「算得對不對」—— 那是 `EconomyBreakdown`、`CommuteStats`、`TrafficStats`
 * 各自的測試在管。這裡測的是**有沒有原封不動地交出去**:中間只要多一次 `{...}`，
 * 面板跟 agent 就各拿到一份，然後靜靜地分家（BUG-342 就是這樣來的）。
 *
 * 所以用同一性（`toBe`）釘住 —— 複製一份就紅。
 */
function stubStats() {
  const calls: string[] = [];
  const marks = {
    economy: { residential: 111 },
    billable: [{ id: 'd1', roadCells: 9, chargedDrivers: 3 }],
    commute: { average: 7 },
    traffic: { commuteVehicleCount: 5 },
    transfer: { transferRate: 0.25 },
    selected: { kind: 'zone', x: 3, y: 4 },
  };
  const host = {
    getEconomyBreakdown: () => { calls.push('economy'); return marks.economy; },
    getBillableDistricts: () => { calls.push('billable'); return marks.billable; },
    getCommuteStats: () => { calls.push('commute'); return marks.commute; },
    getTrafficStats: () => { calls.push('traffic'); return marks.traffic; },
    getTransferStats: () => { calls.push('transfer'); return marks.transfer; },
    getAbandonmentStress: (x: number, y: number) => { calls.push(`stress ${x},${y}`); return x * 100 + y; },
    getSelectedBuilding: () => { calls.push('selected'); return marks.selected; },
  } as unknown as StatsHost;

  return { read: new AgentRead(() => createGameState(10, 10), host), marks, calls };
}

describe('Game 已經算好的那幾份', () => {
  it('should hand back the very same economy breakdown the panel reads', () => {
    const { read, marks } = stubStats();
    expect(read.economyBreakdown(), '複製了一份，面板跟 agent 會分家').toBe(marks.economy);
  });

  it('should hand back the very same commute, traffic and transfer stats', () => {
    const { read, marks } = stubStats();
    expect(read.commuteStats()).toBe(marks.commute);
    expect(read.trafficStats()).toBe(marks.traffic);
    expect(read.transferStats()).toBe(marks.transfer);
  });

  it('should hand back the same billable district list', () => {
    const { read, marks } = stubStats();
    expect(read.billableDistricts()).toBe(marks.billable);
  });

  it('should ask the game exactly once per call', () => {
    // 轉手就是轉手。問兩次代表中間自己又算了一輪。
    const { read, calls } = stubStats();
    read.economyBreakdown();
    read.trafficStats();

    expect(calls).toEqual(['economy', 'traffic']);
  });

  it('should pass abandonment coordinates through in the right order', () => {
    const { read, calls } = stubStats();

    expect(read.abandonmentStress(4, 7), 'x 跟 y 掉包了').toBe(407);
    expect(calls).toEqual(['stress 4,7']);
  });
});

describe('點開的那一棟', () => {
  it('should hand back the very same selection the details panel shows', () => {
    const { read, marks } = stubStats();
    expect(read.selected()).toBe(marks.selected);
  });

  it('should be null when nothing is selected', () => {
    const { read } = stubStats();
    const empty = new AgentRead(() => createGameState(5, 5), {
      ...({} as StatsHost), getSelectedBuilding: () => null,
    } as StatsHost);

    expect(empty.selected()).toBeNull();
    expect(read.selected()).not.toBeNull();
  });
});

describe('圖層那兩份', () => {
  /** 帶得動圖層那幾支的假 host。 */
  function overlayStats() {
    const asked: string[] = [];
    const host = {
      getOverlayData: (t: string) => { asked.push(`data ${t}`); return new Map([['5,6', 80]]); },
      getOverlayColor: (t: string, v: number) => { asked.push(`color ${t} ${v}`); return 0x112233; },
      getCoverageCosts: (svc: string) => {
        asked.push(`costs ${svc}`);
        return { costs: new Map([['5,6', 270]]), budget: 540 };
      },
      getOverlaySourceCells: (t: string) => { asked.push(`sources ${t}`); return [{ x: 1, y: 2 }]; },
      coverageGradient: () => [0, 1, 2, 3, 4, 0xffe010, 6, 7, 8, 9],
    } as unknown as StatsHost;
    return { read: new AgentRead(() => createGameState(10, 10), host), asked };
  }

  it('should answer coverage from the cost map, not from the render output', () => {
    // 渲染那一份只有那張圖層開著時才存在，而且 cost 已經被丟掉了。
    const { read, asked } = overlayStats();
    const c = read.coverage('police') as { budget: number; cells: { ratio: number; color: string }[] };

    expect(c.budget).toBe(540);
    expect(c.cells[0]!.ratio).toBeCloseTo(0.5, 6);
    expect(c.cells[0]!.color, '沒有用遊戲給的那條色帶').toBe('#ffe010');
    expect(asked).toContain('costs police');
  });

  it('should refuse a service that has no road-cost gradient', () => {
    // park 有地面覆蓋，但沒有走馬路的成本圖 —— 硬問會拿到一個空殼。
    const { read, asked } = overlayStats();
    const r = read.coverage('park') as { reason: string };

    expect(r.reason, '沒說有哪些服務可以問').toContain('police');
    expect(asked, '不能問的還是去問了遊戲').toEqual([]);
  });

  it('should say how to read the numbers of a ground overlay', () => {
    const { read } = overlayStats();
    const o = read.overlay('police');

    expect(o.kind, '沒告訴呼叫端這一層是二元的').toBe('binary');
    expect(o.cells).toEqual([{ x: 5, y: 6, value: 80, color: '#112233' }]);
  });

  it('should ask the game for the colour of the overlay it was asked about', () => {
    // 拿別張圖層的色階去上色，顏色會跟畫面對不起來。
    const { read, asked } = overlayStats();
    read.overlay('commute');

    expect(asked).toContain('color commute 80');
  });
});


describe('Overview 那八頁', () => {
  /** 一座有東西可以數的城:住宅、商業、工業各一，外加一座警局。 */
  function overviewCity() {
    const state = createGameState(20, 20);
    state.grid.setCell(3, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    state.grid.setCell(9, 9, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    state.grid.setCell(12, 12, { zoneType: ZoneType.INDUSTRIAL, buildingId: 1 });
    state.police.addStation(5, 5);
    return { state, read: new AgentRead(() => state, noStats()) };
  }

  it('should read every page straight off the game state', () => {
    // 這七支都不碰 `Game` —— `noStats()` 一被問就爆。跑得完就代表沒有一支
    // 偷偷繞到渲染層或面板的狀態去拿數字。
    const { read } = overviewCity();

    expect(() => {
      read.summary();
      read.demographics();
      read.environment();
      read.freight();
      read.infra();
      read.serviceStats();
    }).not.toThrow();
  });

  it('should give the freight page the goods shops can actually get', () => {
    const { state, read } = overviewCity();
    state.freight.getLastDemand().production = 100;
    state.freight.getLastDemand().consumption = 200;
    state.freight.getLastTrade().imported = 60;

    const f = read.freight();

    expect(f.effectiveProduction, '進口沒算進來').toBe(160);
    expect(f.supplyRatio).toBeCloseTo(0.8, 6);
    expect(f.totalCommercial, '沒數到店家').toBe(1);
  });

  it('should name what is dragging the city down, not just the score', () => {
    // 「吸引力 12 分」本身沒有可以動作的資訊。
    const { state, read } = overviewCity();
    state.taxRates.residential = 20;

    const s = read.summary();

    expect(s.drags.length).toBeGreaterThan(0);
    if (s.attractiveness <= s.attractivenessThreshold) {
      expect(s.worstDrag, '分數不夠卻沒說是哪一項').not.toBeNull();
    }
  });

  it('should keep a dead station out of the capacity the city can use', () => {
    const { state, read } = overviewCity();
    state.police.updateOperationalStatus(() => false);

    const police = read.serviceStats().services.find(x => x.service === 'police')!;

    expect(police.facilities, '壞掉的局從清單裡消失了').toHaveLength(1);
    expect(police.capacity, '壞掉的局還在貢獻容量').toBe(0);
  });

  it('should hand over the chart history the game panel draws', () => {
    // 這一份**不在 GameState 裡** —— 是 UI 的 store 累積的，所以要靠 host 轉手。
    const history = { days: [1, 2], pop: [10, 20], happiness: [], funds: [], income: [], expenses: [] };
    const read = new AgentRead(() => createGameState(8, 8), {
      chartHistory: () => history,
    } as unknown as StatsHost);

    expect(read.chartHistory(), '沒有原封不動轉手').toBe(history);
  });

  it('should not recompute what the panel computes', () => {
    // 面板跟這裡呼叫的是同一支 `build*Stats`。這條在測「同一個狀態問兩次結果一樣」——
    // 一旦有人在 read 這層插進自己的算式，兩次之間就會出現差異。
    const { read } = overviewCity();

    expect(read.summary()).toEqual(read.summary());
    expect(read.demographics()).toEqual(read.demographics());
    expect(read.serviceStats()).toEqual(read.serviceStats());
  });
});
