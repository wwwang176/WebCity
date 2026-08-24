import { describe, it, expect } from 'vitest';
import { firePlan } from '../fire';
import { FACADE_CIVIC, PART_DETAIL, PART_LAMP } from '../../../buildings/parts';
import { topOf } from '../../../buildings/massing/volume';
import { propExtent } from '../../../props';
import { civicColorOf } from '../../colors';
import { civicVehicleTint } from '../../assemble';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';

const plan = firePlan;
const m = (cells: number) => cells * METRES_PER_CELL;

/**
 * The shared checks — footprint, budget, night lights, sitting on the ground, non-overlapping
 * masses, canopy clearance — live in the table in `CivicPlans.test.ts`. This file holds only the
 * shape constraints **specific to** a fire station.
 *
 * It has three recognition features, and without any one of them it is mistaken for another
 * civic building: a row of roller doors, a training tower on the ground, and a red body.
 */
describe('消防局', () => {
  const doors = plan.massing.filter(v => v.tag === 'door');
  const tower = plan.massing.find(v => v.tag === 'tower')!;
  const bay = plan.massing.find(v => v.tag === 'bay')!;

  it('should occupy 2x2', () => {
    expect(plan.footprint).toEqual({ w: 2, h: 2 });
    expect(plan.facade).toBe(FACADE_CIVIC);
  });

  it('should be red', () => {
    // In an isometric view colour is recognised before silhouette. A fire station being red is
    // functional, not decorative.
    expect(plan.color).toEqual(civicColorOf('fire'));
    const [r, g, b] = plan.color;
    expect(r, '主體不夠紅').toBeGreaterThan(0.5);
    expect(r).toBeGreaterThan(g * 1.5);
    expect(r).toBeGreaterThan(b * 1.5);
  });

  it('should line up a row of roller doors', () => {
    // The strongest recognition signal a fire station has: a row of evenly spaced doors. Fewer
    // than three reads as a garage.
    expect(doors.length, '捲門不成排').toBeGreaterThanOrEqual(3);
    const xs = doors.map(d => d.x).sort((a, b) => a - b);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    for (const g of gaps) {
      expect(m(g), `捲門間距不均：${m(g).toFixed(1)} m`).toBeCloseTo(m(gaps[0]!), 3);
    }
  });

  it('should make the doors big enough for an engine to drive through', () => {
    // A fire engine is 6.7 x 1.8 x 1.9 m, the actual dimensions from `buildFiretruckGeometry`.
    // With doors smaller than the engine, the row reads as decorative panels on a wall.
    for (const d of doors) {
      expect(m(d.w), `捲門只有 ${m(d.w).toFixed(1)} m 寬`).toBeGreaterThan(3.2);
      expect(m(d.y1 - d.y0), `捲門只有 ${m(d.y1 - d.y0).toFixed(1)} m 高`)
        .toBeGreaterThan(4.0);
    }
  });

  it('should face all the doors the same way, onto the apron', () => {
    // A row means all the doors face the same way, and they face +z, the forecourt side; facing
    // back, an engine turning out hits a wall.
    for (const d of doors) {
      expect(d.z, '捲門不在同一面牆上').toBeCloseTo(doors[0]!.z, 6);
      expect(d.z, '捲門朝著建築的背面').toBeGreaterThan(bay.z);
    }
  });

  it('should stand the doors proud of the bay wall, not inside it', () => {
    // Sunk into the wall they are invisible interior faces: triangles spent for nothing, and no
    // door on screen at all. The bay's leading edge is at bay.z + bay.d / 2, and each door stands
    // entirely outside it.
    const wall = bay.z + bay.d / 2;
    for (const d of doors) {
      expect(d.z - d.d / 2, '捲門埋在牆裡').toBeGreaterThanOrEqual(wall - 1e-9);
    }
  });

  it('should not let the doors grow windows', () => {
    // A roller door is a metal panel. Tagged PART_WALL it grows a grid of windows.
    for (const d of doors) expect(d.part).toBe(PART_DETAIL);
  });

  it('should give the apparatus bay the headroom an engine needs', () => {
    // The bay is double height. Level with the dorm block beside it, the whole building is one
    // box.
    expect(m(bay.y1), `機房只有 ${m(bay.y1).toFixed(1)} m 高`).toBeGreaterThan(6.0);
  });

  it('should stand the training tower on the ground', () => {
    // The training tower, which doubles as a hose drying tower, is a fire station's second
    // recognition feature, and what separates it from a police station's watchtower is **standing
    // on the ground**: that one is stacked on a wing's roof. With both towers on roofs, the two
    // buildings' silhouettes stop separating.
    expect(tower, '找不到訓練塔').toBeTruthy();
    expect(tower.y0, '訓練塔浮在半空').toBeCloseTo(0, 9);
  });

  it('should keep the training tower slender and tallest', () => {
    // A short, wide tower reads as another building.
    const h = tower.y1 - tower.y0;
    expect(h / Math.max(tower.w, tower.d), '訓練塔太胖').toBeGreaterThan(3);
    for (const v of plan.massing) {
      if (v.tag === 'tower' || v.tag === 'towerCap') continue;
      expect(tower.y1, `${v.tag} 高過訓練塔`).toBeGreaterThan(v.y1);
    }
  });

  it('should stay at a believable height for a fire station', () => {
    const top = m(topOf(plan.massing));
    expect(top).toBeGreaterThan(17);
    expect(top).toBeLessThan(26);
  });

  /**
   * Nothing stands in front of the doors.
   *
   * This is the one genuinely **functional** constraint here: an engine has to be able to turn
   * out. A tree planted in a doorway is the first thing anyone would laugh at, and it is entirely
   * legal in the data table — no overrun, no budget exceeded.
   *
   * Only `fixtures` are checked, since they all sit on the ground. A fire engine on the forecourt
   * **is** parked on the apron: it reads as an engine that has just turned out, which is the
   * intended picture.
   */
  it('should keep the run-out lanes clear of street furniture', () => {
    const edge = plan.footprint.h / 2;
    for (const d of doors) {
      const lane = { x0: d.x - d.w / 2, x1: d.x + d.w / 2, z0: d.z + d.d / 2, z1: edge };
      for (const f of plan.fixtures) {
        const e = propExtent(f);
        const hitX = f.x + e.x > lane.x0 + 1e-9 && f.x - e.x < lane.x1 - 1e-9;
        const hitZ = f.z + e.z > lane.z0 + 1e-9 && f.z - e.z < lane.z1 - 1e-9;
        expect(hitX && hitZ,
          `${f.kind} 擋在 x=${m(d.x).toFixed(1)} 的車道上`).toBe(false);
      }
    }
  });

  it('should pave a hard apron in front of the doors', () => {
    // With grass in front of the doors, an engine drives over the lawn to leave.
    const base = plan.decals.filter(d => (d.layer ?? 'base') === 'base');
    const apron = base.find(d => d.z - d.d / 2 <= doors[0]!.z && d.z + d.d / 2 > doors[0]!.z)!;
    expect(apron, '門前沒有鋪面').toBeTruthy();
    expect(apron.lawn, '門前鋪的是草地').toBeFalsy();
    expect(m(apron.d), '前庭太淺，消防車轉不出去').toBeGreaterThan(6);
  });

  it('should mark the lanes on the road surface', () => {
    const marks = plan.decals.filter(d => d.layer === 'mark');
    expect(marks.length, '車道沒有標線').toBeGreaterThan(0);
    for (const d of marks) expect(d.shade, '標線不是白漆').toBeGreaterThan(0.7);
  });

  it('should light the doors and the apron', () => {
    // The warning lights above the doors are a fire station's night-time signal.
    const beacons = plan.props.filter(v => v.part === PART_LAMP);
    expect(beacons.length, '門楣上沒有燈').toBeGreaterThanOrEqual(doors.length);
    expect(plan.fixtures.filter(f => f.kind === 'lamp').length, '前庭的路燈太少')
      .toBeGreaterThanOrEqual(3);
  });

  /**
   * A fire engine has to be **darker** than the station.
   *
   * At the same red as the station's walls (both `0xd32f2f`), an engine parked in front of a wall
   * matches it, which is the same as having no engine.
   *
   * The comparison is relative to this building rather than against a hard-coded hex value: tune
   * the station's red and this case demands the engine follow.
   */
  it('should be darker than the station it parks at', () => {
    const truck = civicVehicleTint('firetruck');
    const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
    const truckLum = lum(
      (truck >> 16) & 0xff, (truck >> 8) & 0xff, truck & 0xff);
    const [wr, wg, wb] = plan.color;
    const wallLum = lum(wr * 255, wg * 255, wb * 255);
    expect(truckLum, '消防車與消防局的牆一樣亮 —— 停在牆前就看不見了')
      .toBeLessThan(wallLum * 0.85);
  });

  it('should park real fire engines', () => {
    // A parked engine and one responding on the street have to be the same vehicle.
    expect(plan.vehicles.filter(v => v.kind === 'firetruck').length, '沒有消防車')
      .toBeGreaterThanOrEqual(2);
    for (const v of plan.vehicles) {
      expect(v.rotationY, `${v.kind} 沒有轉成車頭朝外`).toBeCloseTo(Math.PI / 2, 6);
    }
  });

  it('should have its own hydrants', () => {
    // A fire station with no hydrant outside it is the least convincing thing there is.
    expect(plan.fixtures.filter(f => f.kind === 'hydrant').length)
      .toBeGreaterThanOrEqual(2);
  });

  it('should use the shared primitives instead of re-drawing them', () => {
    for (const kind of ['tree', 'shrub', 'flowerBed', 'lamp', 'flagpole'] as const) {
      expect(plan.fixtures.some(f => f.kind === kind), `${kind} 沒有走共用圖元`)
        .toBe(true);
    }
    // The custom masses are only what the shared primitives genuinely lack: the roller doors and
    // the warning lights above them.
    expect(new Set(plan.props.map(v => v.tag)), '自訂量體裡混進了共用圖元有的東西')
      .toEqual(new Set(['beacon']));
  });
});
