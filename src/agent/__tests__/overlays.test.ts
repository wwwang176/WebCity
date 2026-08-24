import { describe, it, expect } from 'vitest';
import {
  buildCoverage, buildOverlayCells, overlayKind,
  COVERAGE_SERVICES, type CoverageSource,
} from '../overlays';

/**
 * Overlay data.
 *
 * ## Two layers, not one
 *
 * Switching on the Police overlay actually shows **two** layers:
 *
 * - **Ground tint**: 80 or 0 per cell. Binary, saying only whether there is police cover here.
 * - **Building highlight**: the road-following cost from a station over the budget, green to
 *   yellow to red in **10 steps**. That is what the player actually reads, and it says how
 *   marginal that building's cover is.
 *
 * ## The tier must match the screen exactly
 *
 * `Game` picks colours with `tier = min(9, floor(ratio * 10))`. A tier one step out here makes
 * an agent's "that area is yellow" disagree with the player's screen — the hardest kind of
 * error to spot, because both sides look reasonable.
 */

/** A stand-in ten-step gradient. The real one is `Game.COV_GRADIENT`, green to red. */
const GRADIENT = [
  0x00e676, 0x39e85c, 0x72ea42, 0xabec28, 0xe4ee0e,
  0xffe010, 0xffb02c, 0xff8048, 0xff6a4d, 0xff5252,
];

function source(over: Partial<CoverageSource> = {}): CoverageSource {
  return {
    budget: 540,
    costs: new Map([['12,8', 150], ['30,41', 518]]),
    // No load information by default, so the distance half is what those cases exercise.
    loadAt: () => -1,
    servingFacilityAt: () => null,
    sources: [{ x: 20, y: 20 }],
    gradient: GRADIENT,
    ...over,
  };
}

describe('服務覆蓋', () => {
  it('should list the services that have a road-cost gradient', () => {
    expect([...COVERAGE_SERVICES]).toEqual(['police', 'fire', 'health', 'education', 'garbage']);
  });

  it('should report the cost, the ratio and the budget it was measured against', () => {
    const c = buildCoverage('police', source());

    expect(c.service).toBe('police');
    expect(c.budget).toBe(540);
    expect(c.covered, '覆蓋的格子數').toBe(2);
    expect(c.cells[0]).toMatchObject({ x: 12, y: 8, cost: 150 });
    expect(c.cells[0]!.ratio, '比值不是成本 ÷ 預算').toBeCloseTo(150 / 540, 6);
  });

  it('should put the tier where the game puts it', () => {
    // `tier = min(9, floor(ratio * 10))`, the same formula Game uses to pick colours.
    const c = buildCoverage('police', source({
      budget: 100,
      costs: new Map([['0,0', 0], ['1,0', 9], ['2,0', 10], ['3,0', 55], ['4,0', 99]]),
    }));
    expect(c.cells.map(x => x.tier)).toEqual([0, 0, 1, 5, 9]);
  });

  it('should never run off the end of the gradient', () => {
    // A cost exactly equal to the budget makes `ratio * 10` equal 10, and there is no tier 10:
    // the gradient has ten entries.
    const c = buildCoverage('police', source({
      budget: 100,
      costs: new Map([['0,0', 100], ['1,0', 999]]),
    }));

    expect(c.cells.map(x => x.tier), '走出色帶外面了').toEqual([9, 9]);
    expect(c.cells.every(x => x.color !== undefined)).toBe(true);
    // The ratio is clamped too. Returning 9.99 would read as ten times over budget, while in the
    // game's vocabulary 1 is the boundary and there is nothing less covered than uncovered.
    expect(c.cells.map(x => x.ratio), '比值沒有夾在 1').toEqual([1, 1]);
  });

  it('should take the colour from the gradient rather than working one out', () => {
    // Colours computed in two places diverge as soon as the gradient changes.
    const c = buildCoverage('police', source({
      budget: 100,
      costs: new Map([['0,0', 0], ['1,0', 50], ['2,0', 100]]),
    }));

    expect(c.cells.map(x => x.color)).toEqual(['#00e676', '#ffe010', '#ff5252']);
  });

  it('should carry the facilities that caused those colours', () => {
    // An area of red does not say whether to build a new station or whether the existing one is
    // simply too far away.
    expect(buildCoverage('police', source()).sources).toEqual([{ x: 20, y: 20 }]);
  });

  it('should be empty rather than broken when nothing is built yet', () => {
    const c = buildCoverage('fire', source({ costs: new Map(), sources: [] }));

    expect(c.covered).toBe(0);
    expect(c.cells).toEqual([]);
  });

  it('should say each service has its own budget', () => {
    // The five services have different budgets, and the wrong one skews every tier.
    const c = buildCoverage('garbage', source({ budget: 200, costs: new Map([['0,0', 100]]) }));
    expect(c.cells[0]!.ratio, '拿別的服務的預算去除').toBeCloseTo(0.5, 6);
  });
});

describe('地面色塊', () => {
  it('should turn the cell map into something with real coordinates', () => {
    const cells = buildOverlayCells(
      new Map([['12,8', 80], ['3,41', 80]]),
      (_v) => 0x334cff,
    );

    expect(cells).toEqual([
      { x: 12, y: 8, value: 80, color: '#334cff' },
      { x: 3, y: 41, value: 80, color: '#334cff' },
    ]);
  });

  it('should ask the game for each colour instead of inventing one', () => {
    const seen: number[] = [];
    buildOverlayCells(new Map([['0,0', 30], ['1,1', 90]]), (v) => { seen.push(v); return 0; });

    expect(seen, '沒有拿實際的數值去問顏色').toEqual([30, 90]);
  });

  it('should be empty when the overlay has nothing to draw', () => {
    expect(buildOverlayCells(undefined, () => 0)).toEqual([]);
    expect(buildOverlayCells(new Map(), () => 0)).toEqual([]);
  });
});

describe('這張圖層的數字怎麼讀', () => {
  it('should mark the coverage overlays as binary', () => {
    // These ground layers hold only 80 and 0. Left unsaid, a field of identical 80s reads to an
    // agent as a sampling failure.
    for (const t of ['police', 'fire', 'health', 'education', 'park', 'garbage']) {
      expect(overlayKind(t), `${t} 不是二元的？`).toBe('binary');
    }
  });

  it('should mark the ones that really are a gradient', () => {
    for (const t of ['traffic', 'pollution', 'landValue', 'crime', 'commute']) {
      expect(overlayKind(t), `${t} 不是連續的？`).toBe('continuous');
    }
  });

  it('should mark the ones whose number is a label, not an amount', () => {
    // A district's value is an **identity** — which district — and power/water are three-state.
    // Comparing them as intensities is meaningless.
    for (const t of ['power', 'water', 'zone', 'district']) {
      expect(overlayKind(t), `${t} 不是分類的？`).toBe('categorical');
    }
  });

  it('should not pretend to know an overlay it has never heard of', () => {
    expect(overlayKind('banana')).toBe('unknown');
  });
});


describe('顏色不只是距離', () => {
  it('should paint a swamped facility next door as the worst tier', () => {
    // BUG-362: the hospital is next door at cost 0 but running at twice capacity. On distance
    // alone this cell is tier 0, the greenest there is.
    const c = buildCoverage('health', source({
      budget: 100,
      costs: new Map([['0,0', 0]]),
      loadAt: () => 2.0,
    }));

    expect(c.cells[0]!.ratio, '距離那一半照樣是 0').toBe(0);
    expect(c.cells[0]!.load).toBe(2.0);
    expect(c.cells[0]!.severity, '負載沒有進到顏色裡').toBe(1);
    expect(c.cells[0]!.tier).toBe(9);
    expect(c.cells[0]!.color).toBe('#ff5252');
  });

  it('should still let distance speak when the facility is empty', () => {
    const c = buildCoverage('health', source({
      budget: 100,
      costs: new Map([['0,0', 90]]),
      loadAt: () => 0.2,
    }));

    expect(c.cells[0]!.severity).toBeCloseTo(0.9, 6);
    expect(c.cells[0]!.tier).toBe(9);
  });

  it('should say which facility is responsible for that cell', () => {
    // An area of red does not say which building to act on. `sources` says which facilities
    // exist; `facilityId` says which one serves this cell.
    const c = buildCoverage('health', source({
      costs: new Map([['3,4', 10]]),
      servingFacilityAt: (x, y) => `hospital_${x}_${y}`,
    }));

    expect(c.cells[0]!.facilityId).toBe('hospital_3_4');
  });

  it('should keep the distance ratio separate from the severity', () => {
    // Both are present so the caller can tell "too far" from "too full", which call for
    // different remedies.
    const c = buildCoverage('health', source({
      budget: 100,
      costs: new Map([['0,0', 20]]),
      loadAt: () => 1.5,
    }));

    expect(c.cells[0]!.ratio, '距離').toBeCloseTo(0.2, 6);
    expect(c.cells[0]!.load, '負載').toBe(1.5);
    expect(c.cells[0]!.severity, '取比較糟的').toBeCloseTo(0.5, 6);
  });

  it('should not let an unknown load drag a good cell down', () => {
    // `-1` means this service has no notion of load, not that the load is bad.
    const c = buildCoverage('park', source({
      budget: 100,
      costs: new Map([['0,0', 0]]),
      loadAt: () => -1,
    }));

    expect(c.cells[0]!.severity).toBe(0);
    expect(c.cells[0]!.tier).toBe(0);
  });
});
