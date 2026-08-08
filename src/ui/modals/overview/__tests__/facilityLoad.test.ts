import { describe, it, expect } from 'vitest';
import { shareFacilityLoad, hasShortage } from '../facilityLoad';

/**
 * BUG-138 filtered the capacity getters so a stopped facility stops advertising
 * places it cannot provide. It did not filter the LOADS that divide into them,
 * and three panels were left computing a share of a total against a denominator
 * that no longer contains every facility in the numerator.
 *
 * Two plants of 2250, one blacked out, 3000 units produced:
 *   share = 3000 * 2250 / 2250 = 3000, for BOTH rows.
 * Displayed load totalled 6000 for 3000 units of sewage, and the dead plant was
 * indistinguishable from the working one's genuine overload.
 *
 * With every plant offline the denominator is 0, the `> 0` guard makes every
 * share 0, and each row reads "0 / 2250 · Normal" in green — at the exact
 * moment the city treats nothing at all.
 */
type Plant = { id: string; capacity: number; live: boolean };
const plants = (...specs: Array<[string, number, boolean]>): Plant[] =>
  specs.map(([id, capacity, live]) => ({ id, capacity, live }));

const share = (total: number, ps: Plant[]) =>
  shareFacilityLoad(total, ps, p => p.capacity, p => p.live);

describe('a load is shared only among the facilities that can carry it', () => {
  it('should split proportionally when everything works', () => {
    const r = share(3000, plants(['a', 1000, true], ['b', 2000, true]));
    expect(r.shares.map(s => s.load)).toEqual([1000, 2000]);
    expect(r.unassigned).toBe(0);
  });

  it('should give a stopped plant no load and put its share on the live ones', () => {
    // The defect: both rows used to read 3000.
    const r = share(3000, plants(['live', 2250, true], ['dead', 2250, false]));
    expect(r.shares[0]!.load).toBe(3000);
    expect(r.shares[1]!.load).toBe(0);
    expect(r.shares[1]!.active).toBe(false);
    expect(r.unassigned).toBe(0);
  });

  it('should never invent load: the shares always add back up to the total', () => {
    // The assertion that actually pins the defect. Any "each row gets its share
    // of a filtered denominator" scheme fails this the moment one plant stops.
    const cases: Array<[number, Plant[]]> = [
      [3000, plants(['a', 2250, true], ['b', 2250, false])],
      [999, plants(['a', 100, true], ['b', 200, true], ['c', 300, true])],
      [1, plants(['a', 7, true], ['b', 7, true], ['c', 7, true])],
      [0, plants(['a', 100, true])],
      [500, plants(['a', 100, false], ['b', 200, false])],
    ];
    for (const [total, ps] of cases) {
      const r = share(total, ps);
      const sum = r.shares.reduce((a, s) => a + s.load, 0) + r.unassigned;
      expect(sum, `total=${total}`).toBe(total);
    }
  });

  it('should report the whole load as unassigned when every facility is stopped', () => {
    // This is the case that used to render green. Nothing is treating it, so
    // the panel has to have somewhere to say so.
    const r = share(3000, plants(['a', 2250, false], ['b', 2250, false]));
    expect(r.shares.every(s => s.load === 0 && !s.active)).toBe(true);
    expect(r.unassigned).toBe(3000);
    expect(r.activeCapacity).toBe(0);
  });

  it('should report the whole load as unassigned when there are no facilities', () => {
    const r = share(500, []);
    expect(r.shares).toHaveLength(0);
    expect(r.unassigned).toBe(500);
    expect(r.activeCapacity).toBe(0);
  });

  it('should report active and total capacity separately', () => {
    // The landfill row showed a stored total over an active-only capacity and
    // printed "1800 / 0" with the bar back at a healthy 0%.
    const r = share(1800, plants(['a', 2000, false], ['b', 500, true]));
    expect(r.activeCapacity).toBe(500);
    expect(r.totalCapacity).toBe(2500);
    expect(r.strandedCapacity).toBe(2000);
  });

  it('should treat a zero-capacity live facility as carrying nothing', () => {
    // Avoids a divide-by-zero producing NaN across every row.
    const r = share(100, plants(['a', 0, true], ['b', 50, true]));
    expect(r.shares[0]!.load).toBe(0);
    expect(r.shares[1]!.load).toBe(100);
    expect(r.shares.every(s => Number.isFinite(s.load))).toBe(true);
  });

  it('should give every share a finite ratio', () => {
    const r = share(100, plants(['a', 0, true], ['b', 0, false]));
    for (const s of r.shares) expect(Number.isFinite(s.ratio)).toBe(true);
  });
});

describe('a shortage is a shortage even when nothing is left standing', () => {
  it('should flag a load above capacity', () => {
    expect(hasShortage(87, 60)).toBe(true);
    expect(hasShortage(60, 87)).toBe(false);
    expect(hasShortage(60, 60)).toBe(false);
  });

  it('should flag a load with no capacity at all behind it', () => {
    // The guards read `cap > 0 && load > cap`, which was safe only while
    // capacity could reach 0 solely by there being no stations. Once BUG-138
    // filtered out blacked-out ones, a city-wide blackout made capacity 0 and
    // silently switched the warning OFF — the one case where it matters most.
    expect(hasShortage(87, 0)).toBe(true);
  });

  it('should stay quiet when there is nothing to serve and nothing to serve it', () => {
    expect(hasShortage(0, 0)).toBe(false);
  });
});
