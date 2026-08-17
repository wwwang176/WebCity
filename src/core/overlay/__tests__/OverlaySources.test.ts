import { describe, it, expect } from 'vitest';
import {
  overlaySourceCells,
  OVERLAY_SOURCE_COLOR,
  type OverlaySourceContext,
  type OverlaySourceGrid,
} from '../OverlaySources';

/** 一張只有指定格子有建築的地圖。沒列到的格子回 null，等同界外。 */
function gridWith(cells: Record<string, { buildingId: number; reserved: number }>): OverlaySourceGrid {
  return { getCell: (x, y) => cells[`${x},${y}`] ?? null };
}

type Pos = { x: number; y: number };

/** 每一種服務預設都是空的，測哪一個就只給哪一個，這樣才看得出讀錯來源。 */
function makeCtx(over: Partial<Record<
  'power' | 'water' | 'police' | 'fire' | 'health' | 'education' | 'parks' | 'garbage' | 'transit',
  Pos[]
>>): OverlaySourceContext {
  return {
    power: { getPlants: () => over.power ?? [] },
    water: { getPlants: () => over.water ?? [] },
    police: { getStations: () => over.police ?? [] },
    fire: { getStations: () => over.fire ?? [] },
    health: { getHospitals: () => over.health ?? [] },
    education: { getSchools: () => over.education ?? [] },
    parks: { getParks: () => over.parks ?? [] },
    garbage: { getFacilities: () => over.garbage ?? [] },
    transitStops: over.transit ?? [],
  };
}

const keys = (cells: readonly Pos[]) => cells.map(c => `${c.x},${c.y}`).sort();

describe('overlaySourceCells', () => {
  it('消防圖層標出消防局本身', () => {
    const cells = overlaySourceCells(
      gridWith({ '10,10': { buildingId: 251, reserved: 0 } }),
      makeCtx({ fire: [{ x: 10, y: 10 }] }),
      'fire',
    );
    // 2×2:整棟都要標。只標錨點的話，高亮是照格子查的，多格建築會查不到。
    expect(keys(cells)).toEqual(['10,10', '10,11', '11,10', '11,11']);
  });

  it('多格建築整個佔地都算來源', () => {
    // 醫院 2×3，轉 90 度變 3×2。
    const cells = overlaySourceCells(
      gridWith({ '4,7': { buildingId: 250, reserved: 5 } }),
      makeCtx({ health: [{ x: 4, y: 7 }] }),
      'health',
    );
    expect(keys(cells)).toEqual(['4,7', '4,8', '5,7', '5,8', '6,7', '6,8']);
  });

  it.each([
    ['police', 'police'],
    // 犯罪率的製造點是治安的來源 —— 圖上的紅色是「這裡離警局多遠」的結果。
    ['crime', 'police'],
    ['fire', 'fire'],
    ['health', 'health'],
    ['education', 'education'],
    ['park', 'parks'],
    ['garbage', 'garbage'],
    ['power', 'power'],
    ['water', 'water'],
    ['commute', 'transit'],
  ] as const)('%s 圖層讀 %s 的設施', (overlay, service) => {
    const grid = gridWith({});
    const ctx = makeCtx({ [service]: [{ x: 3, y: 4 }] });
    expect(overlaySourceCells(grid, ctx, overlay)).toEqual([{ x: 3, y: 4 }]);

    // 讀錯來源就會抓到別人的設施:所有服務都給一個位置，只有自己那一個對得上。
    const all = makeCtx({
      power: [{ x: 1, y: 1 }], water: [{ x: 2, y: 2 }], police: [{ x: 3, y: 3 }],
      fire: [{ x: 4, y: 4 }], health: [{ x: 5, y: 5 }], education: [{ x: 6, y: 6 }],
      parks: [{ x: 7, y: 7 }], garbage: [{ x: 8, y: 8 }], transit: [{ x: 9, y: 9 }],
    });
    const expected = {
      power: 1, water: 2, police: 3, fire: 4, health: 5,
      education: 6, parks: 7, garbage: 8, transit: 9,
    }[service];
    expect(overlaySourceCells(grid, all, overlay)).toEqual([{ x: expected, y: expected }]);
  });

  it.each(['zone', 'pollution', 'landValue', 'traffic', 'district', 'none', 'not-an-overlay'])(
    '%s 沒有可以指的製造點',
    (overlay) => {
      const all = makeCtx({
        power: [{ x: 1, y: 1 }], water: [{ x: 2, y: 2 }], police: [{ x: 3, y: 3 }],
        fire: [{ x: 4, y: 4 }], health: [{ x: 5, y: 5 }], education: [{ x: 6, y: 6 }],
        parks: [{ x: 7, y: 7 }], garbage: [{ x: 8, y: 8 }], transit: [{ x: 9, y: 9 }],
      });
      expect(overlaySourceCells(gridWith({}), all, overlay)).toEqual([]);
    },
  );

  it('查不到那一格就只標錨點', () => {
    // 設施剛被拆、或存檔裡的位置已經不在地圖上。標一格總比整個漏掉好，也不能爆掉。
    const cells = overlaySourceCells(gridWith({}), makeCtx({ fire: [{ x: 10, y: 10 }] }), 'fire');
    expect(cells).toEqual([{ x: 10, y: 10 }]);
  });

  it('多座設施各自標各自的', () => {
    const cells = overlaySourceCells(
      gridWith({}),
      makeCtx({ police: [{ x: 1, y: 2 }, { x: 30, y: 40 }] }),
      'police',
    );
    expect(keys(cells)).toEqual(['1,2', '30,40']);
  });
});

describe('OVERLAY_SOURCE_COLOR', () => {
  it('是藍的', () => {
    // 「藍色＝影響的製造點」是跨圖層的一致語彙。這個常數不藍，整套就不成立。
    const r = (OVERLAY_SOURCE_COLOR >> 16) & 0xff;
    const g = (OVERLAY_SOURCE_COLOR >> 8) & 0xff;
    const b = OVERLAY_SOURCE_COLOR & 0xff;
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });
});
