import { describe, it, expect } from 'vitest';
import { HighwayConnection, HIGHWAY_EXTERNAL } from '../HighwayConnection';
import { RoadType } from '../../road/types';

/** Minimal grid stub for testing. */
function makeGrid(width: number, height: number, cells: Map<string, { roadType: number }>) {
  return {
    width,
    height,
    getCell(x: number, y: number) {
      return cells.get(`${x},${y}`) ?? null;
    },
  };
}

function setCell(cells: Map<string, { roadType: number }>, x: number, y: number, roadType: number) {
  cells.set(`${x},${y}`, { roadType });
}

describe('HighwayConnection', () => {
  it('has no connection when grid has no highway at edges', () => {
    const hc = new HighwayConnection();
    const grid = makeGrid(10, 10, new Map());
    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(false);
    expect(hc.getEdgeHighwayCellCount()).toBe(0);
  });

  it('detects highway at north edge (y=0)', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, { roadType: number }>();
    setCell(cells, 5, 0, RoadType.HIGHWAY);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(true);
    expect(hc.getEdgeHighwayCellCount()).toBe(1);
    expect(hc.getEdgeHighwayCells()).toEqual([{ x: 5, y: 0 }]);
  });

  it('detects highway at south edge (y=height-1)', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, { roadType: number }>();
    setCell(cells, 3, 9, RoadType.HIGHWAY);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(true);
    expect(hc.getEdgeHighwayCells()).toEqual([{ x: 3, y: 9 }]);
  });

  it('detects highway at west edge (x=0)', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, { roadType: number }>();
    setCell(cells, 0, 5, RoadType.HIGHWAY);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(true);
    expect(hc.getEdgeHighwayCells()).toEqual([{ x: 0, y: 5 }]);
  });

  it('detects highway at east edge (x=width-1)', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, { roadType: number }>();
    setCell(cells, 9, 4, RoadType.HIGHWAY);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(true);
    expect(hc.getEdgeHighwayCells()).toEqual([{ x: 9, y: 4 }]);
  });

  it('ignores non-highway road at edge', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, { roadType: number }>();
    setCell(cells, 5, 0, RoadType.TWO_LANE);
    setCell(cells, 0, 5, RoadType.FOUR_LANE);
    setCell(cells, 9, 5, RoadType.SIX_LANE);
    setCell(cells, 5, 9, RoadType.RURAL);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(false);
    expect(hc.getEdgeHighwayCellCount()).toBe(0);
  });

  it('ignores highway not at edge', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, { roadType: number }>();
    setCell(cells, 5, 5, RoadType.HIGHWAY); // center — not at edge
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(false);
  });

  it('detects multiple edge highways', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, { roadType: number }>();
    setCell(cells, 2, 0, RoadType.HIGHWAY); // north
    setCell(cells, 9, 3, RoadType.HIGHWAY); // east
    setCell(cells, 0, 7, RoadType.HIGHWAY); // west
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(true);
    expect(hc.getEdgeHighwayCellCount()).toBe(3);
  });

  it('throughput scales linearly with edge cell count', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, { roadType: number }>();
    setCell(cells, 2, 0, RoadType.HIGHWAY);
    setCell(cells, 3, 0, RoadType.HIGHWAY);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.getThroughput()).toBe(2 * HIGHWAY_EXTERNAL.THROUGHPUT_PER_CONNECTION);
  });

  it('externalConnection values scale with edge cell count', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, { roadType: number }>();
    setCell(cells, 5, 0, RoadType.HIGHWAY);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.externalConnection.populationIn).toBeGreaterThan(0);
    expect(hc.externalConnection.goodsIn).toBeGreaterThan(0);
    expect(hc.externalConnection.goodsOut).toBeGreaterThan(0);
  });

  it('resets state when highway is removed', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, { roadType: number }>();
    setCell(cells, 5, 0, RoadType.HIGHWAY);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(true);

    // Remove the highway
    cells.delete('5,0');
    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(false);
    expect(hc.getEdgeHighwayCellCount()).toBe(0);
    expect(hc.externalConnection.populationIn).toBe(0);
  });

  it('corner cells (0,0) are detected', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, { roadType: number }>();
    setCell(cells, 0, 0, RoadType.HIGHWAY);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(true);
    // Corner is on both top and left edge; should appear only once
    expect(hc.getEdgeHighwayCellCount()).toBe(1);
  });

  describe('serialization', () => {
    it('toJSON/fromJSON round-trip preserves state', () => {
      const hc = new HighwayConnection();
      const cells = new Map<string, { roadType: number }>();
      setCell(cells, 5, 0, RoadType.HIGHWAY);
      setCell(cells, 9, 3, RoadType.HIGHWAY);
      const grid = makeGrid(10, 10, cells);
      hc.updateExternalConnection(10, 10, grid);

      const json = hc.toJSON();
      const restored = HighwayConnection.fromJSON(json);

      expect(restored.hasExternalConnection).toBe(hc.hasExternalConnection);
      expect(restored.externalConnection).toEqual(hc.externalConnection);
    });

    it('fromJSON handles missing data gracefully', () => {
      const restored = HighwayConnection.fromJSON({
        hasExternalConnection: false,
        externalConnection: { populationIn: 0, goodsIn: 0, goodsOut: 0 },
      });
      expect(restored.hasExternalConnection).toBe(false);
    });
  });
});
