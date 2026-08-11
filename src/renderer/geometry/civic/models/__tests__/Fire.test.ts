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
 * 共通的驗收（佔地、預算、夜燈、貼地、量體不重疊、雨棚淨空）在
 * `CivicPlans.test.ts` 的資料表裡。這裡只寫消防局**獨有**的形狀約束。
 *
 * 它的辨識特徵有三個，缺一個就會被誤認成別的公共建築：
 * 一整排捲門、落地的訓練塔、紅色主體。
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
    // 等角視角下顏色比剪影更早被認出來。消防局是紅的不是裝飾，是功能。
    expect(plan.color).toEqual(civicColorOf('fire'));
    const [r, g, b] = plan.color;
    expect(r, '主體不夠紅').toBeGreaterThan(0.5);
    expect(r).toBeGreaterThan(g * 1.5);
    expect(r).toBeGreaterThan(b * 1.5);
  });

  it('should line up a row of roller doors', () => {
    // 這是消防局最強的辨識訊號 —— 一排等距的大門。少於三扇讀起來像車庫。
    expect(doors.length, '捲門不成排').toBeGreaterThanOrEqual(3);
    const xs = doors.map(d => d.x).sort((a, b) => a - b);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    for (const g of gaps) {
      expect(m(g), `捲門間距不均：${m(g).toFixed(1)} m`).toBeCloseTo(m(gaps[0]!), 3);
    }
  });

  it('should make the doors big enough for an engine to drive through', () => {
    // 消防車 6.7 x 1.8 x 1.9 m（`buildFiretruckGeometry` 的實際尺寸）。
    // 門洞比車小的話，畫面上那排門看起來就只是牆上的裝飾板。
    for (const d of doors) {
      expect(m(d.w), `捲門只有 ${m(d.w).toFixed(1)} m 寬`).toBeGreaterThan(3.2);
      expect(m(d.y1 - d.y0), `捲門只有 ${m(d.y1 - d.y0).toFixed(1)} m 高`)
        .toBeGreaterThan(4.0);
    }
  });

  it('should face all the doors the same way, onto the apron', () => {
    // 一排門朝同一個方向才叫「一排」。而且要朝 +z（前庭那一側）——
    // 朝後的話消防車開出來就撞牆。
    for (const d of doors) {
      expect(d.z, '捲門不在同一面牆上').toBeCloseTo(doors[0]!.z, 6);
      expect(d.z, '捲門朝著建築的背面').toBeGreaterThan(bay.z);
    }
  });

  it('should stand the doors proud of the bay wall, not inside it', () => {
    // 埋進牆裡的話是看不見的內部面：白吃三角形，畫面上完全沒有門。
    // 機房前緣在 bay.z + bay.d / 2，門要整片在它之外。
    const wall = bay.z + bay.d / 2;
    for (const d of doors) {
      expect(d.z - d.d / 2, '捲門埋在牆裡').toBeGreaterThanOrEqual(wall - 1e-9);
    }
  });

  it('should not let the doors grow windows', () => {
    // 捲門是金屬板。標成 PART_WALL 的話它會長出一格一格的窗。
    for (const d of doors) expect(d.part).toBe(PART_DETAIL);
  });

  it('should give the apparatus bay the headroom an engine needs', () => {
    // 車庫要挑高。與旁邊的宿舍樓一樣高的話，整棟就是一個方盒子。
    expect(m(bay.y1), `機房只有 ${m(bay.y1).toFixed(1)} m 高`).toBeGreaterThan(6.0);
  });

  it('should stand the training tower on the ground', () => {
    // 訓練塔（兼水帶晾乾塔）是消防局的第二個辨識特徵，而它與警局的瞭望塔
    // 差在**它落地**：警局那座疊在翼樓屋頂上。兩座塔都架在屋頂上的話，
    // 兩棟建築的剪影就分不出來了。
    expect(tower, '找不到訓練塔').toBeTruthy();
    expect(tower.y0, '訓練塔浮在半空').toBeCloseTo(0, 9);
  });

  it('should keep the training tower slender and tallest', () => {
    // 又矮又胖的塔讀起來是「另一棟樓」。
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
   * 門前不准放東西。
   *
   * 這是這一棟唯一真正的**機能**約束：消防車要開得出去。一棵種在門口的樹是
   * 所有人第一眼就會看到的笑話，而它在資料表裡完全合法（沒有越界、沒有超支）。
   *
   * 只檢查 `fixtures`（全部落地）。停在前庭上的消防車**是**停在車道上的 ——
   * 那是「車剛開出來」，正是想要的畫面。
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
    // 門前是草地的話，消防車要輾過草坪才出得去。
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
    // 門楣上的警示燈是消防局夜裡的辨識訊號。
    const beacons = plan.props.filter(v => v.part === PART_LAMP);
    expect(beacons.length, '門楣上沒有燈').toBeGreaterThanOrEqual(doors.length);
    expect(plan.fixtures.filter(f => f.kind === 'lamp').length, '前庭的路燈太少')
      .toBeGreaterThanOrEqual(3);
  });

  /**
   * 消防車要比消防局**暗**。
   *
   * 使用者：「消防車應該是暗紅色的」。原因比「比較好看」具體：消防車原本
   * 與消防局的牆是**同一個紅**（兩邊都是 `0xd32f2f`）—— 一台停在牆前面的
   * 車與牆同色，等於沒有車。
   *
   * 比的是與這一棟建築的關係，不是一個寫死的十六進位值：哪天有人調了消防局
   * 的紅，這條測試會跟著要求車也調。
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
    // 停著的消防車與街上出勤的消防車必須是同一台。
    expect(plan.vehicles.filter(v => v.kind === 'firetruck').length, '沒有消防車')
      .toBeGreaterThanOrEqual(2);
    for (const v of plan.vehicles) {
      expect(v.rotationY, `${v.kind} 沒有轉成車頭朝外`).toBeCloseTo(Math.PI / 2, 6);
    }
  });

  it('should have its own hydrants', () => {
    // 消防隊自己的門口沒有消防栓是最沒有說服力的一件事。
    expect(plan.fixtures.filter(f => f.kind === 'hydrant').length)
      .toBeGreaterThanOrEqual(2);
  });

  it('should use the shared primitives instead of re-drawing them', () => {
    for (const kind of ['tree', 'shrub', 'flowerBed', 'lamp', 'flagpole'] as const) {
      expect(plan.fixtures.some(f => f.kind === kind), `${kind} 沒有走共用圖元`)
        .toBe(true);
    }
    // 自訂量體只剩共用圖元裡真的沒有的東西：捲門與門楣警示燈。
    expect(new Set(plan.props.map(v => v.tag)), '自訂量體裡混進了共用圖元有的東西')
      .toEqual(new Set(['beacon']));
  });
});
