import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import { canPlaceInfra, placeInfraOnGrid, MULTI_CELL_OCCUPIED } from '../InfraPlacement';
import { getInfraConfig, getInfraBuildingId, type InfraType, type Rotation } from '../InfraConfig';
import { PoliceService } from '../../service/PoliceService';
import { HealthService } from '../../service/HealthService';

/**
 * Every placement test in the suite puts ONE facility on an EMPTY grid. That
 * shape cannot see the two things that go wrong in a real city:
 *
 *   - a second instance placed against the first, where the footprints touch
 *     and the secondary cells (MULTI_CELL_OCCUPIED) of one are the anchor
 *     candidates of the other; and
 *   - two instances of the same service, where the registry, the coverage map
 *     and the maintenance bill all have to hold both.
 *
 * The rotation-aware footprint arithmetic is where a one-cell error hides: with
 * a single 2x2 on an empty map, off-by-one in either direction still lands on
 * empty ground and nothing complains.
 */
const MULTI_CELL: InfraType[] = ['police', 'fire', 'hospital', 'school', 'garbage'];

/** A road along y=0, so road access is never the reason a case fails. */
function roadedGrid(): Grid {
  const grid = new Grid(40, 40);
  for (let x = 0; x < 40; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
  return grid;
}

/** Every cell a facility of this type occupies when anchored at (x, y). */
function footprint(type: InfraType, x: number, y: number): Array<[number, number]> {
  const cfg = getInfraConfig(type)!;
  const cells: Array<[number, number]> = [];
  for (let dy = 0; dy < cfg.height; dy++) {
    for (let dx = 0; dx < cfg.width; dx++) cells.push([x + dx, y + dy]);
  }
  return cells;
}

describe('a second instance placed hard against the first', () => {
  it.each(MULTI_CELL)('%s: should fit exactly one cell past the first', (type) => {
    const cfg = getInfraConfig(type)!;
    const grid = roadedGrid();

    expect(canPlaceInfra(grid, 2, 1, type, 0).ok, 'the first one must fit').toBe(true);
    placeInfraOnGrid(grid, 2, 1, type, 0);

    // Touching, not overlapping.
    const nextX = 2 + cfg.width;
    expect(canPlaceInfra(grid, nextX, 1, type, 0).ok,
      `${type} could not be placed flush against itself`).toBe(true);
  });

  it.each(MULTI_CELL)('%s: should refuse the cell one short of clearing it', (type) => {
    const cfg = getInfraConfig(type)!;
    const grid = roadedGrid();
    placeInfraOnGrid(grid, 2, 1, type, 0);

    // One cell of overlap, which is the off-by-one an empty-grid test cannot see.
    if (cfg.width < 2) return;
    const overlapping = 2 + cfg.width - 1;
    expect(canPlaceInfra(grid, overlapping, 1, type, 0).ok,
      `${type} overlapped its own footprint by one cell`).toBe(false);
  });

  it.each(MULTI_CELL)('%s: should refuse an overlap that touches only its LAST cell', (type) => {
    const cfg = getInfraConfig(type)!;
    if (cfg.width < 2 || cfg.height < 2) return;
    const grid = roadedGrid();
    placeInfraOnGrid(grid, 12, 1, type, 0);

    // Anchored to the LEFT, on the same row, so the only overlapping cells are
    // the new footprint's last column. The obvious overlap case — one column
    // short of clearing — collides on the new anchor's own FIRST column, which
    // any scan reaches; a scan that stops one column early still passes it.
    //
    // Same row as the first, so road distance is identical for both and cannot
    // be the reason this is refused — and the reason is asserted, not just the
    // refusal, because NOT_ADJACENT_TO_ROAD would otherwise satisfy it.
    const result = canPlaceInfra(grid, 12 - cfg.width + 1, 1, type, 0);
    expect(result.ok, `${type} overlapped on its far column`).toBe(false);
    expect(result.ok ? '' : result.reason).toBe('INFRASTRUCTURE_EXISTS');
  });

  it.each(MULTI_CELL)('%s: should refuse an anchor on the other one’s marker cells', (type) => {
    const cfg = getInfraConfig(type)!;
    if (cfg.width < 2 && cfg.height < 2) return;
    const grid = roadedGrid();
    placeInfraOnGrid(grid, 2, 1, type, 0);

    // A secondary cell carries MULTI_CELL_OCCUPIED and no building id of its
    // own; treating it as free ground would bury half a facility inside another.
    const marker = grid.getCell(2 + cfg.width - 1, 1 + cfg.height - 1)!;
    expect(marker.reserved, 'the fixture has no marker cell to test against')
      .toBe(MULTI_CELL_OCCUPIED);
    expect(canPlaceInfra(grid, 2 + cfg.width - 1, 1 + cfg.height - 1, type, 0).ok).toBe(false);
  });

  it('should keep both footprints intact after the second is placed', () => {
    const grid = roadedGrid();
    placeInfraOnGrid(grid, 2, 1, 'police', 0);
    const cfg = getInfraConfig('police')!;
    placeInfraOnGrid(grid, 2 + cfg.width, 1, 'police', 0);

    const id = getInfraBuildingId('police');
    for (const [x, y] of footprint('police', 2, 1)) {
      const cell = grid.getCell(x, y)!;
      expect(cell.buildingId === id || cell.reserved === MULTI_CELL_OCCUPIED,
        `first footprint damaged at ${x},${y}`).toBe(true);
    }
    for (const [x, y] of footprint('police', 2 + cfg.width, 1)) {
      const cell = grid.getCell(x, y)!;
      expect(cell.buildingId === id || cell.reserved === MULTI_CELL_OCCUPIED,
        `second footprint damaged at ${x},${y}`).toBe(true);
    }
  });
});

describe('a rotated instance beside an unrotated one', () => {
  it.each([90, 180, 270] as Rotation[])('rotation %s should respect the neighbour', (rotation) => {
    // Rotation swaps width and height, and the swapped extent is what the
    // adjacency arithmetic gets wrong. A single rotated hospital on an empty
    // map still lands on empty ground whichever way the extent is read.
    const grid = roadedGrid();
    placeInfraOnGrid(grid, 2, 1, 'hospital', 0);
    const cfg = getInfraConfig('hospital')!;

    const rotatedFits = canPlaceInfra(grid, 2 + cfg.width, 1, 'hospital', rotation).ok;
    const rotatedOverlaps = canPlaceInfra(grid, 2 + cfg.width - 1, 1, 'hospital', rotation).ok;

    expect(rotatedFits, 'a rotated hospital could not go flush beside a plain one').toBe(true);
    expect(rotatedOverlaps, 'a rotated hospital overlapped its neighbour').toBe(false);
  });
});

describe('two instances of one service are both counted', () => {
  it('should register both and bill for both', () => {
    const grid = roadedGrid();
    const police = new PoliceService();
    const cfg = getInfraConfig('police')!;

    placeInfraOnGrid(grid, 2, 1, 'police', 0);
    police.addStation(2, 1);
    const oneCost = police.getMaintenanceCost();

    placeInfraOnGrid(grid, 2 + cfg.width, 1, 'police', 0);
    police.addStation(2 + cfg.width, 1);

    expect(police.getStations()).toHaveLength(2);
    expect(police.getMaintenanceCost()).toBe(oneCost * 2);
  });

  it('should give both of them coverage, and more of it than one', () => {
    const grid = roadedGrid();
    const cfg = getInfraConfig('police')!;

    const one = new PoliceService();
    placeInfraOnGrid(grid, 2, 1, 'police', 0);
    one.addStation(2, 1);
    one.recalculateCoverage(grid);
    one.updateOperationalStatus(() => true);

    const two = new PoliceService();
    placeInfraOnGrid(grid, 20, 1, 'police', 0);
    two.addStation(2, 1);
    two.addStation(20, 1);
    two.recalculateCoverage(grid);
    two.updateOperationalStatus(() => true);

    const covered = (svc: PoliceService) => {
      let n = 0;
      grid.forEachCell((_c, x, y) => { if (svc.getCoverage(x, y)) n++; });
      return n;
    };
    expect(covered(one)).toBeGreaterThan(0);
    expect(covered(two), 'the second station added no coverage at all')
      .toBeGreaterThan(covered(one));
    void cfg;
  });

  it('should sum the capacity of both, not just the first', () => {
    const grid = roadedGrid();
    const health = new HealthService();
    const cfg = getInfraConfig('hospital')!;

    placeInfraOnGrid(grid, 2, 1, 'hospital', 0);
    health.addHospital(2, 1);
    health.recalculateCoverage(grid);
    health.updateOperationalStatus(() => true);
    const one = health.getTotalCapacity();

    placeInfraOnGrid(grid, 2 + cfg.width, 1, 'hospital', 0);
    health.addHospital(2 + cfg.width, 1);
    health.recalculateCoverage(grid);
    health.updateOperationalStatus(() => true);

    expect(one).toBeGreaterThan(0);
    expect(health.getTotalCapacity()).toBe(one * 2);
  });

  it('should still report only the survivor after one is removed', () => {
    // The reverse direction: removing one of two must not take both, and must
    // not leave the removed one billed.
    const grid = roadedGrid();
    const police = new PoliceService();
    const cfg = getInfraConfig('police')!;

    placeInfraOnGrid(grid, 2, 1, 'police', 0);
    const first = police.addStation(2, 1);
    placeInfraOnGrid(grid, 2 + cfg.width, 1, 'police', 0);
    police.addStation(2 + cfg.width, 1);

    police.removeStation(first);

    expect(police.getStations()).toHaveLength(1);
    expect(police.getStations()[0]!.x).toBe(2 + cfg.width);
  });
});
