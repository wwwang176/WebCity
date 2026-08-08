import { describe, it, expect } from 'vitest';
import { buildServiceStatus, SERVICE_STATUS_KEYS, NO_COVERAGE } from '../ServiceStatusView';

/**
 * `handleSelectClick` and `handleSelectEmptyZone` each built the panel's
 * service list by hand, from the same nine services. The two copies drifted:
 * the zone-building branch omitted `sewage` entirely.
 *
 * Nothing caught it because Game.ts imports Three.js and has no tests at all,
 * and the resulting `undefined` did not throw — `ratioColor(undefined)` returns
 * `rgb(255,NaN,50)`, which the browser discards as an invalid declaration. So
 * selecting a house showed a Sewage row with a blank dot, indistinguishable
 * from a service that simply had no coverage.
 *
 * The fix is one builder with a declared return type, so an omitted service is
 * a compile error rather than a blank dot. These cases pin the two things the
 * type cannot: that every key the panel renders is actually present, and that
 * "no coverage" keeps its distinct sentinel.
 */
type Ratio = { getCostRatio(x: number, y: number): number };

const covered = (ratio: number): Ratio => ({ getCostRatio: () => ratio });

function deps(overrides: Partial<Parameters<typeof buildServiceStatus>[0]> = {}) {
  return {
    power: { isPowered: () => true },
    water: { isSupplied: () => true },
    sewage: { isSupplied: () => true },
    police: covered(0.2),
    fire: covered(0.3),
    garbage: covered(0.4),
    health: covered(0.5),
    education: covered(0.6),
    deathCare: covered(0.7),
    ...overrides,
  };
}

describe('the panel is given every service it renders', () => {
  it('should return a value for every declared service', () => {
    const status = buildServiceStatus(deps(), 3, 4);
    for (const key of SERVICE_STATUS_KEYS) {
      expect(status[key], key).toBeTypeOf('number');
      expect(Number.isNaN(status[key]), `${key} is NaN`).toBe(false);
    }
    // Guards the loop above: an empty key list would satisfy it vacuously.
    expect(SERVICE_STATUS_KEYS.length).toBe(9);
    expect(Object.keys(status).sort()).toEqual([...SERVICE_STATUS_KEYS].sort());
  });

  it('should report sewage, which the zone branch used to omit', () => {
    expect(buildServiceStatus(deps(), 0, 0).sewage).toBe(0);
    expect(buildServiceStatus(deps({ sewage: { isSupplied: () => false } }), 0, 0).sewage)
      .toBe(NO_COVERAGE);
  });
});

describe('utilities are on/off, services are a cost ratio', () => {
  it('should map a connected utility to 0 and a disconnected one to the sentinel', () => {
    const off = buildServiceStatus({
      ...deps(),
      power: { isPowered: () => false },
      water: { isSupplied: () => false },
    }, 0, 0);
    expect(off.power).toBe(NO_COVERAGE);
    expect(off.water).toBe(NO_COVERAGE);
    expect(buildServiceStatus(deps(), 0, 0).power).toBe(0);
  });

  it('should pass a service ratio through untouched', () => {
    // The panel colours by magnitude, so rounding or clamping here would
    // silently change what the player sees.
    const status = buildServiceStatus(deps({ police: covered(0.37) }), 0, 0);
    expect(status.police).toBe(0.37);
  });

  it('should ask each service about the cell it was given', () => {
    const seen: Array<[number, number]> = [];
    buildServiceStatus(deps({
      police: { getCostRatio: (x, y) => { seen.push([x, y]); return 0; } },
    }), 12, 7);
    expect(seen).toEqual([[12, 7]]);
  });

  it('should keep the no-coverage sentinel below every real ratio', () => {
    // The panel's `ratio < 0` branch is what draws the grey dot; a sentinel
    // inside the normal range would colour "no service" as "excellent".
    expect(NO_COVERAGE).toBeLessThan(0);
  });
});
