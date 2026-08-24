import { describe, it, expect } from 'vitest';
import {
  overlaySourceCells,
  OVERLAY_SOURCE_COLOR,
  type OverlaySourceContext,
  type OverlaySourceGrid,
} from '../OverlaySources';

/** A map where only the listed cells hold a building. Unlisted cells return null, the same as out of bounds. */
function gridWith(cells: Record<string, { buildingId: number; reserved: number }>): OverlaySourceGrid {
  return { getCell: (x, y) => cells[`${x},${y}`] ?? null };
}

type Pos = { x: number; y: number };

/** Every service starts empty and only the one under test is filled, so reading the wrong source shows up. */
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
    // 2x2: the whole building is marked. Highlighting is looked up by cell, so the anchor
    // alone would miss a multi-cell building.
    expect(keys(cells)).toEqual(['10,10', '10,11', '11,10', '11,11']);
  });

  it('多格建築整個佔地都算來源', () => {
    // The hospital is 2x3, and 3x2 rotated 90 degrees.
    const cells = overlaySourceCells(
      gridWith({ '4,7': { buildingId: 250, reserved: 5 } }),
      makeCtx({ health: [{ x: 4, y: 7 }] }),
      'health',
    );
    expect(keys(cells)).toEqual(['4,7', '4,8', '5,7', '5,8', '6,7', '6,8']);
  });

  it.each([
    ['police', 'police'],
    // The crime overlay's sources are the police stations; its red is the result of distance
    // from one.
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

    // Reading the wrong source picks up another service's facilities: every service is given a
    // position, and only the right one matches.
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
    // The facility was just demolished, or a saved position no longer lies on the map. One
    // marked cell beats missing it entirely, and it must not throw.
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
    // "Blue marks the source of influence" is one vocabulary across overlays; if this constant
    // is not blue, none of it holds.
    const r = (OVERLAY_SOURCE_COLOR >> 16) & 0xff;
    const g = (OVERLAY_SOURCE_COLOR >> 8) & 0xff;
    const b = OVERLAY_SOURCE_COLOR & 0xff;
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });
});
