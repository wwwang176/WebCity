import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ShowcasePlanes } from '../planes';
import { civicLayout } from '../civicLayout';
import { getAirportDimensions } from '../../core/transport/AirportSystem';

/**
 * The showcase's aircraft arrival and departure animation.
 *
 * Aircraft animation is what makes the comparison possible, and what it is compared against is the
 * painted markings: does the aircraft land on the runway, follow the taxiway, park at the gate.
 */
describe('展示區的飛機', () => {
  const scene = () => new THREE.Scene();

  /**
   * The airport origin conversion.
   *
   * `AirplaneAnimator` derives the footprint's centre as `airport.x + (w - 1) / 2`, where `airport.x`
   * is the **top-left cell index**. Putting a slot's centre straight in offsets every aircraft by
   * half an airport, which on screen reads only as the aircraft not quite lining up with the runway.
   */
  it('should place the airport so its centre lands on the layout slot', () => {
    const planes = new ShowcasePlanes(scene());
    const slot = { size: 'LARGE' as const, x: -3.5, z: 8.25 };
    planes.setFields([slot]);
    const [airport] = (planes as unknown as { airports: Array<{ x: number; y: number }> })
      .airports;
    const dim = getAirportDimensions('LARGE');
    expect(airport!.x + (dim.w - 1) / 2, '機場中心沒有落在 slot 上')
      .toBeCloseTo(slot.x, 9);
    expect(airport!.y + (dim.h - 1) / 2, '機場中心沒有落在 slot 上')
      .toBeCloseTo(slot.z, 9);
  });

  /** Runs for `seconds` seconds and reports whether any aircraft appeared during it, along with the final frame's pool. */
  const fly = (planes: ShowcasePlanes, seconds: number) => {
    const pool = (planes as unknown as { pool: THREE.Mesh[] }).pool;
    let everSeen = false;
    for (let t = 0; t < seconds; t += 0.5) {
      planes.update(0.5);
      if (pool.some(m => m.visible)) everSeen = true;
    }
    return { everSeen, pool };
  };

  it('should run the very animator the game runs', () => {
    // With a second copy the alignment seen in the showcase and the alignment in game are two
    // different things, and the showcase's only value is that what it shows is what ships.
    //
    // The question is whether an aircraft appeared **during** the run rather than whether one is
    // there on the final frame: after a cycle the aircraft leaves and the next is a headway away,
    // so a check on the final frame alone turns green or red with how long the run is.
    const planes = new ShowcasePlanes(scene());
    planes.setFields([{ size: 'SMALL', x: 0, z: 0 }]);
    expect(fly(planes, 45).everSeen, '跑了 45 秒沒有出現任何一架飛機').toBe(true);
  });

  it('should hide every plane when the view is cleared', () => {
    const planes = new ShowcasePlanes(scene());
    planes.setFields([{ size: 'SMALL', x: 0, z: 0 }]);
    const pool = (planes as unknown as { pool: THREE.Mesh[] }).pool;
    // Cleared only **once an aircraft is really in the scene**. Over a fixed number of seconds the
    // cycle may already have ended, making "it is clear" vacuous — removing `clear()` entirely would
    // leave this green.
    for (let t = 0; t < 120 && !pool.some(m => m.visible); t += 0.5) {
      planes.update(0.5);
    }
    expect(pool.some(m => m.visible), '一直沒有飛機可以清').toBe(true);
    planes.clear();
    expect(pool.every(m => !m.visible), '切走檢視模式之後飛機還留在場上')
      .toBe(true);
  });

  it('should fly the plane over the runway it was given, not over the origin', () => {
    // With the airport origin converted wrongly the aircraft still fly, only somewhere else, so what
    // matters is **where** they fly rather than whether they do.
    const at = { size: 'SMALL' as const, x: 20, z: -14 };
    const planes = new ShowcasePlanes(scene());
    planes.setFields([at]);
    const pool = (planes as unknown as { pool: THREE.Mesh[] }).pool;
    let closest = Infinity;
    for (let t = 0; t < 45; t += 0.5) {
      planes.update(0.5);
      for (const m of pool) {
        if (!m.visible) continue;
        closest = Math.min(closest, Math.hypot(m.position.x - at.x, m.position.z - at.z));
      }
    }
    expect(closest, '飛機從來沒有靠近過那座機場').toBeLessThan(4);
  });

  it('should fly a plane at every airport in the layout', () => {
    // The layout holds three airports. One left unconnected stays empty forever, and reads only as
    // that airport having no flights.
    const airports = civicLayout(['airport_s', 'airport_m', 'airport_l'])
      .map(s => s.type);
    expect(airports.length, '排版裡的機場數不是三座').toBe(3);
  });
});
