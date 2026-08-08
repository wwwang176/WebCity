import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import { GarbageService, GARBAGE } from '../GarbageService';

/**
 * The uncollected-garbage penalty is a single number — `getPollutionPenalty()`,
 * capped at MAX_POLLUTION_PENALTY — and it is emitted down one of two branches
 * depending on whether the city has a working landfill. The two branches did
 * not agree on what "emitting it" meant.
 *
 * The no-landfill branch shares the penalty out proportionally, so the amounts
 * sum to exactly the penalty. The landfill branch computed
 * `ceil(penalty / facilityCount)` and then emitted that amount at EVERY cell of
 * every facility — a 2x2 landfill, so four times over. A city with one landfill
 * therefore suffered roughly 4x the penalty of an identical city with none.
 *
 * That is BUG-101's incentive inversion again in a lighter form: the player
 * builds waste handling and the uncollected rubbish they still have starts
 * hurting four times as much. It survived because both branches were only ever
 * tested in isolation, never against each other.
 */

/** A city with a road, so a landfill placed beside it can be road-connected. */
function cityGrid(): Grid {
  const grid = new Grid(30, 30);
  for (let x = 0; x < 20; x++) grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
  return grid;
}

/** `bags` bags of rubbish, spread over `spread` distinct cells. */
function withGarbage(garbage: GarbageService, bags: number, spread: number): void {
  for (let i = 0; i < bags; i++) garbage.reportGarbage(3 + (i % spread), 20, 4);
  garbage.tick();
}

const total = (g: GarbageService) =>
  g.getPollutionSources().reduce((sum, s) => sum + s.amount, 0);

describe('both branches emit the same penalty', () => {
  it('should emit exactly the penalty when there is no landfill', () => {
    // The reference behaviour the other branch has to match.
    const garbage = new GarbageService();
    withGarbage(garbage, 60, 6);
    expect(garbage.getPollutionPenalty()).toBeGreaterThan(0);
    expect(total(garbage)).toBeCloseTo(garbage.getPollutionPenalty(), 5);
  });

  it('should emit the same penalty when a landfill exists', () => {
    // Measured as the DIFFERENCE the rubbish makes, so the landfill's own base
    // and load pollution — which is a separate, legitimate cost — cancels out.
    const grid = cityGrid();

    const clean = new GarbageService();
    clean.addFacility(3, 0);
    clean.recalculateCoverage(grid);
    const baseline = total(clean);

    const dirty = new GarbageService();
    dirty.addFacility(3, 0);
    dirty.recalculateCoverage(grid);
    withGarbage(dirty, 60, 6);

    const penalty = dirty.getPollutionPenalty();
    expect(penalty, 'the fixture must actually have uncollected rubbish').toBeGreaterThan(0);
    // The landfill collects on tick, so compare against what is left over.
    expect(total(dirty) - baseline).toBeCloseTo(penalty, 5);
  });

  it('should not make rubbish hurt more just because a landfill exists', () => {
    // The player-facing statement of the same thing: adding waste handling must
    // not multiply the cost of the rubbish it has not collected yet.
    const grid = cityGrid();

    const without = new GarbageService();
    withGarbage(without, 60, 6);

    const withLandfill = new GarbageService();
    withLandfill.addFacility(3, 0);
    withLandfill.recalculateCoverage(grid);
    withGarbage(withLandfill, 60, 6);

    const cleanLandfill = new GarbageService();
    cleanLandfill.addFacility(3, 0);
    cleanLandfill.recalculateCoverage(grid);

    const rubbishCost = total(withLandfill) - total(cleanLandfill);
    expect(rubbishCost).toBeLessThanOrEqual(total(without) + 1e-6);
  });

  it('should scale with the number of landfills only through their own pollution', () => {
    // Splitting the penalty n ways and then emitting it at n*cells positions
    // meant the total depended on how many landfills the player had built.
    const grid = cityGrid();
    const measure = (count: number) => {
      const clean = new GarbageService();
      const dirty = new GarbageService();
      for (let i = 0; i < count; i++) {
        clean.addFacility(3 + i * 4, 0);
        dirty.addFacility(3 + i * 4, 0);
      }
      clean.recalculateCoverage(grid);
      dirty.recalculateCoverage(grid);
      withGarbage(dirty, 60, 6);
      return { penaltyPart: total(dirty) - total(clean), penalty: dirty.getPollutionPenalty() };
    };

    const one = measure(1);
    const three = measure(3);
    expect(one.penalty).toBeGreaterThan(0);
    expect(one.penaltyPart).toBeCloseTo(one.penalty, 5);
    expect(three.penaltyPart).toBeCloseTo(three.penalty, 5);
  });
});

/**
 * `UNCOLLECTED_POLLUTION_SITES = 12` picked "the twelve worst piles". When the
 * rubbish is spread evenly — the normal case, one or two bags per house — every
 * pile has the same count, the sort is stable, and "worst twelve" degenerates
 * into "the first twelve the map happened to enumerate". In a city with 200
 * rubbish-bearing cells, 188 of them emitted nothing at all, and splicing
 * collected bags out of `pendingBags` reshuffled which twelve for no reason the
 * player could see or influence.
 */
describe('evenly spread rubbish pollutes evenly', () => {
  function evenlySpread(cells: number): GarbageService {
    const garbage = new GarbageService();
    for (let i = 0; i < cells; i++) garbage.reportGarbage(i % 40, 5 + Math.floor(i / 40), 4);
    garbage.tick();
    return garbage;
  }

  it('should still conserve the penalty', () => {
    const garbage = evenlySpread(200);
    expect(total(garbage)).toBeCloseTo(garbage.getPollutionPenalty(), 5);
  });

  it('should leave no rubbish unrepresented', () => {
    // The defect was 188 of 200 rubbish cells emitting nothing at all. The
    // property that matters is coverage, not source count: merging nearby
    // rubbish into one source is fine — dropping it is not. So every cell that
    // holds rubbish must fall inside some source's spread.
    const garbage = evenlySpread(200);
    const sources = garbage.getPollutionSources();
    const r = GARBAGE.UNCOLLECTED_POLLUTION_RADIUS;

    const uncovered = garbage.getPendingGarbageQueue().filter(bag =>
      !sources.some(s => Math.abs(s.x - bag.x) + Math.abs(s.y - bag.y) <= r),
    );
    expect(garbage.getPendingGarbageQueue().length).toBeGreaterThan(100);
    expect(uncovered.map(b => `${b.x},${b.y}`)).toEqual([]);
  });

  it('should cover the whole area the rubbish occupies', () => {
    // Rubbish at both ends of a long street must both show up; picking the
    // first twelve positions put every source in one corner.
    const garbage = new GarbageService();
    for (let x = 0; x < 40; x++) garbage.reportGarbage(x, 5, 4);
    garbage.tick();

    const xs = garbage.getPollutionSources().map(s => s.x);
    expect(Math.min(...xs)).toBeLessThan(8);
    expect(Math.max(...xs)).toBeGreaterThan(31);
  });

  it('should still concentrate on a genuinely worse pile', () => {
    // The spreading must not throw away the signal the old code was after.
    const garbage = new GarbageService();
    for (let i = 0; i < 40; i++) garbage.reportGarbage(5, 5, 4);
    for (let i = 0; i < 4; i++) garbage.reportGarbage(25, 25, 4);
    garbage.tick();

    const sources = garbage.getPollutionSources();
    const near = (x: number, y: number) =>
      sources.filter(s => Math.abs(s.x - x) <= 2 && Math.abs(s.y - y) <= 2)
        .reduce((sum, s) => sum + s.amount, 0);

    expect(near(5, 5)).toBeGreaterThan(near(25, 25));
  });

  it('should stay bounded on a large messy city', () => {
    // Emitting one source per rubbish cell would be correct and unaffordable:
    // Pollution.spreadFromSource walks (2r+1)^2 cells for every source.
    const garbage = new GarbageService();
    for (let i = 0; i < 4000; i++) garbage.reportGarbage(i % 200, Math.floor(i / 200), 4);
    garbage.tick();
    expect(garbage.getPollutionSources().length).toBeLessThan(700);
  });

  it('should give the same answer twice for the same city', () => {
    const garbage = evenlySpread(200);
    const a = garbage.getPollutionSources();
    const b = garbage.getPollutionSources();
    expect(b.map(s => `${s.x},${s.y}:${s.amount}`)).toEqual(a.map(s => `${s.x},${s.y}:${s.amount}`));
  });
});
