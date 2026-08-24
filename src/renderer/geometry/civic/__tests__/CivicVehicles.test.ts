import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  assembleVehicles, mergeOrThrow, civicVehicleTint, PARKED_TAIL_TINT,
} from '../assemble';
import { VEHICLE_CONFIG } from '../../../vehicleConfig';
import { buildPoliceCarGeometry } from '../../policeCar';
import { buildAirplaneGeometry, buildAirplaneVTailGeometry } from '../../index';
import { triangleCount } from '../../buildings/parts';
import type { CivicVehicle, Footprint } from '../types';

const FOOT: Footprint = { w: 2, h: 2 };

const car = (o: Partial<CivicVehicle> = {}): CivicVehicle =>
  ({ kind: 'policeCar', x: 0, z: 0, ...o });

/**
 * Vehicles parked on a plot.
 *
 * The geometry already exists: `geometry/policeCar.ts` is the patrol car driving around the city,
 * and the one parked in a station's car park has to be the same vehicle rather than a plain box.
 *
 * Vehicles **cannot** be merged into the building mesh: they use
 * `MeshLambertMaterial({vertexColors})` with RGB written straight into the `color` attribute,
 * while the building shader reads `color` as (part tag, zone, ground brightness). Mixed together,
 * a white-and-blue patrol car reads as `partType = 0.102`, falls into the metal-detail branch,
 * and turns into a grey block.
 */
describe('停放的車輛', () => {
  it('should use the very geometry the driving cars use', () => {
    // Drawn separately, a parked patrol car and a driving one look different.
    const parked = assembleVehicles([car()], FOOT);
    expect(triangleCount(parked)).toBe(triangleCount(buildPoliceCarGeometry()));
  });

  it('should keep the vehicle colours in the color attribute', () => {
    // Overwritten by tagPart, a body's white and blue become part tags.
    const geo = assembleVehicles([car()], FOOT);
    const c = geo.getAttribute('color');
    const seen = new Set<string>();
    for (let i = 0; i < c.count; i++) {
      seen.add([c.getX(i), c.getY(i), c.getZ(i)].map(v => v.toFixed(3)).join(','));
    }
    expect(seen.size, '整台車只剩一個顏色 —— 頂點色被蓋掉了').toBeGreaterThan(3);
  });

  it('should not carry the building attributes', () => {
    // It uses a different material, where those attributes mean nothing: carrying them wastes
    // memory, and mergeGeometries fails on the mismatched attribute set.
    const geo = assembleVehicles([car()], FOOT);
    expect(geo.getAttribute('aBldgColor')).toBeUndefined();
  });

  it('should put the car where it was parked', () => {
    const at0 = assembleVehicles([car()], FOOT);
    const at1 = assembleVehicles([car({ x: 0.3, z: -0.2 })], FOOT);
    at0.computeBoundingBox();
    at1.computeBoundingBox();
    expect(at1.boundingBox!.min.x - at0.boundingBox!.min.x).toBeCloseTo(0.3, 6);
    expect(at1.boundingBox!.min.z - at0.boundingBox!.min.z).toBeCloseTo(-0.2, 6);
  });

  it('should turn the car to face the way it was parked', () => {
    // The geometry faces +x. With the bays running along z the car is rotated 90 degrees, or it
    // parks sideways.
    const along = assembleVehicles([car()], FOOT);
    const across = assembleVehicles([car({ rotationY: Math.PI / 2 })], FOOT);
    along.computeBoundingBox();
    across.computeBoundingBox();
    const size = (g: THREE.BufferGeometry) => g.boundingBox!.getSize(new THREE.Vector3());
    expect(size(along).x, '沒轉的時候車身該沿 x 長').toBeGreaterThan(size(along).z);
    expect(size(across).z, '轉了 90 度之後該沿 z 長').toBeGreaterThan(size(across).x);
  });

  it('should keep vehicles inside the footprint', () => {
    expect(() => assembleVehicles([car({ x: 0.95 })], FOOT)).toThrow(/leaves the plot/);
  });

  /**
   * The guard measures the bounding box **after** rotation.
   *
   * A patrol car is 0.22 long by 0.09 wide. Rotated 90 degrees the long side moves to z, and
   * checked against its pre-rotation width and depth a car actually reaching 0.06 cells (0.7 m)
   * out passes, showing on screen only as slightly overrunning the next cell.
   *
   * Both directions are tested: checking only that the guard refuses would pass a guard written
   * to throw always.
   */
  it('should measure the bounding box after the car is turned', () => {
    // Rotated, the body runs long along z, so parking at z = 0.92 reaches out.
    expect(() => assembleVehicles([car({ z: 0.92, rotationY: Math.PI / 2 })], FOOT),
      '轉向之後的越界沒有被擋下來').toThrow(/leaves the plot/);
    // The same position and the same car unrotated occupies 0.045 cells and fits.
    expect(() => assembleVehicles([car({ z: 0.92 })], FOOT),
      '沒轉的車被誤判成越界').not.toThrow();
  });

  it('should return an empty geometry when nothing is parked', () => {
    const geo = assembleVehicles([], FOOT);
    expect(geo.getAttribute('position').count).toBe(0);
    expect(geo.getAttribute('color'), '空幾何也要有 color —— 材質吃頂點色').toBeTruthy();
  });

  /**
   * Different vehicle kinds carry **different attribute sets**.
   *
   * Aircraft are `position,normal,color` and the eight ground vehicles are
   * `position,normal,color,uv`. On a mismatch `mergeGeometries` **prints one console.error and
   * returns null**; it does not throw. So the `!` in `mergeGeometries(parts)!` lies to
   * TypeScript, and the null travels all the way to `new THREE.Mesh` in the browser before
   * failing.
   *
   * That is exactly how it escapes every test: the data table's "must not throw" stays green
   * because nothing throws, and it only shows when the game is actually opened. The airport is
   * the first building to park an aircraft and a bus on one plot.
   */
  it('should merge vehicles whose geometries carry different attributes', () => {
    const geo = assembleVehicles([
      { kind: 'airplane', x: 0, z: -0.3 },
      { kind: 'bus', x: 0, z: 0.5 },
    ], { w: 4, h: 4 });
    expect(geo, 'mergeGeometries 回傳了 null').toBeTruthy();
    expect(geo.getAttribute('position').count, '合併之後是空的').toBeGreaterThan(0);
    expect(geo.getAttribute('color'), '合併之後掉了頂點色').toBeTruthy();
  });

  /**
   * A parked vehicle and a driving one of the same type have to be **the same colour**.
   *
   * This fails with no visible symptom: vehicle geometry writes the body's vertex colour as
   * (1, 1, 1) and the real colour is multiplied in by `VehicleRenderer`'s per-instance
   * `setColorAt`, while `assembleVehicles` produces a plain `Mesh` with no per-instance colour.
   * The fire engine outside a fire station is therefore **white**.
   *
   * It looks like a fire engine that is not quite dark enough, and in fact it has no colour at
   * all.
   */
  it('should paint a parked vehicle the colour that type drives in', () => {
    const named: Array<[CivicVehicle['kind'], string]> = [
      ['policeCar', 'police_car'], ['ambulance', 'ambulance'],
      ['firetruck', 'firetruck'], ['bus', 'bus'], ['garbageTruck', 'garbage_truck'],
    ];
    for (const [kind, key] of named) {
      expect(civicVehicleTint(kind), `${kind} 停著與開著不同色`)
        .toBe(VEHICLE_CONFIG[key]!.color);
    }
  });

  it('should give a colour even to the types that drive in random ones', () => {
    // `VEHICLE_CONFIG.color === -1` means "pick from a palette per vehicle", and picking needs a
    // vehicle id, which a parked vehicle has none of. Civic buildings have no variants either, so
    // a fixed value is needed.
    for (const kind of ['car', 'van', 'truck', 'airplane'] as const) {
      expect(civicVehicleTint(kind), `${kind} 沒有定色`).toBeGreaterThan(0);
    }
  });

  it('should actually put the colour on the geometry', () => {
    // A fire engine's body vertex colour is (1, 1, 1). Without the multiply it is white.
    const geo = assembleVehicles([car({ kind: 'firetruck' })], { w: 2, h: 2 });
    const c = geo.getAttribute('color');
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < c.count; i++) { r += c.getX(i); g += c.getY(i); b += c.getZ(i); }
    expect(r / Math.max(g, 1e-6), '消防車不是紅的').toBeGreaterThan(1.6);
    expect(r / Math.max(b, 1e-6), '消防車不是紅的').toBeGreaterThan(1.6);
  });

  it('should let a plan override the tint', () => {
    // An airport's ground crew truck is pale, while trucks on the street draw from a random
    // palette.
    const plain = assembleVehicles([car({ kind: 'truck' })], { w: 2, h: 2 });
    const white = assembleVehicles(
      [car({ kind: 'truck', tint: 0xffffff })], { w: 2, h: 2 });
    const sum = (g: THREE.BufferGeometry) => {
      const a = g.getAttribute('color');
      let t = 0;
      for (let i = 0; i < a.count; i++) t += a.getX(i) + a.getY(i) + a.getZ(i);
      return t;
    };
    expect(sum(white), '覆寫的顏色沒有生效').toBeGreaterThan(sum(plain));
  });

  /**
   * An aircraft is more than its fuselage.
   *
   * `VehicleRenderer` draws it as two instanced meshes, the fuselage and the **vertical tail**,
   * separated so the tail can carry its own livery colour. Taking `buildAirplaneGeometry()` alone
   * leaves an aircraft parked on an apron with no tail, which is visible at a glance.
   *
   * The same principle as the patrol car and the fire engine: parked and driving have to be the
   * same vehicle.
   */
  it('should give the parked aeroplane its vertical tail', () => {
    const parked = assembleVehicles(
      [{ kind: 'airplane', x: 0, z: 0 }], { w: 4, h: 4 });
    expect(triangleCount(parked), '停著的飛機少了尾翼')
      .toBe(triangleCount(buildAirplaneGeometry())
        + triangleCount(buildAirplaneVTailGeometry()));
  });

  it('should paint the tail fin in its own colour', () => {
    // With the tail the same colour as the fuselage, splitting it into two pieces is wasted, and
    // an airline's livery is recognised from the tail.
    //
    // The check is that the tail's colours **actually appear** in the result. "The whole vehicle
    // has more than one colour" does not catch this: the fuselage already carries several colours
    // for windows and wings, and a tail coloured like the fuselage passes.
    const tail = buildAirplaneVTailGeometry();
    const tc = tail.getAttribute('color');
    const r = ((PARKED_TAIL_TINT >> 16) & 0xff) / 255;
    const g = ((PARKED_TAIL_TINT >> 8) & 0xff) / 255;
    const b = (PARKED_TAIL_TINT & 0xff) / 255;
    const want = new Set<string>();
    for (let i = 0; i < tc.count; i++) {
      want.add([tc.getX(i) * r, tc.getY(i) * g, tc.getZ(i) * b]
        .map(v => v.toFixed(3)).join(','));
    }

    const geo = assembleVehicles([{ kind: 'airplane', x: 0, z: 0 }], { w: 4, h: 4 });
    const c = geo.getAttribute('color');
    const got = new Set<string>();
    for (let i = 0; i < c.count; i++) {
      got.add([c.getX(i), c.getY(i), c.getZ(i)].map(v => v.toFixed(3)).join(','));
    }
    for (const w of want) {
      expect(got.has(w), `尾翼沒有塗上自己的顏色（缺 ${w}）`).toBe(true);
    }
  });

  it('should measure the aeroplane bounds across both pieces', () => {
    // With the guard reading the fuselage alone, a tail can reach off the plot unchecked.
    const tail = buildAirplaneVTailGeometry();
    tail.computeBoundingBox();
    const body = buildAirplaneGeometry();
    body.computeBoundingBox();
    const geo = assembleVehicles(
      [{ kind: 'airplane', x: 0, z: 0 }], { w: 4, h: 4 });
    geo.computeBoundingBox();
    expect(geo.boundingBox!.max.y, '尾翼沒有算進包圍盒')
      .toBeGreaterThanOrEqual(Math.max(tail.boundingBox!.max.y, body.boundingBox!.max.y) - 1e-9);
  });

  it('should support every vehicle the city already has', () => {
    // Fire stations need engines, hospitals need ambulances, landfills need refuse trucks: the
    // later batches all draw on this.
    const kinds: CivicVehicle['kind'][] = [
      'car', 'policeCar', 'ambulance', 'firetruck', 'bus', 'garbageTruck', 'van', 'truck',
    ];
    for (const kind of kinds) {
      expect(() => assembleVehicles([car({ kind })], FOOT), `${kind} 建不出來`)
        .not.toThrow();
    }
  });

  /**
   * A failed merge has to fail **loudly**.
   *
   * `mergeGeometries` fails by returning null, and `!` turns that into a type-level lie. Feeding
   * it a geometry whose attributes cannot be reconciled should throw on the spot rather than
   * return null.
   */
  it('should throw, not return null, when geometries cannot be merged', () => {
    const bad = new THREE.BufferGeometry();
    bad.setAttribute('position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3));
    expect(() => mergeOrThrow([bad, buildPoliceCarGeometry()], '測試'))
      .toThrow(/merge failed/);
  });
});
