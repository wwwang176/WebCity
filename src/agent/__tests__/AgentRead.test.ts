import { describe, it, expect } from 'vitest';
import { AgentRead, type StatsHost } from '../AgentRead';
import { createGameState } from '../../core/simulation/GameState';
import { ZoneType } from '../../core/grid/types';
import { ABANDONED, BURNED } from '../../core/building/InfraPlacement';
import { ElevationManager } from '../../core/elevation/ElevationManager';
import { RoadType, RoadDirection } from '../../core/road/types';
import { UnifiedRoadLookup } from '../../core/road/UnifiedRoadLookup';
import { buildRoadCellGraph } from '../../core/road/RoadCellGraph';

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

/** 空殼加上這個測試真的要用的那幾支。 */
function noStatsBut(overrides: Partial<StatsHost>): StatsHost {
  return new Proxy(overrides, {
    get(t, prop) {
      const own = (t as Record<string | symbol, unknown>)[prop];
      if (own !== undefined) return own;
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
  // `BURNED`，不是寫死的 2。這個 fixture 原本寫 2，而程式碼裡也寫著 2 ——
  // 兩邊用同一個我自己編的數字，於是測試通過而遊戲裡的焦黑房子全被當成好的（BUG-360）。
  state.grid.setCell(5, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: BURNED });
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
  function overlayStats(load = -1) {
    const asked: string[] = [];
    const host = {
      getOverlayData: (t: string) => { asked.push(`data ${t}`); return new Map([['5,6', 80]]); },
      getOverlayColor: (t: string, v: number) => { asked.push(`color ${t} ${v}`); return 0x112233; },
      getCoverageCosts: (svc: string) => {
        asked.push(`costs ${svc}`);
        return {
          costs: new Map([['5,6', 270]]),
          budget: 540,
          loadAt: () => load,
          servingFacilityAt: () => 'station_1',
        };
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

  it('should redden a cell whose facility is swamped, however close it is', () => {
    // 距離 270/540 = 0.5（第 5 階）。設施爆到兩倍時嚴重度是 1，該跳到第 9 階。
    const { read } = overlayStats(2.0);
    const c = read.coverage('police') as {
      cells: { ratio: number; load: number; severity: number; tier: number; facilityId: string | null }[];
    };

    expect(c.cells[0]!.ratio, '距離那一半沒變').toBeCloseTo(0.5, 6);
    expect(c.cells[0]!.load).toBe(2.0);
    expect(c.cells[0]!.severity, '負載沒有進到嚴重度').toBe(1);
    expect(c.cells[0]!.tier, '顏色還是照距離挑的').toBe(9);
    expect(c.cells[0]!.facilityId, '沒說是哪一座在管這一格').toBe('station_1');
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


describe('一個市民,照面板顯示的樣子', () => {
  function withCitizens() {
    const state = createGameState(20, 20);
    state.grid.setCell(3, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    const worker = state.citizens.restoreCitizen({ age: 100 });
    worker.homeId = '3,3';
    worker.workplaceId = '9,9';
    const retiree = state.citizens.restoreCitizen({ age: 400 });
    const child = state.citizens.restoreCitizen({ age: 20 });
    return { state, read: new AgentRead(() => state, noStats()), worker, retiree, child };
  }

  it('should carry the name the panel prints', () => {
    // 畫面上寫的是名字,API 只給 id 的話兩邊講的是不同的東西。
    const { read, worker } = withCitizens();
    const c = read.citizen(worker.id)!;

    expect(c.name, '沒有名字').toBeTruthy();
    expect(typeof c.name).toBe('string');
  });

  it('should not call a retiree or a child unemployed', () => {
    // 面板分成 Unemployed / Retired / Student / Too young to work。
    // 把後三種讀成失業，一座滿員的城市點開住宅會像失業率 100%（面板為此開過單）。
    const { read, worker, retiree, child } = withCitizens();

    expect(read.citizen(worker.id)!.workLabel).toBe('9,9');
    expect(read.citizen(retiree.id)!.workLabel).toBe('Retired');
    expect(read.citizen(child.id)!.workLabel, '小孩被算成失業').not.toBe('Unemployed');
  });

  it('should carry the stage and the health the panel shows', () => {
    const { read, worker } = withCitizens();
    const c = read.citizen(worker.id)!;

    expect(c.lifeStage).toBe('ADULT');
    expect(c.health).toBeGreaterThan(0);
  });

  it('should return null for an id that is not around any more', () => {
    // 市民會死，而 id 不回收。丟例外的話呼叫端每問一次都得包 try。
    const { read } = withCitizens();

    expect(read.citizen(999999)).toBeNull();
  });

  it('should describe a citizen in a list exactly as it describes them alone', () => {
    // 兩支各拼一份的話，清單跟詳情會慢慢分家。
    const { read, worker } = withCitizens();
    const fromList = read.citizens().find(c => c.id === worker.id);

    expect(fromList).toEqual(read.citizen(worker.id));
  });
});


describe('廢墟的判定要用遊戲的常數', () => {
  function burnedCity() {
    const state = createGameState(20, 20);
    state.grid.setCell(3, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    state.grid.setCell(4, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: BURNED });
    state.grid.setCell(5, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: ABANDONED });
    return new AgentRead(() => state, noStats());
  }

  it('should flag a burned building as derelict', () => {
    // 這裡原本寫死 `[1, 2]`，而 BURNED 其實是 3 —— 於是玩家螢幕上九棟焦黑的房子，
    // API 全部回報「好得很」（BUG-360）。
    const burned = burnedCity().buildings().find(b => b.x === 4 && b.y === 3)!;

    expect(burned.derelict, '燒毀的樓被當成正常的').toBe(true);
  });

  it('should flag an abandoned building as derelict', () => {
    const abandoned = burnedCity().buildings().find(b => b.x === 5 && b.y === 3)!;

    expect(abandoned.derelict).toBe(true);
  });

  it('should leave a healthy building alone', () => {
    // 反面也要成立 —— 不然「全部都是廢墟」也會讓上面兩條通過。
    const healthy = burnedCity().buildings().find(b => b.x === 3 && b.y === 3)!;

    expect(healthy.derelict).toBe(false);
  });

  it('should return exactly the ruins when asked for only ruins', () => {
    const only = burnedCity().buildings({ derelictOnly: true });

    expect(only.map(b => b.x).sort(), '篩出來的不是那兩棟').toEqual([4, 5]);
  });

  it('should take the values from the game rather than restating them', () => {
    // 常數搬家或改值時，寫死的那一份不會跟著動。
    expect(BURNED).not.toBe(2);
  });
});

describe('高架結構', () => {
  /** 一座橋、一段疊在它上面的第二層，以及一段別處的。 */
  function bridgeCity() {
    const state = createGameState(20, 20);
    const em = new ElevationManager();
    const seg = (isRamp = false) => ({
      roadType: RoadType.HIGHWAY, roadFlags: 0, railType: 0, railFlags: 0,
      isRamp, rampAscendDirection: 0,
    });
    // 刻意不照順序放 —— 照順序放的話「有沒有排序」就測不出來。
    em.set(15, 15, 1, seg());
    em.set(6, 5, 2, seg());
    em.set(5, 5, 1, seg(true));
    em.set(6, 5, 1, seg());
    const host = { ...noStatsBut({ elevatedSegments: () => em.toJSON() }) };
    return new AgentRead(() => state, host);
  }

  it('should list every elevated segment when no rect is given', () => {
    // 在這之前確認一座橋存在的唯一辦法，是故意重蓋一次讀錯誤訊息（BUG-367）。
    expect(bridgeCity().elevated()).toHaveLength(4);
  });

  it('should report both levels stacked on one cell', () => {
    const stacked = bridgeCity().elevated().filter(s => s.x === 6 && s.y === 5);

    expect(stacked.map(s => s.level), '疊起來的第二層不見了').toEqual([1, 2]);
  });

  it('should carry the ramp flag', () => {
    const ramp = bridgeCity().elevated().find(s => s.x === 5 && s.y === 5)!;

    expect(ramp.isRamp, '匝道看不出來 —— 那座橋就下不來了').toBe(true);
    expect(ramp.roadType).toBe(RoadType.HIGHWAY);
  });

  it('should keep only what falls inside the rect', () => {
    const near = bridgeCity().elevated({ x1: 0, y1: 0, x2: 9, y2: 9 });

    expect(near).toHaveLength(3);
  });

  it('should accept a rect given from the far corner', () => {
    const near = bridgeCity().elevated({ x1: 9, y1: 9, x2: 0, y2: 0 });

    expect(near, '反向的矩形被當成空的').toHaveLength(3);
  });

  it('should come back in a stable order', () => {
    // 每次順序不同的話，呼叫端沒辦法比對兩次讀取之間差了什麼。
    const rows = bridgeCity().elevated();

    expect(rows.map(s => `${s.x},${s.y},${s.level}`))
      .toEqual(['5,5,1', '6,5,1', '6,5,2', '15,15,1']);
  });

  it('should say nothing when the city has no bridges', () => {
    const read = new AgentRead(
      () => createGameState(10, 10),
      noStatsBut({ elevatedSegments: () => [] }),
    );

    expect(read.elevated()).toEqual([]);
  });
});

describe('兩格通不通', () => {
  function roadCity(build: (road: (x: number, y: number) => void) => void) {
    const state = createGameState(20, 20);
    build((x, y) => state.grid.setCell(x, y, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
    }));
    const graph = buildRoadCellGraph(UnifiedRoadLookup.fromGrid(state.grid));
    return new AgentRead(() => state, noStatsBut({ roadCellGraph: () => graph }));
  }

  it('should answer for two points on the same road', () => {
    const read = roadCity(road => { for (let x = 0; x <= 9; x++) road(x, 2); });

    const r = read.connected({ x: 0, y: 2 }, { x: 9, y: 2 });

    expect(r.connected).toBe(true);
    expect(r.cost).toBeGreaterThan(0);
  });

  it('should answer for two roads that never meet', () => {
    const read = roadCity(road => {
      for (let x = 0; x <= 5; x++) road(x, 1);
      for (let x = 12; x <= 18; x++) road(x, 8);
    });

    expect(read.connected({ x: 0, y: 1 }, { x: 18, y: 8 }))
      .toEqual({ connected: false, cost: -1 });
  });

  it('should say not connected when there is no road graph yet', () => {
    // 存檔剛載入、路網 lookup 還沒接上的那一瞬間。回 true 會比回 false 糟糕得多。
    const read = new AgentRead(
      () => createGameState(10, 10),
      noStatsBut({ roadCellGraph: () => null }),
    );

    expect(read.connected({ x: 0, y: 0 }, { x: 5, y: 5 }))
      .toEqual({ connected: false, cost: -1 });
  });
});
