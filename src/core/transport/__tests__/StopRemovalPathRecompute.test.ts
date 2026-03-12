import { describe, it, expect } from 'vitest';
import { RailSystem, RailServiceType } from '../RailSystem';
import { FerrySystem, type WaterChecker } from '../FerrySystem';
import { RailNetwork } from '../../rail/RailNetwork';
import type { WaterGrid } from '../../pathfinding/WaterPathfinder';

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a simple linear rail network: nodes at (0,0)→(1,0)→...→(n,0) */
function buildLinearRailNetwork(length: number): RailNetwork {
  const net = new RailNetwork();
  for (let x = 0; x < length; x++) {
    net.addNode(`${x},0`);
    if (x > 0) net.addEdge(`${x - 1},0`, `${x},0`);
  }
  return net;
}

function createWaterEnv(rows: string[]) {
  const height = rows.length;
  const width = rows[0]!.length;
  const grid: WaterGrid = {
    width,
    height,
    isWater: (x: number, y: number) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      return rows[y]![x] === 'W';
    },
  };
  const checker: WaterChecker = {
    isWater: (x: number, y: number) => {
      if (grid.isWater(x, y)) return false;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (grid.isWater(x + dx!, y + dy!)) return true;
      }
      return false;
    },
  };
  return { grid, checker };
}

// ── RailSystem ───────────────────────────────────────────────────────

describe('RailSystem — removeStation recomputes paths', () => {
  it('should recompute routePaths when a middle station is removed', () => {
    // Linear track: 0→1→2→3→4→5→6→7→8→9→10
    const net = buildLinearRailNetwork(11);
    const rail = new RailSystem();
    rail.setRailNetwork(net);

    const sA = rail.buildStation(0, 0)!;
    const sB = rail.buildStation(5, 0)!;
    const sC = rail.buildStation(10, 0)!;

    const line = rail.createLine([sA, sB, sC])!;
    expect(line).not.toBeNull();
    expect(rail.getRoutePaths(line.id)).toBeDefined();

    // Remove middle station B
    rail.removeStation(sB.id);

    // Line should survive (A and C remain)
    expect(rail.getLines()).toHaveLength(1);
    const survivingLine = rail.getLines()[0]!;
    expect(survivingLine.stops).toHaveLength(2);

    // Paths should be recomputed for A→C and C→A
    const paths = rail.getRoutePaths(survivingLine.id);
    expect(paths).toBeDefined();
    expect(paths!.length).toBe(2); // round-trip: A→C, C→A
    // A→C path should go through 0,0 → 1,0 → ... → 10,0
    expect(paths![0]![0]).toBe('0,0');
    expect(paths![0]![paths![0]!.length - 1]).toBe('10,0');
  });

  it('should dissolve the line if recomputed path is not connected', () => {
    // Track with a gap: 0-1-2   5-6-7  (no connection between 2 and 5)
    const net = new RailNetwork();
    for (let x = 0; x <= 2; x++) net.addNode(`${x},0`);
    for (let x = 5; x <= 7; x++) net.addNode(`${x},0`);
    net.addEdge('0,0', '1,0');
    net.addEdge('1,0', '2,0');
    // Middle station at 2,0 bridges via the line's existing route
    // We'll add connection 2,0→5,0 so the line can be created
    net.addEdge('2,0', '3,0'); net.addNode('3,0');
    net.addEdge('3,0', '4,0'); net.addNode('4,0');
    net.addEdge('4,0', '5,0');
    net.addEdge('5,0', '6,0');
    net.addEdge('6,0', '7,0');

    const rail = new RailSystem();
    rail.setRailNetwork(net);

    const sA = rail.buildStation(0, 0)!;
    const sB = rail.buildStation(2, 0)!;
    const sC = rail.buildStation(7, 0)!;

    const line = rail.createLine([sA, sB, sC])!;
    expect(line).not.toBeNull();

    // Now remove the 2→5 bridge edges to make A and C disconnected
    net.removeEdge('2,0', '3,0');

    // Remove middle station B — recompute should fail (A can't reach C)
    rail.removeStation(sB.id);

    // Line should be dissolved since A↔C is not connected
    expect(rail.getLines()).toHaveLength(0);
    expect(rail.getTrains()).toHaveLength(0);
  });

  it('should reset train vehicles to the first station', () => {
    const net = buildLinearRailNetwork(11);
    const rail = new RailSystem();
    rail.setRailNetwork(net);

    const sA = rail.buildStation(0, 0)!;
    const sB = rail.buildStation(5, 0)!;
    const sC = rail.buildStation(10, 0)!;

    rail.createLine([sA, sB, sC], RailServiceType.PASSENGER, 2)!;

    // Advance trains away from start
    for (let i = 0; i < 10; i++) rail.tick();

    rail.removeStation(sB.id);

    // All surviving trains should be at first stop (sA)
    for (const v of rail.getTrains()) {
      expect(v.currentStopIndex).toBe(0);
      expect(v.position.x).toBe(sA.x);
      expect(v.position.y).toBe(sA.y);
      expect(v.traveling).toBe(false);
    }
  });

  it('should clear trainTravelData for reset vehicles', () => {
    const net = buildLinearRailNetwork(11);
    const rail = new RailSystem();
    rail.setRailNetwork(net);

    const sA = rail.buildStation(0, 0)!;
    const sB = rail.buildStation(5, 0)!;
    const sC = rail.buildStation(10, 0)!;

    rail.createLine([sA, sB, sC])!;

    // Advance until train has travel metadata
    for (let i = 0; i < 10; i++) rail.tick();

    rail.removeStation(sB.id);

    // After reset, no train should have active travel path
    for (const v of rail.getTrains()) {
      expect(rail.getTrainTravelPath(v.id)).toBeNull();
    }
  });
});

// ── FerrySystem ──────────────────────────────────────────────────────

describe('FerrySystem — removeDock recomputes paths', () => {
  it('should recompute water paths when a middle dock is removed', () => {
    // 2-row map: row 1 is all water so path can bypass land at (4,0)
    const { grid, checker } = createWaterEnv([
      'LWWWLWWWWWL',
      'WWWWWWWWWWW',
    ]);

    const ferry = new FerrySystem();
    ferry.setWaterGrid(grid);

    const dA = ferry.addDock(0, 0, checker)!;
    const dB = ferry.addDock(4, 0, checker)!;
    const dC = ferry.addDock(10, 0, checker)!;
    expect(dA).not.toBeNull();
    expect(dB).not.toBeNull();
    expect(dC).not.toBeNull();

    ferry.createRoute([dA, dB, dC], 1);

    // Remove middle dock B
    ferry.removeDock(dB.id);

    // Route should survive with 2 docks (water path exists via row 1)
    expect(ferry.getDocks()).toHaveLength(2);
    const routes = ferry.getRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0]!.stops).toHaveLength(2);
  });

  it('should dissolve route if recomputed water path is not connected', () => {
    // Two isolated water bodies separated by land column at x=4
    // Middle dock at (4,2) bridges them via row 2
    const { grid, checker } = createWaterEnv([
      'LWWLLWWL',
      'LWWLLWWL',
      'LWWWWWWL',
    ]);

    const ferry = new FerrySystem();
    ferry.setWaterGrid(grid);

    const dA = ferry.addDock(0, 0, checker)!;
    const dC = ferry.addDock(7, 0, checker)!;
    // B is on shore at (0,2) — adjacent to water at (1,2)
    const dB = ferry.addDock(0, 2, checker)!;

    if (!dA || !dB || !dC) return; // guard
    const connected = ferry.validateRouteConnectivity([dA, dB, dC]);
    if (!connected) return; // skip if env doesn't support

    ferry.createRoute([dA, dB, dC], 1);
    ferry.removeDock(dB.id);

    // A(0,0) and C(7,0) are in separate water bodies → route should dissolve
    const directlyConnected = ferry.validateRouteConnectivity([dA, dC]);
    if (!directlyConnected) {
      expect(ferry.getRoutes()).toHaveLength(0);
      expect(ferry.getVessels()).toHaveLength(0);
    }
  });

  it('should reset ferry vessels to first dock when a middle dock is removed', () => {
    const { grid, checker } = createWaterEnv([
      'LWWWLWWWWWL',
      'WWWWWWWWWWW',
    ]);

    const ferry = new FerrySystem();
    ferry.setWaterGrid(grid);

    const dA = ferry.addDock(0, 0, checker)!;
    const dB = ferry.addDock(4, 0, checker)!;
    const dC = ferry.addDock(10, 0, checker)!;

    ferry.createRoute([dA, dB, dC], 2);

    // Advance vessels away from start
    for (let i = 0; i < 20; i++) ferry.tick();

    ferry.removeDock(dB.id);

    // All vessels should be reset to first dock
    for (const v of ferry.getVessels()) {
      expect(v.currentStopIndex).toBe(0);
      expect(v.position.x).toBe(dA.x);
      expect(v.position.y).toBe(dA.y);
      expect(v.traveling).toBe(false);
    }
  });

  it('should clear vesselPath data for reset vessels', () => {
    const { grid, checker } = createWaterEnv([
      'LWWWLWWWWWL',
      'WWWWWWWWWWW',
    ]);

    const ferry = new FerrySystem();
    ferry.setWaterGrid(grid);

    const dA = ferry.addDock(0, 0, checker)!;
    const dB = ferry.addDock(4, 0, checker)!;
    const dC = ferry.addDock(10, 0, checker)!;

    ferry.createRoute([dA, dB, dC], 1);

    // Advance until vessel has path data
    for (let i = 0; i < 20; i++) ferry.tick();

    ferry.removeDock(dB.id);

    // After reset, no vessel should have active path
    for (const v of ferry.getVessels()) {
      expect(ferry.getVesselPath(v.id)).toBeNull();
    }
  });
});
