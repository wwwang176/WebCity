import { describe, it, expect } from 'vitest';
import { HighwayConnection, HIGHWAY_EXTERNAL } from '../HighwayConnection';
import { RoadType, RoadDirection } from '../../road/types';

interface CellStub { roadType: number; roadFlags: number }

/** Minimal grid stub for testing. */
function makeGrid(width: number, height: number, cells: Map<string, CellStub>) {
  return {
    width,
    height,
    getCell(x: number, y: number) {
      return cells.get(`${x},${y}`) ?? null;
    },
  };
}

function setCell(cells: Map<string, CellStub>, x: number, y: number, roadType: number, roadFlags: number) {
  cells.set(`${x},${y}`, { roadType, roadFlags });
}

describe('HighwayConnection', () => {
  it('has no connection when grid has no highway at edges', () => {
    const hc = new HighwayConnection();
    const grid = makeGrid(10, 10, new Map());
    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(false);
    expect(hc.getEdgeHighwayCellCount()).toBe(0);
  });

  it('detects highway at north edge (y=0) with SOUTH flag', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, CellStub>();
    setCell(cells, 5, 0, RoadType.HIGHWAY, RoadDirection.SOUTH);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(true);
    expect(hc.getEdgeHighwayCellCount()).toBe(1);
    expect(hc.getEdgeHighwayCells()).toEqual([{ x: 5, y: 0 }]);
  });

  it('detects highway at south edge (y=height-1) with NORTH flag', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, CellStub>();
    setCell(cells, 3, 9, RoadType.HIGHWAY, RoadDirection.NORTH);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(true);
    expect(hc.getEdgeHighwayCells()).toEqual([{ x: 3, y: 9 }]);
  });

  it('detects highway at west edge (x=0) with EAST flag', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, CellStub>();
    setCell(cells, 0, 5, RoadType.HIGHWAY, RoadDirection.EAST);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(true);
    expect(hc.getEdgeHighwayCells()).toEqual([{ x: 0, y: 5 }]);
  });

  it('detects highway at east edge (x=width-1) with WEST flag', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, CellStub>();
    setCell(cells, 9, 4, RoadType.HIGHWAY, RoadDirection.WEST);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(true);
    expect(hc.getEdgeHighwayCells()).toEqual([{ x: 9, y: 4 }]);
  });

  it('ignores highway at edge with only parallel flags (no inward)', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, CellStub>();
    // Highway along north edge running east-west — no SOUTH flag
    setCell(cells, 3, 0, RoadType.HIGHWAY, RoadDirection.EAST | RoadDirection.WEST);
    setCell(cells, 4, 0, RoadType.HIGHWAY, RoadDirection.EAST | RoadDirection.WEST);
    setCell(cells, 5, 0, RoadType.HIGHWAY, RoadDirection.EAST | RoadDirection.WEST);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(false);
    expect(hc.getEdgeHighwayCellCount()).toBe(0);
  });

  it('detects only the cell with inward flag in a parallel highway', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, CellStub>();
    // Highway along north edge, but cell (5,0) also branches south
    setCell(cells, 3, 0, RoadType.HIGHWAY, RoadDirection.EAST);
    setCell(cells, 4, 0, RoadType.HIGHWAY, RoadDirection.EAST | RoadDirection.WEST);
    setCell(cells, 5, 0, RoadType.HIGHWAY, RoadDirection.WEST | RoadDirection.SOUTH); // inward!
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(true);
    expect(hc.getEdgeHighwayCellCount()).toBe(1);
    expect(hc.getEdgeHighwayCells()).toEqual([{ x: 5, y: 0 }]);
  });

  it('ignores non-highway road at edge', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, CellStub>();
    setCell(cells, 5, 0, RoadType.TWO_LANE, RoadDirection.SOUTH);
    setCell(cells, 0, 5, RoadType.FOUR_LANE, RoadDirection.EAST);
    setCell(cells, 9, 5, RoadType.SIX_LANE, RoadDirection.WEST);
    setCell(cells, 5, 9, RoadType.RURAL, RoadDirection.NORTH);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(false);
    expect(hc.getEdgeHighwayCellCount()).toBe(0);
  });

  it('ignores highway not at edge', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, CellStub>();
    setCell(cells, 5, 5, RoadType.HIGHWAY, RoadDirection.NORTH | RoadDirection.SOUTH);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(false);
  });

  it('detects multiple edge highways with inward flags', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, CellStub>();
    setCell(cells, 2, 0, RoadType.HIGHWAY, RoadDirection.SOUTH);  // north edge
    setCell(cells, 9, 3, RoadType.HIGHWAY, RoadDirection.WEST);   // east edge
    setCell(cells, 0, 7, RoadType.HIGHWAY, RoadDirection.EAST);   // west edge
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(true);
    expect(hc.getEdgeHighwayCellCount()).toBe(3);
  });

  it('throughput scales linearly with edge cell count', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, CellStub>();
    setCell(cells, 2, 0, RoadType.HIGHWAY, RoadDirection.SOUTH);
    setCell(cells, 3, 0, RoadType.HIGHWAY, RoadDirection.SOUTH);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.getThroughput()).toBe(2 * HIGHWAY_EXTERNAL.THROUGHPUT_PER_CONNECTION);
  });

  it('externalConnection values scale with edge cell count', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, CellStub>();
    setCell(cells, 5, 0, RoadType.HIGHWAY, RoadDirection.SOUTH);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.externalConnection.populationIn).toBeGreaterThan(0);
    expect(hc.externalConnection.goodsIn).toBeGreaterThan(0);
    expect(hc.externalConnection.goodsOut).toBeGreaterThan(0);
  });

  it('resets state when highway is removed', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, CellStub>();
    setCell(cells, 5, 0, RoadType.HIGHWAY, RoadDirection.SOUTH);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(true);

    cells.delete('5,0');
    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(false);
    expect(hc.getEdgeHighwayCellCount()).toBe(0);
    expect(hc.externalConnection.populationIn).toBe(0);
  });

  it('corner cell with inward flag is detected', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, CellStub>();
    // Corner (0,0) with EAST flag → inward from west edge
    setCell(cells, 0, 0, RoadType.HIGHWAY, RoadDirection.EAST);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(true);
    expect(hc.getEdgeHighwayCellCount()).toBe(1);
  });

  it('corner cell without inward flag is ignored', () => {
    const hc = new HighwayConnection();
    const cells = new Map<string, CellStub>();
    // Corner (0,0) with no flags — isolated highway cell
    setCell(cells, 0, 0, RoadType.HIGHWAY, 0);
    const grid = makeGrid(10, 10, cells);

    hc.updateExternalConnection(10, 10, grid);
    expect(hc.hasExternalConnection).toBe(false);
  });

  describe('serialization', () => {
    it('toJSON/fromJSON round-trip preserves state', () => {
      const hc = new HighwayConnection();
      const cells = new Map<string, CellStub>();
      setCell(cells, 5, 0, RoadType.HIGHWAY, RoadDirection.SOUTH);
      setCell(cells, 9, 3, RoadType.HIGHWAY, RoadDirection.WEST);
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
