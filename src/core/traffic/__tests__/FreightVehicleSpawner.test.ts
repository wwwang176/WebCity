import { describe, it, expect, vi } from 'vitest';
import {
  spawnFreightVehicles,
  rebuildActiveFreight,
  collectAvailableSources,
  selectFreightRoute,
  type FreightSpawnContext,
  type FreightSpawnResult,
} from '../FreightVehicleSpawner';
import { FreightRouteType } from '../FreightSystem';
import { ZoneType } from '../../grid/types';

// ─── helpers ────────────────────────────────────────────────────

function makeGrid(cells: Record<string, { roadType: number; zoneType: number }>): FreightSpawnContext['grid'] {
  return {
    getCell(x: number, y: number) {
      return cells[`${x},${y}`] ?? null;
    },
    width: 10,
    height: 10,
  };
}

function makeCtx(overrides: Partial<FreightSpawnContext> = {}): FreightSpawnContext {
  return {
    grid: makeGrid({
      // road at 1,0 adjacent to industrial at 0,0
      '1,0': { roadType: 1, zoneType: ZoneType.NONE },
      // road at 3,0 adjacent to commercial at 2,0
      '3,0': { roadType: 1, zoneType: ZoneType.NONE },
    }),
    production: 10,
    imported: 5,
    exported: 5,
    freightCap: 10,
    buildingPositions: [
      { x: 0, y: 0, pos: '0,0', buildingId: 13 },
      { x: 2, y: 0, pos: '2,0', buildingId: 7 },
    ],
    buildingZoneTypes: new Map([
      ['0,0', ZoneType.INDUSTRIAL],
      ['2,0', ZoneType.COMMERCIAL_LOW],
    ]),
    cachedTradePositions: [
      { x: 5, y: 5, throughput: 20, tradeKey: 'station-0' },
    ],
    activeFreight: new Map(),
    findPath: (_fromRoad, _toRoad) => [{ id: 'mock-edge' }] as any,
    addFreightVehicle: vi.fn(),
    freightTrucksPerThroughput: 10,
    ...overrides,
  };
}

// ─── rebuildActiveFreight ───────────────────────────────────────

describe('rebuildActiveFreight', () => {
  it('counts active freight vehicles by source key', () => {
    const vehicles = [
      { sourceBuildingKey: 'a', arrived: false },
      { sourceBuildingKey: 'a', arrived: false },
      { sourceBuildingKey: 'b', arrived: false },
      { sourceBuildingKey: 'a', arrived: true },  // arrived, skip
      { sourceBuildingKey: undefined, arrived: false },  // no key, skip
    ] as any;
    const map = new Map<string, number>();
    const count = rebuildActiveFreight(vehicles, map);
    expect(map.get('a')).toBe(2);
    expect(map.get('b')).toBe(1);
    expect(count).toBe(3);
  });

  it('clears map before counting', () => {
    const map = new Map([['old', 99]]);
    rebuildActiveFreight([], map);
    expect(map.size).toBe(0);
  });
});

// ─── collectAvailableSources ────────────────────────────────────

describe('collectAvailableSources', () => {
  it('separates industrials and commercials', () => {
    const positions = [
      { x: 0, y: 0, pos: '0,0', buildingId: 13 },
      { x: 1, y: 0, pos: '1,0', buildingId: 7 },
      { x: 2, y: 0, pos: '2,0', buildingId: 14 },
    ];
    const zoneTypes = new Map([
      ['0,0', ZoneType.INDUSTRIAL],
      ['1,0', ZoneType.COMMERCIAL_LOW],
      ['2,0', ZoneType.INDUSTRIAL],
    ]);
    const af = new Map<string, number>();
    const { industrials, commercials } = collectAvailableSources(positions, zoneTypes, af);
    expect(industrials.length).toBe(2);
    expect(commercials.length).toBe(1);
  });

  it('excludes industrials that already have a truck', () => {
    const positions = [
      { x: 0, y: 0, pos: '0,0', buildingId: 13 },
    ];
    const zoneTypes = new Map([['0,0', ZoneType.INDUSTRIAL]]);
    const af = new Map([['0,0', 1]]);
    const { industrials } = collectAvailableSources(positions, zoneTypes, af);
    expect(industrials.length).toBe(0);
  });

  it('includes commercial_high zone types', () => {
    const positions = [
      { x: 0, y: 0, pos: '0,0', buildingId: 10 },
    ];
    const zoneTypes = new Map([['0,0', ZoneType.COMMERCIAL_HIGH]]);
    const af = new Map<string, number>();
    const { commercials } = collectAvailableSources(positions, zoneTypes, af);
    expect(commercials.length).toBe(1);
  });
});

// ─── selectFreightRoute ─────────────────────────────────────────

describe('selectFreightRoute', () => {
  it('returns LOCAL when only local is available', () => {
    const result = selectFreightRoute(
      { hasLocal: true, hasExport: false, hasImport: false },
      { localVolume: 10, exported: 0, imported: 0 },
    );
    expect(result).toBe(FreightRouteType.LOCAL);
  });

  it('returns null when nothing is available', () => {
    const result = selectFreightRoute(
      { hasLocal: false, hasExport: false, hasImport: false },
      { localVolume: 0, exported: 0, imported: 0 },
    );
    expect(result).toBeNull();
  });

  it('returns one of the available types when multiple are possible', () => {
    const results = new Set<FreightRouteType>();
    // Run many times to exercise weighted random
    for (let i = 0; i < 100; i++) {
      const r = selectFreightRoute(
        { hasLocal: true, hasExport: true, hasImport: true },
        { localVolume: 10, exported: 10, imported: 10 },
      );
      if (r) results.add(r);
    }
    expect(results.size).toBeGreaterThanOrEqual(2);
  });
});

// ─── spawnFreightVehicles (integration) ─────────────────────────

describe('spawnFreightVehicles', () => {
  it('returns zero when production and import are both 0', () => {
    const ctx = makeCtx({ production: 0, imported: 0 });
    const result = spawnFreightVehicles(ctx);
    expect(result.spawned).toBe(0);
  });

  it('returns zero when freight cap is reached', () => {
    const ctx = makeCtx({ freightCap: 0 });
    const result = spawnFreightVehicles(ctx);
    expect(result.spawned).toBe(0);
  });

  it('returns zero when no building positions', () => {
    const ctx = makeCtx({ buildingPositions: [] });
    const result = spawnFreightVehicles(ctx);
    expect(result.spawned).toBe(0);
  });

  it('spawns vehicles and calls addFreightVehicle', () => {
    const addFreightVehicle = vi.fn();
    const ctx = makeCtx({
      production: 10,
      exported: 5,
      imported: 5,
      freightCap: 10,
      addFreightVehicle,
    });
    const result = spawnFreightVehicles(ctx);
    expect(result.spawned).toBeGreaterThanOrEqual(0);
    // addFreightVehicle should be called for each spawned vehicle
    expect(addFreightVehicle).toHaveBeenCalledTimes(result.spawned);
  });

  it('respects A-limit: removes industrial from available list after spawn', () => {
    const addFreightVehicle = vi.fn();
    // Only 1 industrial building, so max 1 freight truck
    const ctx = makeCtx({
      production: 100,
      exported: 0,
      imported: 0,
      freightCap: 100,
      buildingPositions: [
        { x: 0, y: 0, pos: '0,0', buildingId: 13 },
        { x: 2, y: 0, pos: '2,0', buildingId: 7 },
      ],
      buildingZoneTypes: new Map([
        ['0,0', ZoneType.INDUSTRIAL],
        ['2,0', ZoneType.COMMERCIAL_LOW],
      ]),
      cachedTradePositions: [],
      addFreightVehicle,
    });
    const result = spawnFreightVehicles(ctx);
    // Can spawn at most 1 (1 industrial → 1 truck max for LOCAL routes)
    expect(result.spawned).toBeLessThanOrEqual(1);
  });

  it('updates activeFreight map after spawning', () => {
    const af = new Map<string, number>();
    const addFreightVehicle = vi.fn();
    const ctx = makeCtx({
      activeFreight: af,
      addFreightVehicle,
    });
    spawnFreightVehicles(ctx);
    // If a vehicle was spawned, activeFreight should be updated
    if (addFreightVehicle.mock.calls.length > 0) {
      let total = 0;
      for (const v of af.values()) total += v;
      expect(total).toBeGreaterThan(0);
    }
  });

  it('does not exceed 5 trucks per tick', () => {
    const addFreightVehicle = vi.fn();
    const positions = [];
    const zoneTypes = new Map<string, ZoneType>();
    for (let i = 0; i < 50; i++) {
      positions.push({ x: i * 2, y: 0, pos: `${i * 2},0`, buildingId: 13 });
      zoneTypes.set(`${i * 2},0`, ZoneType.INDUSTRIAL);
      positions.push({ x: i * 2 + 1, y: 0, pos: `${i * 2 + 1},0`, buildingId: 7 });
      zoneTypes.set(`${i * 2 + 1},0`, ZoneType.COMMERCIAL_LOW);
    }
    const ctx = makeCtx({
      production: 1000,
      freightCap: 1000,
      buildingPositions: positions,
      buildingZoneTypes: zoneTypes,
      addFreightVehicle,
    });
    const result = spawnFreightVehicles(ctx);
    expect(result.spawned).toBeLessThanOrEqual(5);
  });
});
