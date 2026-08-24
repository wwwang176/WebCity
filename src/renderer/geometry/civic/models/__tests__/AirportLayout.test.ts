import { describe, it, expect } from 'vitest';
import { airportLayout } from '../airport';
import { AIRPORT_PATH_COUNT } from '../../../../airportPaths';
import { buildAirplaneGeometry } from '../../../index';
import { getInfraConfig, type InfraType } from '../../../../../core/building/InfraConfig';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';
import type { AirportSize } from '../../../../../core/transport/AirportSystem';

const m = (cells: number) => cells * METRES_PER_CELL;

const SIZES = [
  ['小型', 'SMALL', 'airport_s'],
  ['中型', 'MEDIUM', 'airport_m'],
  ['大型', 'LARGE', 'airport_l'],
] as const;

/**
 * Whether the path table itself is reasonable.
 *
 * `Airport.test.ts` checks that the geometry agrees with the path table, and all of those cases
 * are **relative**: change the table and the geometry follows, so they are always self-consistent.
 * Measured: moving the small airport's runway from z = 1.20 to 0.40 leaves both green while the
 * apron is 0.59 cells (7 m) deep, too little for a 10.8 m aircraft.
 *
 * This file is the other half: **what happens when the table holds an absurd value**. Its
 * questions are absolute — does each band still hold what it has to hold.
 */
describe.each(SIZES)('%s機場的航路表', (_label, size, type) => {
  const cfg = getInfraConfig(type as InfraType)!;
  const layout = airportLayout(size as AirportSize, cfg.height);
  const halfH = cfg.height / 2;
  const halfW = cfg.width / 2;

  it('should keep every runway inside the plot', () => {
    for (const r of layout.runwayBands) {
      expect(r.z0, `跑道 ${r.c} 的後緣掉出佔地`).toBeGreaterThanOrEqual(-halfH);
      expect(r.c, `跑道 ${r.c} 的中線掉出佔地`).toBeLessThanOrEqual(halfH);
      expect(r.z1 - r.z0, `跑道 ${r.c} 的帶是空的`).toBeGreaterThan(0);
    }
  });

  it('should not overlap the runway bands', () => {
    const sorted = [...layout.runwayBands].sort((a, b) => a.z0 - b.z0);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.z0, '兩條跑道帶重疊了')
        .toBeGreaterThanOrEqual(sorted[i - 1]!.z1 - 1e-9);
    }
  });

  it('should keep parallel runways far enough apart to be two runways', () => {
    // With the two centrelines too close, "they do not overlap" still holds because the bands
    // shrink, but on screen it is one wide runway plus a 2 m strip, and two aircraft collide on
    // it. 16.8 m is the runway band width here, twice `RUNWAY_HALF`.
    const cs = layout.runwayBands.map(r => r.c).sort((a, b) => a - b);
    for (let i = 1; i < cs.length; i++) {
      const gap = m(cs[i]! - cs[i - 1]!);
      expect(gap, `兩條跑道只隔 ${gap.toFixed(1)} m`).toBeGreaterThanOrEqual(16.8);
    }
  });

  it('should leave the terminal somewhere to stand', () => {
    // The terminal band runs from the plot's back edge to `termFront`. 10 m is a terminal's
    // minimum depth: 60 m wide by 10 m deep holds up perfectly well, and the small airport has
    // only 48 m of total depth to split between runway, taxiway, apron and terminal.
    const depth = layout.termFront - (-halfH);
    expect(m(depth), `航廈只剩 ${m(depth).toFixed(1)} m 深`).toBeGreaterThan(10);
  });

  it('should leave the apron deep enough for an aeroplane', () => {
    // An aircraft is 11.7 x 10.8 m. With a shallower apron, a parked aircraft presses into the
    // terminal or the taxiway, while every "geometry agrees with the paths" case stays green.
    const depth = layout.apronBack - layout.termFront;
    expect(m(depth), `停機坪只剩 ${m(depth).toFixed(1)} m 深`).toBeGreaterThan(11);
  });

  it('should put the apron lane between the gates and the runway', () => {
    // With the cross taxiway behind the gates, an aircraft would have to pass through the
    // terminal to reach one.
    for (const g of layout.gates) {
      expect(g.z, `機位 ${g.x} 沒有在聯絡道後面`).toBeLessThan(layout.laneZ);
    }
    expect(layout.laneZ, '聯絡道跑到跑道上了').toBeLessThan(layout.apronBack);
  });

  it('should keep the taxiways inside the plot', () => {
    expect(layout.taxiX, '縱向滑行道跑出佔地').toBeLessThan(halfW);
    // And clear of the gate group: over a gate, no aircraft can reach it.
    for (const g of layout.gates) {
      expect(Math.abs(g.x), `機位 ${g.x} 壓在縱向滑行道上`)
        .toBeLessThan(layout.taxiX);
    }
  });

  /**
   * Gates that can be occupied simultaneously have to be at least a **wingspan** apart.
   *
   * With three gates on the large airport, two aircraft foul each other: the two paths share the
   * middle gate (A uses -0.5/0.2 and B uses 0.2/0.9), so four positions are only three distinct
   * ones, and 0.7 cells (8.4 m) is narrower than the 10.8 m wingspan — two parked at once are
   * wingtip over wingtip.
   *
   * Required only for sizes that hold two or more at once (`AIRPORT_PATH_COUNT > 1`): small and
   * medium hold one at a time, and closer gates make the terminal frontage look busier.
   *
   * The wingspan is measured from the **actual geometry** rather than copied: lengthen the wings
   * and this case demands the gates move apart with them.
   */
  it('should space simultaneous gates at least a wingspan apart', () => {
    if (AIRPORT_PATH_COUNT[size as AirportSize] < 2) return;
    const plane = buildAirplaneGeometry();
    plane.computeBoundingBox();
    // The geometry faces +x with its wingspan along z. Parked at a gate it is rotated 90 degrees,
    // so the wingspan runs along x.
    const span = plane.boundingBox!.max.z - plane.boundingBox!.min.z;
    const xs = layout.gates.map(g => g.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      const gap = xs[i]! - xs[i - 1]!;
      expect(m(gap), `機位間距 ${m(gap).toFixed(1)} m，翼展 ${m(span).toFixed(1)} m`)
        .toBeGreaterThanOrEqual(m(span));
    }
  });

  it('should give the large airport four gates', () => {
    // Two gates per path, and **not shared**: shared, two aircraft are directed to one cell.
    if (AIRPORT_PATH_COUNT[size as AirportSize] < 2) return;
    expect(layout.gates.length, '大型機場的機位不是四個').toBe(4);
  });

  it('should keep every gate inside the plot', () => {
    for (const g of layout.gates) {
      expect(Math.abs(g.x), `機位 ${g.x} 掉出佔地`).toBeLessThan(halfW);
      expect(Math.abs(g.z), `機位 z=${g.z} 掉出佔地`).toBeLessThan(halfH);
    }
  });
});
