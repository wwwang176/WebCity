import { describe, it, expect, vi } from 'vitest';
import {
  buildingGrowthTick,
  type BuildingGrowthTickDeps,
  type BuildingGrowthTickResult,
} from '../BuildingGrowthTick';
import { BURNED, ABANDONED } from '../InfraPlacement';
import { ZoneType } from '../../grid/types';

/** Minimal stub for Grid — only methods used by buildingGrowthTick. */
function makeGrid(cells: Map<string, any>, w = 10, h = 10) {
  return {
    width: w,
    height: h,
    getCell(x: number, y: number) { return cells.get(`${x},${y}`) ?? null; },
    setCell(x: number, y: number, patch: Record<string, unknown>) {
      const c = cells.get(`${x},${y}`);
      if (c) Object.assign(c, patch);
    },
  };
}

function makeCell(overrides: Record<string, unknown> = {}) {
  return {
    zoneType: ZoneType.RESIDENTIAL_LOW,
    buildingId: 0,
    reserved: 0,
    roadType: 0,
    roadFlags: 0,
    railType: 0,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<BuildingGrowthTickDeps> = {}): BuildingGrowthTickDeps {
  const cells = new Map<string, any>();
  return {
    grid: makeGrid(cells),
    tryGrow: vi.fn(() => false),
    rciDemand: { residential: 1, commercial: 1, industrial: 1 },
    isPowered: () => true,
    isWatered: () => true,
    hasElevatedAbove: () => false,
    getDistrictAt: () => null,
    canBuildInDistrict: () => true,
    clearPendingDeathAt: vi.fn(),
    clearPendingGarbageAt: vi.fn(),
    growthAttempts: 10,
    burnedClearanceChance: 1.0, // deterministic for testing
    getBuildingLevel: () => 1,
    randomInt: (max: number) => 0, // always pick (0,0)
    randomFloat: () => 0.5,
    ...overrides,
  };
}

describe('buildingGrowthTick', () => {
  it('returns empty result when no zone cells exist', () => {
    const deps = makeDeps();
    const result = buildingGrowthTick(deps);
    expect(result.changed).toBe(false);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  it('grows building on empty zone cell with demand', () => {
    const cells = new Map<string, any>();
    cells.set('0,0', makeCell({ zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 0 }));
    const grid = makeGrid(cells);

    const deps = makeDeps({
      grid,
      tryGrow: vi.fn(() => {
        // Simulate successful growth — mutate cell
        cells.get('0,0')!.buildingId = 100;
        return true;
      }),
      getBuildingLevel: () => 2,
      randomInt: (max: number) => 0,
    });

    const result = buildingGrowthTick(deps);
    expect(result.changed).toBe(true);
    expect(result.added).toEqual([{ x: 0, y: 0, zoneType: ZoneType.RESIDENTIAL_LOW, level: 2 }]);
  });

  it('clears burned building with configured chance', () => {
    const cells = new Map<string, any>();
    cells.set('0,0', makeCell({
      zoneType: ZoneType.COMMERCIAL_LOW,
      buildingId: 5, // zone building
      reserved: BURNED,
    }));
    const grid = makeGrid(cells);

    const deps = makeDeps({
      grid,
      burnedClearanceChance: 1.0, // always clear
      randomFloat: () => 0.0, // below 1.0 → triggers clearance
    });

    const result = buildingGrowthTick(deps);
    expect(result.changed).toBe(true);
    expect(result.removed).toEqual([{ x: 0, y: 0 }]);
    expect(deps.clearPendingDeathAt).toHaveBeenCalledWith(0, 0);
    expect(deps.clearPendingGarbageAt).toHaveBeenCalledWith(0, 0);
    // Cell should have buildingId=0, reserved=0
    expect(cells.get('0,0')!.buildingId).toBe(0);
    expect(cells.get('0,0')!.reserved).toBe(0);
  });

  it('skips burned building when random exceeds clearance chance', () => {
    const cells = new Map<string, any>();
    cells.set('0,0', makeCell({
      zoneType: ZoneType.COMMERCIAL_LOW,
      buildingId: 5,
      reserved: BURNED,
    }));
    const grid = makeGrid(cells);

    const deps = makeDeps({
      grid,
      burnedClearanceChance: 0.02,
      randomFloat: () => 0.5, // above 0.02 → no clearance
    });

    const result = buildingGrowthTick(deps);
    expect(result.changed).toBe(false);
    expect(result.removed).toHaveLength(0);
  });

  it('demolishes abandoned building then regrows when conditions met', () => {
    const cells = new Map<string, any>();
    cells.set('0,0', makeCell({
      zoneType: ZoneType.RESIDENTIAL_LOW,
      buildingId: 5,
      reserved: ABANDONED,
    }));
    const grid = makeGrid(cells);

    let growCalled = false;
    const deps = makeDeps({
      grid,
      rciDemand: { residential: 1, commercial: 0, industrial: 0 },
      tryGrow: vi.fn(() => {
        growCalled = true;
        cells.get('0,0')!.buildingId = 200;
        return true;
      }),
      getBuildingLevel: () => 1,
    });

    const result = buildingGrowthTick(deps);
    expect(result.changed).toBe(true);
    expect(growCalled).toBe(true);
    // Should first remove, then add
    expect(result.removed).toEqual([{ x: 0, y: 0 }]);
    expect(result.added).toEqual([{ x: 0, y: 0, zoneType: ZoneType.RESIDENTIAL_LOW, level: 1 }]);
  });

  it('skips abandoned building without power', () => {
    const cells = new Map<string, any>();
    cells.set('0,0', makeCell({
      zoneType: ZoneType.RESIDENTIAL_LOW,
      buildingId: 5,
      reserved: ABANDONED,
    }));
    const grid = makeGrid(cells);

    const deps = makeDeps({
      grid,
      isPowered: () => false,
    });

    const result = buildingGrowthTick(deps);
    expect(result.changed).toBe(false);
  });

  it('respects district policy restrictions', () => {
    const cells = new Map<string, any>();
    cells.set('0,0', makeCell({ zoneType: ZoneType.INDUSTRIAL, buildingId: 0 }));
    const grid = makeGrid(cells);

    const deps = makeDeps({
      grid,
      getDistrictAt: () => ({ id: 'd1' } as any),
      canBuildInDistrict: () => false,
      tryGrow: vi.fn(() => true),
    });

    const result = buildingGrowthTick(deps);
    expect(deps.tryGrow).not.toHaveBeenCalled();
  });

  it('returns affectedCells list for sidewalk update', () => {
    const cells = new Map<string, any>();
    cells.set('0,0', makeCell({ buildingId: 0 }));
    const grid = makeGrid(cells);

    const deps = makeDeps({
      grid,
      tryGrow: vi.fn(() => {
        cells.get('0,0')!.buildingId = 100;
        return true;
      }),
    });

    const result = buildingGrowthTick(deps);
    expect(result.affectedCells).toContain('0,0');
  });
});
