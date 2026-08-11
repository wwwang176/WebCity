import { describe, it, expect } from 'vitest';
import {
  airportSmallPlan, airportMediumPlan, airportLargePlan,
} from '../airport';
import { FACADE_TRANSIT, PART_LAMP } from '../../../buildings/parts';
import { topOf } from '../../../buildings/massing/volume';
import { assembleVehicles } from '../../assemble';
import { civicColorOf } from '../../colors';
import {
  allFlightPaths, allGates, runwayCentrelines, taxiwayX, apronLaneZ,
  type Vec2,
} from '../../../../airportPaths';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';
import type { AirportSize } from '../../../../../core/transport/AirportSystem';
import type { CivicPlan, CivicVolume } from '../../types';

const m = (cells: number) => cells * METRES_PER_CELL;
const tagged = (p: CivicPlan, tag: string) => p.massing.filter(v => v.tag === tag);
const marks = (p: CivicPlan) => p.decals.filter(d => d.layer === 'mark');
const bands = (p: CivicPlan) =>
  p.decals.filter(d => (d.layer ?? 'base') === 'base').sort((a, b) => a.z - b.z);

const PLANS = [
  ['小型機場', airportSmallPlan, 'airport_s', 'SMALL', 5, 4],
  ['中型機場', airportMediumPlan, 'airport_m', 'MEDIUM', 7, 4],
  ['大型機場', airportLargePlan, 'airport_l', 'LARGE', 9, 6],
] as const;

/** 一塊軸對齊矩形蓋不蓋得到某個點。 */
const covers = (d: { x: number; z: number; w: number; d: number }, p: Vec2) =>
  Math.abs(p.x - d.x) <= d.w / 2 + 1e-9 && Math.abs(p.z - d.z) <= d.d / 2 + 1e-9;

/**
 * 飛機在地面上會經過的每一個航點。
 *
 * `approachStart` / `climbEnd` 不算 —— 那兩個在天上，而且遠在佔地之外。
 */
function groundWaypoints(size: AirportSize): Array<{ name: string; p: Vec2 }> {
  const out: Array<{ name: string; p: Vec2 }> = [];
  for (const [i, path] of allFlightPaths(size).entries()) {
    const named: Array<[string, Vec2]> = [
      ['threshold', path.threshold],
      ['rollStop', path.rollStop],
      ['rightJunction', path.rightJunction],
      ['rightTaxiTop', path.rightTaxiTop],
      ['leftTaxiTop', path.leftTaxiTop],
      ['leftJunction', path.leftJunction],
      ['runwayEntry', path.runwayEntry],
      ['takeoffEnd', path.takeoffEnd],
      ...path.gates.map((g, j): [string, Vec2] => [`gate${j}`, g]),
    ];
    for (const [name, p] of named) out.push({ name: `路徑${i}.${name}`, p });
  }
  return out;
}

/**
 * 三座機場。共通的驗收在 `CivicPlans.test.ts` 的資料表裡。
 *
 * 這一組測試最重要的一件事是**裝飾幾何與 `AirplaneAnimator` 的航路表對得上**
 * （BUG-239）。第一版兩邊各自畫了一座機場：動畫的跑道在前側 z = +1.20，
 * 貼片的跑道帶在後側 —— 接起來的那一刻飛機會沿著航廈的屋頂降落。
 */
describe.each(PLANS)('%s', (_label, plan, type, size, w, h) => {
  it('should match its declared footprint', () => {
    expect(plan.footprint).toEqual({ w, h });
    expect(plan.facade).toBe(FACADE_TRANSIT);
    expect(plan.color).toEqual(civicColorOf(type));
  });

  it('should tile the whole plot with paving, edge to edge', () => {
    // 中間漏一條的話那裡是一塊裸地，而 `assembleDecals` 只擋重疊、不擋空隙。
    const b = bands(plan);
    expect(b[0]!.z - b[0]!.d / 2, '後緣沒有鋪到底').toBeCloseTo(-h / 2, 9);
    expect(b[b.length - 1]!.z + b[b.length - 1]!.d / 2, '前緣沒有鋪到底')
      .toBeCloseTo(h / 2, 9);
    for (let i = 1; i < b.length; i++) {
      expect(b[i]!.z - b[i]!.d / 2, `第 ${i} 條帶與前一條之間有空隙`)
        .toBeCloseTo(b[i - 1]!.z + b[i - 1]!.d / 2, 9);
    }
    for (const d of b) {
      expect(d.w, '有一條帶沒有鋪滿整個寬度').toBeCloseTo(w, 9);
      expect(d.lawn, '跑道上長草').toBeFalsy();
    }
  });

  // ── 與航路表對得上（BUG-239） ──────────────────────────────

  /**
   * 飛機走過的每一寸地都要是**鋪面**。
   *
   * 這是 BUG-239 的直接敘述。第一版的小型機場，`threshold`（z = +1.20）落在
   * 裝飾幾何的航廈帶裡 —— 飛機沿著屋頂降落。
   */
  it('should pave every point the aeroplane drives over', () => {
    for (const { name, p } of groundWaypoints(size)) {
      if (Math.abs(p.x) > w / 2 || Math.abs(p.z) > h / 2) continue;   // 佔地之外
      const on = bands(plan).find(d => covers(d, p));
      expect(on, `${name} (${p.x}, ${p.z}) 底下沒有鋪面`).toBeTruthy();
      expect(on!.lawn, `${name} 底下是草地`).toBeFalsy();
    }
  });

  /**
   * 而且不准有東西擋在上面。
   *
   * 航廈、塔台、空橋、停著的飛機 —— 任何一個蓋在航點上，動畫飛機就會穿過它。
   */
  it('should keep every building and parked vehicle off the flight path', () => {
    const blockers: Array<{ what: string; v: CivicVolume }> = [
      ...plan.massing.filter(v => !/Light$/.test(v.tag ?? ''))
        .map(v => ({ what: `量體 ${v.tag}`, v })),
      ...plan.overhead.map(v => ({ what: `懸挑 ${v.tag}`, v })),
    ];
    for (const { name, p } of groundWaypoints(size)) {
      for (const { what, v } of blockers) {
        // 空橋**必須**伸到機位旁邊，所以它只要不蓋住機位中心就好。
        expect(covers(v, p), `${what} 蓋在 ${name} 上`).toBe(false);
      }
    }
  });

  /**
   * 停在停機位上的靜態飛機會被動畫飛機停在身上。
   *
   * `AirplaneAnimator` 停泊 5 秒，而它只避開**其他動畫飛機**佔用的機位
   * —— `CivicPlan.vehicles` 裡的不在那個集合裡。
   */
  it('should never park a static aeroplane on a working gate or taxiway', () => {
    const CLEAR = 0.45;
    for (const v of plan.vehicles) {
      const geo = assembleVehicles([v], plan.footprint);
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      const box = {
        x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2,
        w: b.max.x - b.min.x, d: b.max.z - b.min.z,
      };
      for (const g of allGates(size)) {
        expect(covers(box, g), `${v.kind} 停在機位 (${g.x}, ${g.z}) 上`).toBe(false);
      }
      // 縱向滑行道那兩條帶也不能停。
      const clearOfTaxi = Math.abs(Math.abs(box.x) - taxiwayX(size))
        >= box.w / 2 + CLEAR - 1e-9;
      const behindApron = box.z + box.d / 2 < apronLaneZ(size);
      expect(clearOfTaxi || behindApron, `${v.kind} 停在縱向滑行道上`).toBe(true);
    }
  });

  it('should draw the runway where the flight path says it is', () => {
    // 跑道中線是航路表的 `threshold.z`。畫在別的地方的話，飛機會落在
    // 一條沒有標線的柏油上，而旁邊有一條沒有飛機的跑道。
    for (const c of runwayCentrelines(size)) {
      const centre = marks(plan).filter(d =>
        Math.abs(d.z - c) < 1e-9 && d.w > d.d);
      expect(centre.length, `z = ${c} 的跑道沒有中線`).toBeGreaterThan(3);
      for (const d of centre) {
        expect(d.w, '跑道中線畫成連續的了 —— 那是滑行道的畫法')
          .toBeLessThan(w / 2);
      }
    }
  });

  it('should draw the taxiway centreline along the route the aeroplane takes', () => {
    // 縱向滑行道在 ±taxiwayX，從橫向聯絡道接到最遠的那條跑道。
    const tx = taxiwayX(size);
    const lane = apronLaneZ(size);
    const far = Math.max(...runwayCentrelines(size));
    for (const side of [-1, 1]) {
      const line = marks(plan).find(d =>
        Math.abs(d.x - side * tx) < 1e-9 && d.d > d.w);
      expect(line, `x = ${side * tx} 沒有縱向滑行道中線`).toBeTruthy();
      expect(line!.z - line!.d / 2, '滑行道沒有接到橫向聯絡道')
        .toBeCloseTo(lane, 9);
      expect(line!.z + line!.d / 2, '滑行道沒有接到最遠那條跑道')
        .toBeCloseTo(far, 9);
    }
    const cross = marks(plan).find(d => Math.abs(d.z - lane) < 1e-9 && d.w > d.d);
    expect(cross, '沒有橫向聯絡道').toBeTruthy();
    expect(cross!.w / 2, '橫向聯絡道沒有接到兩側的縱向滑行道')
      .toBeCloseTo(tx, 9);
  });

  it('should hold aircraft short of every runway', () => {
    // 每一條跑道前都要有等待線 —— 大型機場有兩條，只畫一條的話另一條沒有。
    const tx = taxiwayX(size);
    for (const c of runwayCentrelines(size)) {
      // `d.w > d.d` 才是**橫**的等待線 —— 少了它，沿著同一個 x 走的縱向
      // 滑行道中線也會被算進來（它的中心 z 剛好也落在這個區間）。
      const hold = marks(plan).filter(d =>
        Math.abs(Math.abs(d.x) - tx) < 1e-9 && d.w > d.d
        && d.z > c - 0.7 && d.z < c);
      expect(hold.length, `z = ${c} 的跑道前沒有兩道等待線`).toBe(2);
    }
  });

  it('should lead every gate in from the apron lane', () => {
    const lane = apronLaneZ(size);
    for (const g of allGates(size)) {
      const lead = marks(plan).find(d =>
        Math.abs(d.x - g.x) < 1e-9 && d.d > d.w);
      expect(lead, `機位 ${g.x} 沒有導引線`).toBeTruthy();
      expect(Math.min(lead!.z - lead!.d / 2, lead!.z + lead!.d / 2),
        '導引線沒有接到機位').toBeCloseTo(Math.min(lane, g.z), 9);
    }
  });

  it('should bridge exactly the gates the flight paths use', () => {
    // 大型機場的兩條航路共用中間那個機位。直接串起來的話它會出現兩次，
    // 而「每個機位一條空橋」就會多畫一條疊在一起的。
    const bridges = plan.overhead.filter(v => v.tag === 'jetBridge');
    const gates = allGates(size);
    expect(bridges.length, '空橋數與機位數對不上').toBe(gates.length);
    for (const g of gates) {
      expect(bridges.some(b => Math.abs(b.x - g.x) < 1e-9),
        `機位 ${g.x} 沒有空橋`).toBe(true);
    }
  });

  // ── 夜間語彙 ──────────────────────────────────────────────

  it('should light the runway, the thresholds and the taxiway', () => {
    for (const tag of ['runwayLight', 'thresholdLight', 'taxiwayLight']) {
      const lights = tagged(plan, tag);
      expect(lights.length, `${tag} 一顆都沒有`).toBeGreaterThanOrEqual(4);
      for (const l of lights) expect(l.part, `${tag} 不會亮`).toBe(PART_LAMP);
    }
  });

  it('should light both edges of every runway', () => {
    for (const c of runwayCentrelines(size)) {
      const near = tagged(plan, 'runwayLight').filter(l => Math.abs(l.z - c) < 0.7);
      expect(near.some(l => l.z < c), `z = ${c} 的跑道後側沒有邊燈`).toBe(true);
      expect(near.some(l => l.z > c), `z = ${c} 的跑道前側沒有邊燈`).toBe(true);
    }
  });

  it('should space the runway lights evenly', () => {
    const c = runwayCentrelines(size)[0]!;
    const row = tagged(plan, 'runwayLight')
      .filter(l => Math.abs(l.z - (c - 0.5)) < 1e-9)
      .map(l => l.x).sort((a, b) => a - b);
    const gaps = row.slice(1).map((x, i) => x - row[i]!);
    for (const g of gaps) {
      expect(m(g), `燈距不齊：${m(g).toFixed(2)} m`).toBeCloseTo(m(gaps[0]!), 6);
    }
  });

  it('should keep every light small enough to be a light', () => {
    for (const v of plan.massing.filter(v => v.part === PART_LAMP)) {
      if (v.tag === 'beacon') continue;
      expect(m(v.y1 - v.y0), `${v.tag} 太大了`).toBeLessThan(1.0);
    }
  });

  it('should make the control tower the tallest thing on the field', () => {
    const cab = tagged(plan, 'towerCab')[0]!;
    const beacon = tagged(plan, 'beacon')[0]!;
    expect(cab.y1, '塔台沒有高過航廈')
      .toBeGreaterThan(tagged(plan, 'terminal')[0]!.y1);
    expect(beacon.y1, '信標不是全場最高的').toBeCloseTo(topOf(plan.massing), 9);
    expect(cab.w, '塔台頂樓沒有外挑').toBeGreaterThan(tagged(plan, 'tower')[0]!.w);
  });

  it('should fence the field', () => {
    expect(plan.fixtures.filter(f => f.kind === 'fence').length, '機場沒有圍籬')
      .toBeGreaterThanOrEqual(3);
  });

  it('should keep the greenery on the landside, behind the terminal', () => {
    // 停機坪那一側是飛機在走的。種在那裡的樹會被輾過去。
    const termFront = tagged(plan, 'terminal')[0]!;
    for (const f of plan.fixtures) {
      if (f.kind !== 'tree' && f.kind !== 'shrub' && f.kind !== 'hedge') continue;
      expect(f.z, `${f.kind} 種到停機坪上`)
        .toBeLessThanOrEqual(termFront.z + termFront.d / 2 + 1e-9);
    }
  });
});

describe('三座機場之間', () => {
  it('should grow the plot and the tower together', () => {
    const sizes = PLANS.map(([, p]) => ({
      cells: p.footprint.w * p.footprint.h,
      tower: topOf(p.massing),
    }));
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]!.cells, '佔地沒有變大').toBeGreaterThan(sizes[i - 1]!.cells);
      expect(sizes[i]!.tower, '塔台沒有變高').toBeGreaterThan(sizes[i - 1]!.tower);
    }
  });

  it('should share one runway vocabulary across all three', () => {
    const spacing = PLANS.map(([, p, , size]) => {
      const c = runwayCentrelines(size)[0]!;
      const row = p.massing.filter(v => v.tag === 'runwayLight'
        && Math.abs(v.z - (c - 0.5)) < 1e-9).map(v => v.x).sort((a, b) => a - b);
      return Math.round(m(row[1]! - row[0]!) * 100) / 100;
    });
    expect(new Set(spacing).size, `三座的跑道燈距不同：${spacing}`).toBe(1);
  });

  it('should give the large airport two runways, as its flight paths do', () => {
    // 大型機場的動畫端有兩條平行航路。只畫一條跑道的話，走 B 路徑的飛機會
    // 落在柏油以外的地方。
    expect(runwayCentrelines('LARGE').length).toBe(2);
    const dark = airportLargePlan.decals.filter(d =>
      (d.layer ?? 'base') === 'base' && d.shade < 0.2);
    expect(dark.length, '大型機場只畫了一條跑道帶').toBe(2);
  });
});
