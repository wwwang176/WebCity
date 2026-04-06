import { describe, it, expect } from 'vitest';
import type { SimWorkerMessage, SimWorkerResponse, SimulationSnapshot } from '../simulation.worker';
import type { WorkerRequest, WorkerResponse, BatchRequestItem, BatchResultItem } from '../../core/traffic/PathfindingWorkerHandler';
import { createWorkerHandler } from '../../core/traffic/PathfindingWorkerHandler';
import { LaneGraphBuffer } from '../../core/traffic/LaneGraphBuffer';
import { LaneGraph } from '../../core/traffic/LaneGraph';
import { makeGridLookup } from '../../../tests/helpers/makeGridLookup';
import { refineLanePath } from '../../core/traffic/Pathfinding';
import { RoadType, RoadDirection } from '../../core/road/types';
import { GridBuffer } from '../../core/grid/GridBuffer';
import { toPosKey } from '../../core/grid/GridHelpers';

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

describe('Pathfinding Worker Protocol (new SAB-based)', () => {
  it('should define INIT_GRAPH message with SharedArrayBuffer', () => {
    const sab = new SharedArrayBuffer(1024);
    const msg: WorkerRequest = {
      type: 'INIT_GRAPH',
      graphSAB: sab,
      maxPoints: 128,
      maxEdges: 256,
    };
    expect(msg.type).toBe('INIT_GRAPH');
    expect(msg.graphSAB.byteLength).toBe(1024);
  });

  it('should define BATCH_REQUEST message with requests', () => {
    const msg: WorkerRequest = {
      type: 'BATCH_REQUEST',
      batchId: 1,
      requests: [{
        id: 42,
        startPointIndices: [0, 1],
        endPointIndices: [5, 6],
        endPos: { x: 10, y: 5 },
        variantCount: 3,
      }],
    };
    expect(msg.requests).toHaveLength(1);
    expect(msg.requests[0]!.variantCount).toBe(3);
  });

  it('should define READY response', () => {
    const resp: WorkerResponse = { type: 'READY' };
    expect(resp.type).toBe('READY');
  });

  it('should define BATCH_RESULT response with variants', () => {
    const resp: WorkerResponse = {
      type: 'BATCH_RESULT',
      batchId: 1,
      results: [{
        id: 42,
        variants: [[0, 1, 2], [3, 4, 5]],
      }],
    };
    expect(resp.results).toHaveLength(1);
    expect(resp.results![0]!.variants).toHaveLength(2);
  });

  it('should handle null/empty variants for unreachable destinations', () => {
    const resp: WorkerResponse = {
      type: 'BATCH_RESULT',
      batchId: 99,
      results: [{ id: 1, variants: [] }],
    };
    expect(resp.results![0]!.variants).toHaveLength(0);
  });
});

describe('LaneGraph Worker Integration', () => {
  it('should serialize LaneEdge sequence (survives structured clone)', () => {
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
    const width = 10, height = 10;
    const gridBuf = new GridBuffer(width, height);

    gridBuf.setRoadType(0, 0, RoadType.TWO_LANE);
    gridBuf.setRoadFlags(0, 0, RoadDirection.EAST);
    gridBuf.setRoadType(1, 0, RoadType.TWO_LANE);
    gridBuf.setRoadFlags(1, 0, RoadDirection.WEST | RoadDirection.EAST);
    gridBuf.setRoadType(2, 0, RoadType.TWO_LANE);
    gridBuf.setRoadFlags(2, 0, RoadDirection.WEST);

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
    graph.buildFromGrid(makeGridLookup(cellMap), cellKeys);

    const path1 = refineLanePath(graph, ['0,0', '1,0', '2,0']);
    expect(path1).not.toBeNull();
    expect(path1!.length).toBeGreaterThan(0);

    gridBuf.setRoadType(3, 0, RoadType.TWO_LANE);
    gridBuf.setRoadFlags(3, 0, RoadDirection.WEST);
    gridBuf.setRoadFlags(2, 0, RoadDirection.WEST | RoadDirection.EAST);

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
    graph2.buildFromGrid(makeGridLookup(cellMap2), cellKeys2);

    const path2 = refineLanePath(graph2, ['0,0', '1,0', '2,0', '3,0']);
    expect(path2).not.toBeNull();
    expect(path2!.length).toBeGreaterThan(path1!.length);
  });
});
