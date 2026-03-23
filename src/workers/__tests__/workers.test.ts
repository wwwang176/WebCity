import { describe, it, expect } from 'vitest';
import type { SimWorkerMessage, SimWorkerResponse, SimulationSnapshot } from '../simulation.worker';
import type { PathWorkerMessage, PathWorkerResponse, SerializedLaneEdge } from '../pathfinding.worker';
import { buildLaneGraphFromGrid } from '../pathfinding.worker';
import { LaneGraph } from '../../core/traffic/LaneGraph';
import { makeGridLookup } from '../../../tests/helpers/makeGridLookup';
import { refineLanePath } from '../../core/traffic/Pathfinding';
import { RoadType, RoadDirection } from '../../core/road/types';
import { GridBuffer } from '../../core/grid/GridBuffer';

describe('Simulation Worker Protocol', () => {
  it('should define INIT message type', () => {
    const msg: SimWorkerMessage = { type: 'INIT' };
    expect(msg.type).toBe('INIT');
  });

  it('should define TICK message type', () => {
    const msg: SimWorkerMessage = { type: 'TICK' };
    expect(msg.type).toBe('TICK');
  });

  it('should define PAUSE/RESUME message types', () => {
    const pause: SimWorkerMessage = { type: 'PAUSE' };
    const resume: SimWorkerMessage = { type: 'RESUME' };
    expect(pause.type).toBe('PAUSE');
    expect(resume.type).toBe('RESUME');
  });

  it('should define SET_SPEED message type', () => {
    const msg: SimWorkerMessage = { type: 'SET_SPEED', speed: 3 };
    expect(msg.speed).toBe(3);
  });

  it('should define TICK_COMPLETE response with snapshot', () => {
    const snapshot: SimulationSnapshot = {
      tick: 10,
      population: 500,
      funds: 30000,
      income: 200,
      expenses: 150,
      happiness: 70,
      rciDemand: { residential: 60, commercial: 40, industrial: 50 },
      vehicleCount: 25,
    };
    const resp: SimWorkerResponse = { type: 'TICK_COMPLETE', tick: 10, data: snapshot };
    expect(resp.type).toBe('TICK_COMPLETE');
    expect(resp.data!.population).toBe(500);
    expect(resp.data!.vehicleCount).toBe(25);
  });
});

describe('Pathfinding Worker Protocol', () => {
  it('should send FIND_PATH request with from/to coordinates', () => {
    const msg: PathWorkerMessage = {
      type: 'FIND_PATH',
      id: 1,
      from: { x: 5, y: 10 },
      to: { x: 20, y: 10 },
    };
    expect(msg.id).toBe(1);
    expect(msg.from!.x).toBe(5);
    expect(msg.to!.y).toBe(10);
  });

  it('should handle multiple concurrent path requests with unique ids', () => {
    const requests: PathWorkerMessage[] = [];
    for (let i = 0; i < 10; i++) {
      requests.push({
        type: 'FIND_PATH',
        id: i,
        from: { x: 0, y: 0 },
        to: { x: i + 1, y: 0 },
      });
    }
    expect(requests).toHaveLength(10);
    const ids = new Set(requests.map(r => r.id));
    expect(ids.size).toBe(10); // all unique
  });

  it('should define SET_GRID message for SharedArrayBuffer', () => {
    const sab = new SharedArrayBuffer(100 * 100 * 12);
    const msg: PathWorkerMessage = {
      type: 'SET_GRID',
      width: 100,
      height: 100,
      gridData: sab,
    };
    expect(msg.width).toBe(100);
    expect(msg.gridData!.byteLength).toBe(120000);
  });

  it('should define PATH_RESULT response', () => {
    const resp: PathWorkerResponse = {
      type: 'PATH_RESULT',
      id: 5,
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    };
    expect(resp.path).toHaveLength(3);
    expect(resp.id).toBe(5);
  });

  it('should handle null path for unreachable destination', () => {
    const resp: PathWorkerResponse = {
      type: 'PATH_RESULT',
      id: 99,
      path: null,
    };
    expect(resp.path).toBeNull();
  });

  it('should define BUILD_LANE_GRAPH message type', () => {
    const msg: PathWorkerMessage = { type: 'BUILD_LANE_GRAPH' };
    expect(msg.type).toBe('BUILD_LANE_GRAPH');
  });

  it('should define REFINE_LANE_PATH message with cellPath and preferredLane', () => {
    const msg: PathWorkerMessage = {
      type: 'REFINE_LANE_PATH',
      id: 42,
      cellPath: ['0,0', '1,0', '2,0'],
      preferredLane: 1,
    };
    expect(msg.cellPath).toHaveLength(3);
    expect(msg.preferredLane).toBe(1);
  });

  it('should define LANE_GRAPH_READY response', () => {
    const resp: PathWorkerResponse = { type: 'LANE_GRAPH_READY' };
    expect(resp.type).toBe('LANE_GRAPH_READY');
  });

  it('should define LANE_PATH_RESULT response with serialized edges', () => {
    const edge: SerializedLaneEdge = {
      id: '0,0:east:0:exit->1,0:west:0:entry',
      from: {
        id: '0,0:east:0:exit', position: { x: 0.5, y: 0 },
        tangent: { tx: 1, ty: 0 }, cellKey: '0,0', lane: 0,
        direction: 'east', type: 'exit',
      },
      to: {
        id: '1,0:west:0:entry', position: { x: 0.5, y: 0 },
        tangent: { tx: 1, ty: 0 }, cellKey: '1,0', lane: 0,
        direction: 'west', type: 'entry',
      },
      length: 1.0,
      type: 'straight',
    };
    const resp: PathWorkerResponse = {
      type: 'LANE_PATH_RESULT',
      id: 42,
      edgePath: [edge],
    };
    expect(resp.edgePath).toHaveLength(1);
    expect(resp.edgePath![0]!.type).toBe('straight');
  });
});

describe('LaneGraph Worker Integration', () => {
  it('should serialize LaneEdge sequence (survives structured clone)', () => {
    // Build a simple graph and get edges
    const cells = new Map<string, { roadType: RoadType; roadFlags: number }>();
    for (let x = 0; x < 3; x++) {
      let flags = 0;
      if (x > 0) flags |= RoadDirection.WEST;
      if (x < 2) flags |= RoadDirection.EAST;
      cells.set(`${x},0`, { roadType: RoadType.TWO_LANE, roadFlags: flags });
    }
    const graph = new LaneGraph();
    graph.buildFromGrid(
      makeGridLookup(cells),
      ['0,0', '1,0', '2,0'],
    );

    const edgePath = refineLanePath(graph, ['0,0', '1,0', '2,0']);
    expect(edgePath).not.toBeNull();

    // Simulate structured clone (JSON round-trip is a subset of structured clone)
    const serialized = JSON.parse(JSON.stringify(edgePath));
    expect(serialized).toHaveLength(edgePath!.length);
    for (let i = 0; i < serialized.length; i++) {
      expect(serialized[i].from.cellKey).toBe(edgePath![i]!.from.cellKey);
      expect(serialized[i].to.cellKey).toBe(edgePath![i]!.to.cellKey);
      expect(serialized[i].type).toBe(edgePath![i]!.type);
      expect(serialized[i].length).toBeCloseTo(edgePath![i]!.length, 5);
    }
  });

  it('should rebuild LaneGraph from GridBuffer data after road change', () => {
    // Simulate: build grid → set road → build graph → add road → rebuild graph
    const width = 10, height = 10;
    const gridBuf = new GridBuffer(width, height);

    // Place a 3-cell road
    gridBuf.setRoadType(0, 0, RoadType.TWO_LANE);
    gridBuf.setRoadFlags(0, 0, RoadDirection.EAST);
    gridBuf.setRoadType(1, 0, RoadType.TWO_LANE);
    gridBuf.setRoadFlags(1, 0, RoadDirection.WEST | RoadDirection.EAST);
    gridBuf.setRoadType(2, 0, RoadType.TWO_LANE);
    gridBuf.setRoadFlags(2, 0, RoadDirection.WEST);

    // Build graph from GridBuffer (simulating what worker does)
    const cellMap = new Map<string, { roadType: number; roadFlags: number }>();
    const cellKeys: string[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const rt = gridBuf.getRoadType(x, y);
        if (rt > 0) {
          const key = `${x},${y}`;
          cellKeys.push(key);
          cellMap.set(key, { roadType: rt, roadFlags: gridBuf.getRoadFlags(x, y) });
        }
      }
    }

    const graph = new LaneGraph();
    graph.buildFromGrid(
      makeGridLookup(cellMap),
      cellKeys,
    );

    const path1 = refineLanePath(graph, ['0,0', '1,0', '2,0']);
    expect(path1).not.toBeNull();
    expect(path1!.length).toBeGreaterThan(0);

    // Add another road cell and rebuild
    gridBuf.setRoadType(3, 0, RoadType.TWO_LANE);
    gridBuf.setRoadFlags(3, 0, RoadDirection.WEST);
    // Update cell 2,0 to connect east
    gridBuf.setRoadFlags(2, 0, RoadDirection.WEST | RoadDirection.EAST);

    // Rebuild
    const cellMap2 = new Map<string, { roadType: number; roadFlags: number }>();
    const cellKeys2: string[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const rt = gridBuf.getRoadType(x, y);
        if (rt > 0) {
          const key = `${x},${y}`;
          cellKeys2.push(key);
          cellMap2.set(key, { roadType: rt, roadFlags: gridBuf.getRoadFlags(x, y) });
        }
      }
    }

    const graph2 = new LaneGraph();
    graph2.buildFromGrid(
      makeGridLookup(cellMap2),
      cellKeys2,
    );

    const path2 = refineLanePath(graph2, ['0,0', '1,0', '2,0', '3,0']);
    expect(path2).not.toBeNull();
    expect(path2!.length).toBeGreaterThan(path1!.length);
  });
});
