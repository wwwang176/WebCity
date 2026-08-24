import { describe, it, expect } from 'vitest';
import { powerPlan } from '../power';
import { waterPlan } from '../water';
import { garbagePlan } from '../garbage';
import { sewagePlan } from '../sewage';
import {
  FACADE_UTILITY, PART_GROUND, PART_LAMP, PART_ROOF, PART_SHELL, PART_WATER,
  WATER_MURK_MAX, WATER_BOB,
} from '../../../buildings/parts';
import { TERRAIN_COLORS } from '../../../../terrainColors';
import { TerrainType } from '../../../../../core/grid/types';
import { topOf } from '../../../buildings/massing/volume';
import { civicColorOf } from '../../colors';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';
import { TUB, COOL } from '../../../buildings/massing/metrics';
import type { CivicPlan } from '../../types';

const m = (cells: number) => cells * METRES_PER_CELL;
const tagged = (p: CivicPlan, tag: string) => p.massing.filter(v => v.tag === tag);

const PLANS = [
  ['電廠', powerPlan, 'power'],
  ['水廠', waterPlan, 'water'],
  ['垃圾場', garbagePlan, 'garbage'],
  ['汙水廠', sewagePlan, 'sewage'],
] as const;

/**
 * The four utilities. Their shared acceptance checks live in the table in `CivicPlans.test.ts`.
 *
 * They share `FACADE_UTILITY` (a galvanised corrugated palette plus a high window band) so they
 * read as one family, which is deliberate — they are one class of thing. They differ in
 * **silhouette**: stack, round tank, earth mound, rectangular basin.
 */
describe.each(PLANS)('%s', (_label, plan, type) => {
  it('should use the utility facade and its own colour', () => {
    expect(plan.facade).toBe(FACADE_UTILITY);
    expect(plan.color).toEqual(civicColorOf(type));
    expect(plan.footprint).toEqual({ w: 2, h: 2 });
  });

  it('should fence the site', () => {
    // An unfenced site reads as equipment scattered over grass. Three sides suffice; the
    // fourth is the gate.
    expect(plan.fixtures.filter(f => f.kind === 'fence').length, '廠區沒有圍籬')
      .toBeGreaterThanOrEqual(3);
  });

  it('should read as industrial, not as a garden', () => {
    // Industrial clutter — pipe racks, drums, cylinders, pallets — is the signal that a process
    // runs here.
    const industrial = plan.fixtures.filter(f =>
      f.kind === 'pipeRack' || f.kind === 'drum'
      || f.kind === 'gasBottles' || f.kind === 'palletStack').length;
    expect(industrial, '廠區沒有任何工業雜項').toBeGreaterThanOrEqual(3);
  });

  it('should light the yard with tall masts', () => {
    // These sites are almost entirely paved. Without high masts the whole area is one black
    // patch at night.
    const masts = plan.fixtures.filter(f => f.kind === 'lamp' && f.heightM >= 5);
    expect(masts.length, '廠區的高桿燈太少').toBeGreaterThanOrEqual(3);
  });

  it('should screen itself from the street', () => {
    // A site needs some screening from outside, and it is the signal that someone manages it.
    expect(plan.fixtures.some(f => f.kind === 'hedge'), '沒有對外的綠帶').toBe(true);
    expect(plan.fixtures.filter(f => f.kind === 'tree').length, '一棵樹都沒有')
      .toBeGreaterThanOrEqual(2);
  });

  it('should pave the yard rather than grass it', () => {
    // A power plant on grass does not hold up.
    const base = plan.decals.filter(d => (d.layer ?? 'base') === 'base');
    expect(base.every(d => !d.lawn), '廠區鋪了草地').toBe(true);
  });

  /**
   * Water takes the water branch and earth cover takes the ground branch.
   *
   * Marked as wall, `FACADE_UTILITY` paints a high window band across both.
   *
   * `PART_GROUND` for both is not enough either: the ground ramp runs from asphalt to brick and
   * is **entirely grey**, so basin water at `shade: 0.1` reads as four black holes.
   * `PART_WATER` exists for exactly that (BUG-243).
   *
   * A basin of water is **not** drawing a river of one's own (BUG-244): a river belongs to the
   * terrain, while the water in a basin belongs to this plant — it is what the building does.
   */
  it('should keep every water surface and earth mound out of the wall branch', () => {
    for (const v of plan.massing) {
      const tag = v.tag ?? '';
      if (/Water/.test(tag)) {
        expect(v.part, `${tag} 是灰的 —— 一池水讀起來像一個黑洞`).toBe(PART_WATER);
      } else if (/mound/.test(tag)) {
        expect(v.part, `${tag} 會長出高窗帶`).toBe(PART_GROUND);
      }
    }
  });

  /**
   * A stack or a tower shell grows no windows either, and is **drawn as fair-faced concrete**.
   *
   * A stack has no windows. This is the third shape of the same mistake: without a `part` it is
   * a wall, and `FACADE_UTILITY`'s wall paints a high window band across it — earth cover,
   * water, stacks and cooling towers have all been caught by it.
   *
   * `PART_DETAIL` removes the windows but hard-codes a bluish metal grey
   * (`vec3(m, m*1.02, m*1.06)`, m ~ 0.42-0.58) and never reads `vBldgColor`, leaving the
   * cooling tower — this building's only recognisable silhouette — dark grey where it should be
   * concrete. `PART_SHELL` is the branch that draws a mass in its own colour.
   */
  it('should not put windows on a chimney or a tower shell', () => {
    for (const v of plan.massing) {
      if (!/stack|tankWall/.test(v.tag ?? '')) continue;
      expect(v.part, `${v.tag} 會長出高窗帶`).toBe(PART_SHELL);
      expect(v.color, `${v.tag} 沒有自己的顏色 —— 它會跟著廠區`).toBeDefined();
    }
  });

  it('should give every shaded surface an actual shade', () => {
    // Without `shade` the B channel is 0: asphalt black on the ground branch and the deepest
    // water on the water branch, rather than the intended colour. Nothing reports it.
    const shaded = plan.massing.filter(v =>
      v.part === PART_GROUND || v.part === PART_WATER);
    for (const v of shaded) {
      expect(v.shade, `${v.tag} 吃 B 通道卻沒有明度`).toBeGreaterThan(0);
    }
  });

  /**
   * The water surface has to sit **below the rim**.
   *
   * Flush with the top of the wall (`y0 === wall.y1`), each basin reads as a cylinder with a
   * blue lid rather than a vessel holding water. The difference is the ring of **inner wall**:
   * it is what shows the depth.
   *
   * Lowering y alone does not help — a solid cylinder or box buries the water surface inside the
   * mass as soon as it drops below the top face. So the walls are open containers
   * (`tub` / `basin`), and this case guards that both hold **together**: the water is above the
   * floor and below the rim.
   */
  it('should sink the water below the rim of its vessel', () => {
    const waters = plan.massing.filter(v => v.part === PART_WATER);
    for (const w of waters) {
      const vessel = plan.massing.find(v =>
        /Wall$/.test(v.tag ?? '') && v.x === w.x && v.z === w.z);
      expect(vessel, `${w.tag} 沒有池壁`).toBeTruthy();
      expect(vessel!.shape, `${w.tag} 的池壁是實心的 —— 水面會埋進去`)
        .toMatch(/^(tub|basin)$/);
      const drop = m(vessel!.y1 - w.y1);
      expect(drop, `${w.tag} 的水面只比槽緣低 ${drop.toFixed(2)} m`)
        .toBeGreaterThanOrEqual(0.3);
      const floor = vessel!.y0 + (1 - TUB.DEPTH) * (vessel!.y1 - vessel!.y0);
      expect(w.y0, `${w.tag} 的水面掉到槽底之下`).toBeGreaterThanOrEqual(floor);
      // The water is slightly wider than the inner wall so its sides bury into it; narrower,
      // there is a ring of gap around it showing the ground through.
      expect(w.w, `${w.tag} 與池壁之間有一條縫`)
        .toBeGreaterThan(vessel!.w * TUB.INNER);
      expect(w.w, `${w.tag} 漫出池壁外`).toBeLessThan(vessel!.w);
    }
  });

  it('should keep the ripple inside the pool', () => {
    // With a wave amplitude thicker than the water layer itself, the surface punches through
    // below the floor and above the wall in turn, which looks like the basin leaking.
    for (const v of plan.massing.filter(v => v.part === PART_WATER)) {
      const thick = m(v.y1 - v.y0);
      expect(WATER_BOB.AMP_M, `${v.tag} 的水層只有 ${thick.toFixed(2)} m 厚`)
        .toBeLessThanOrEqual(thick / 2);
    }
  });

  it('should light something without relying on office windows', () => {
    const lamps = [...plan.massing, ...plan.props].filter(v => v.part === PART_LAMP);
    expect(lamps.length, '廠區沒有自己的燈').toBeGreaterThan(0);
  });
});

describe('電廠', () => {
  const stacks = tagged(powerPlan, 'stack');

  /**
   * This building's silhouette is **one thick, waisted tower**.
   *
   * Two cylindrical stacks give almost the same silhouette as the water plant next door — a post
   * and a shed — and posts are everywhere. Two cooling towers are close to 10 m across and take
   * the whole north half of a 24 m plot, reading in an isometric view as two drums covering the
   * hall.
   *
   * One works: no other building in the city is a **waisted surface of revolution**, so the
   * shape itself says "power plant", and one leaves room for the whole switchyard.
   */
  it('should raise a single thick waisted stack', () => {
    expect(stacks.length, '煙囪不是一座').toBe(1);
    const s = stacks[0]!;
    expect(s.shape, '煙囪不是有腰的 —— 那是一根柱子').toBe('cooling');
    expect(s.w, '煙囪不是正圓').toBeCloseTo(s.d, 9);
    expect(m(s.w), '煙囪不夠粗').toBeGreaterThanOrEqual(10);
    // Tall and thin, it is a post again. A real cooling tower's height-to-diameter ratio is
    // between 1.5 and 2.
    expect((s.y1 - s.y0) / s.w, '煙囪太瘦').toBeLessThan(2.2);
    // Both bounds pin the height; with only a lower bound, reverting turns nothing red.
    expect(m(s.y1), '煙囪太矮').toBeGreaterThan(15);
    expect(m(s.y1), '煙囪又長回去了').toBeLessThanOrEqual(22);
  });

  /**
   * The tower mouth has to be **deep enough**, and dark inside.
   *
   * Depth is geometry's job (see `COOL.DEPTH` in `MassingGeometry.test.ts`); what this guards is
   * **colour**. With the mouth's inner wall following the shaft's concrete, the opening is
   * bright however deep it is: the inner wall's normals are horizontal and catch almost the same
   * light as the outside, and this engine has no ambient occlusion. So the mouth carries a dark
   * lining, from the recess's floor up to the rim.
   */
  it('should darken the throat of the stack', () => {
    const s = stacks[0]!;
    const lining = tagged(powerPlan, 'throatLining')
      .find(v => v.x === s.x && v.z === s.z);
    expect(lining, '塔口沒有內襯').toBeTruthy();
    expect(lining!.part, '內襯沒有走塗裝外殼 —— 那條路才照著顏色畫')
      .toBe(PART_SHELL);
    expect(Math.max(...lining!.color!), '內襯不夠暗 —— 那個口會讀成一片平的')
      .toBeLessThan(0.2);
    // The lining is open too: a solid cylinder's top is a disc, and the opening is only that
    // deep.
    expect(lining!.shape, '內襯是實心的 —— 塔口下面會蓋著一塊板子').toBe('tub');
    // Set inside the mouth: narrower than it, running from the recess's floor up to the rim.
    expect(lining!.w, '內襯比塔口還寬 —— 它會從塔身穿出來')
      .toBeLessThan(s.w * COOL.THROAT);
    const bottom = s.y0 + (1 - COOL.DEPTH) * (s.y1 - s.y0);
    expect(m(Math.abs(lining!.y0 - bottom)), '內襯不是從凹槽的底部開始')
      .toBeLessThan(0.6);
    expect(m(Math.abs(lining!.y1 - s.y1)), '內襯沒有頂到塔口')
      .toBeLessThan(0.6);
  });

  /**
   * The switchyard: a row of poles joined by **black conductors**.
   *
   * "Power leaves from here" is half of what a power plant is, and transformers plus gantries
   * alone are a few boxes on the ground with nothing saying they are connected to each other.
   *
   * The conductors are the only thing in this section that actually speaks: they string the
   * scattered equipment into a circuit, and that line is the **only** element spanning the whole
   * site in an isometric view.
   */
  it('should string black wires between the pylons', () => {
    const pylons = tagged(powerPlan, 'pylon');
    const wires = powerPlan.props.filter(v => v.tag === 'wire');
    expect(pylons.length, '電桿不夠多').toBeGreaterThanOrEqual(4);
    for (const p of pylons) {
      expect(m(p.y1), '電桿太矮 —— 高壓線要架在廠房之上').toBeGreaterThanOrEqual(8);
    }
    expect(wires.length, '導線不夠多').toBeGreaterThanOrEqual(8);
    for (const w of wires) {
      expect(w.part, '導線沒有走塗裝外殼 —— 那條路才畫得出黑色').toBe(PART_SHELL);
      expect(Math.max(...w.color!), '導線不是黑的').toBeLessThan(0.15);
      // Thin, long and horizontal. Thick, it is a beam.
      const thin = Math.min(m(w.w), m(w.d));
      const long = Math.max(m(w.w), m(w.d));
      expect(thin, `導線粗達 ${thin.toFixed(2)} m`).toBeLessThanOrEqual(0.15);
      expect(long, '導線太短 —— 那是一截接頭').toBeGreaterThan(3);
      expect(m(w.y1 - w.y0), '導線是垂下來的 —— 那是礙子串').toBeLessThanOrEqual(0.15);
      expect(m(w.y0), '導線掛得太低 —— 人走得到').toBeGreaterThan(4);
    }
  });

  /**
   * Both ends of every conductor have to **land on a pole**.
   *
   * A segment floating in mid-air is legal under every other check here: thin enough, long
   * enough, black enough, high enough. On screen it is a black rod starting and ending in
   * nothing.
   */
  it('should land both ends of every wire on something that holds it', () => {
    const holders = [
      ...tagged(powerPlan, 'pylon'),
      ...powerPlan.props.filter(v => /gantry|crossarm/.test(v.tag ?? '')),
    ];
    for (const w of powerPlan.props.filter(v => v.tag === 'wire')) {
      const alongX = w.w > w.d;
      for (const end of [-1, 1] as const) {
        const ex = alongX ? w.x + end * w.w / 2 : w.x;
        const ez = alongX ? w.z : w.z + end * w.d / 2;
        const held = holders.some(h =>
          Math.abs(h.x - ex) <= h.w / 2 + 1e-9 && Math.abs(h.z - ez) <= h.d / 2 + 1e-9);
        expect(held, `導線 (${m(ex).toFixed(1)}, ${m(ez).toFixed(1)}) 那一端沒有桿`)
          .toBe(true);
      }
    }
  });

  it('should be the tallest of the four utilities', () => {
    // At range only the stack is left, and anything rising above it wastes that.
    const top = m(topOf(powerPlan.massing));
    for (const [, other] of PLANS.filter(([, p]) => p !== powerPlan)) {
      expect(top, '電廠不是最高的').toBeGreaterThan(m(topOf(other.massing)));
    }
  });

  it('should put a warning light on top of each chimney', () => {
    // At night a power plant is that red point in the sky.
    const beacons = tagged(powerPlan, 'beacon');
    expect(beacons.length, '航警燈不足').toBe(stacks.length);
    for (const b of beacons) {
      expect(b.part).toBe(PART_LAMP);
      // Take the nearest stack. With two in a row, comparing z alone attributes both lights to
      // the first one, and the case stays green.
      const host = [...stacks].sort((p, q) =>
        Math.hypot(p.x - b.x, p.z - b.z) - Math.hypot(q.x - b.x, q.z - b.z))[0]!;
      expect(b.y0, '航警燈沒有站在煙囪頂上').toBeCloseTo(host.y1, 9);
      // Standing on the mouth's **rim**: inside it the light falls in, outside the top's outer
      // ring it hangs off the tower. The top is narrower than the declared width, so the outer
      // bound is `COOL.RIM` rather than `host.w / 2`, which is the base radius, where there is
      // nothing.
      expect(Math.abs(b.x - host.x) - b.w / 2, '航警燈架在塔口上')
        .toBeGreaterThanOrEqual(host.w * COOL.THROAT / 2);
      expect(Math.abs(b.x - host.x) + b.w / 2, '航警燈掛到塔外面去了')
        .toBeLessThanOrEqual(host.w * COOL.RIM / 2);
    }
  });

  it('should saw-tooth the turbine hall roof', () => {
    // Flat, the hall is indistinguishable from a warehouse.
    expect(tagged(powerPlan, 'hallRoof')[0]!.shape).toBe('sawtooth');
  });

  it('should stand transformers in the switchyard', () => {
    expect(powerPlan.props.filter(v => v.tag === 'transformer').length)
      .toBeGreaterThanOrEqual(4);
  });
});

describe('水廠', () => {
  const walls = tagged(waterPlan, 'tankWall');

  it('should lay out round settling tanks, not a row of them', () => {
    // Round tanks are the water plant's recognition signal. In a single row they read as one
    // thing copied several times; 2x2 is a layout.
    expect(walls.length, '沉澱池不到三座').toBeGreaterThanOrEqual(3);
    for (const w of walls) expect(w.shape, '沉澱池不是開口的圓槽').toBe('tub');
    const xs = new Set(walls.map(w => w.x.toFixed(6)));
    const zs = new Set(walls.map(w => w.z.toFixed(6)));
    expect(Math.min(xs.size, zs.size), '幾座池排成一列').toBeGreaterThan(1);
  });

  it('should give every tank its own water', () => {
    for (const w of walls) {
      const water = tagged(waterPlan, 'tankWater')
        .find(v => v.x === w.x && v.z === w.z);
      expect(water, '這座池沒有水').toBeTruthy();
    }
  });

  /**
   * There is **no water** on this cell.
   *
   * A water plant is built on land and does not draw a river into its plot.
   *
   * It is the same mistake as a train station drawing fake rails: the real water is drawn by the
   * **terrain** (`TERRAIN_COLORS[WATER]`), and a second version here is two descriptions of the
   * same thing that never line up, because where terrain water lies is decided by the map.
   */
  it('should not paint a river of its own', () => {
    for (const d of waterPlan.decals) {
      expect(d.water, `${d.tag ?? '一塊貼片'} 在廠區裡畫了水`).toBeFalsy();
    }
    for (const v of waterPlan.massing) {
      expect(v.tag, '廠區裡還留著取水口').not.toMatch(/intake|screen|quay/);
    }
  });

  it('should take its colour from the river', () => {
    const hueOf = (r: number, g: number, b: number) => {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      if (d < 1e-6) return -1;
      const h = max === r ? ((g - b) / d) % 6
        : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return ((h * 60) + 360) % 360;
    };
    const river = TERRAIN_COLORS[TerrainType.WATER]!;
    const want = hueOf(
      ((river >> 16) & 0xff) / 255, ((river >> 8) & 0xff) / 255, (river & 0xff) / 255);
    const got = hueOf(...waterPlan.color as [number, number, number]);
    const diff = Math.abs(((got - want + 540) % 360) - 180);
    expect(diff, `抽水廠是 ${got.toFixed(0)}°，河是 ${want.toFixed(0)}°`)
      .toBeLessThan(20);
  });

  /**
   * White tank walls. This cell's recognition signal is **four large water tanks**.
   *
   * The data can be right and the white still not appear: a wall is compressed by
   * `FACADE_UTILITY` to 0.70-0.90 and given a high window band, while `PART_GROUND`'s ramp tops
   * out at brick, `vec3(0.60, 0.58, 0.55)`, so even `shade: 0.95` is mid grey. So this case
   * checks **the branch that can draw it**: `PART_SHELL` is the only one that follows a mass's
   * own colour.
   *
   * There is no separate water tower. The white sits on the four basins' walls, and that is all
   * "large water tank" amounts to: a white body, blue water, and a level below the rim.
   */
  it('should paint the tanks white and keep the tower gone', () => {
    expect(tagged(waterPlan, 'tower').length, '高塔還在').toBe(0);
    expect(tagged(waterPlan, 'towerCap').length, '塔頂還在').toBe(0);
    expect(walls.length, '沒有水桶').toBeGreaterThan(0);
    for (const v of walls) {
      expect(v.part, '池壁沒有走塗裝外殼 —— 那條路畫不出白色').toBe(PART_SHELL);
      expect(v.part, '池壁走回共用屋頂色票 —— 那組有鏽紅').not.toBe(PART_ROOF);
      expect(v.color, '池壁沒有自己的顏色 —— 它會跟著廠區').toBeDefined();
      expect(Math.min(...v.color!), '池壁不夠白').toBeGreaterThan(0.85);
    }
  });

  it('should stay a low plant now that the tower is gone', () => {
    // With no tower, the highest point is the plant room's ridge. The upper bound pins it;
    // without this case, adding a tower back turns nothing red, and the four-are-distinct case
    // stays green too.
    expect(m(topOf(waterPlan.massing)), '水廠又長出一座塔')
      .toBeLessThanOrEqual(9);
  });
});

describe('垃圾場', () => {
  const mounds = tagged(garbagePlan, 'mound');

  it('should pile two mounds of different sizes', () => {
    // The mounds are this building's silhouette. Two of equal size read as two identical
    // blocks.
    expect(mounds.length, '土丘不是兩座').toBe(2);
    expect(mounds[0]!.y1).not.toBeCloseTo(mounds[1]!.y1, 3);
    for (const v of mounds) {
      expect(v.shape, '土丘是平頂的 —— 那是倉庫不是土堆').toBe('hip');
      expect(v.part, '土丘會長出高窗帶').toBe(PART_GROUND);
    }
  });

  it('should park the garbage trucks it exists for', () => {
    expect(garbagePlan.vehicles.filter(v => v.kind === 'garbageTruck').length,
      '垃圾場沒有垃圾車').toBeGreaterThanOrEqual(2);
  });

  it('should weigh the trucks on the way in', () => {
    // The weighbridge is a landfill's real entrance ritual. Without it the gate is just a gap.
    const bridge = garbagePlan.props.find(v => v.tag === 'weighbridge')!;
    const hut = tagged(garbagePlan, 'weighHut')[0]!;
    expect(bridge, '沒有地磅').toBeTruthy();
    expect(hut, '沒有地磅房').toBeTruthy();
    expect(m(bridge.y1 - bridge.y0), '秤台太厚 —— 車開不上去').toBeLessThan(0.4);
    // The weigh hut belongs beside the platform, not at the other end of the site.
    expect(Math.abs(hut.x - bridge.x) + Math.abs(hut.z - bridge.z))
      .toBeLessThan(0.5);
  });
});

describe('汙水廠', () => {
  const walls = tagged(sewagePlan, 'basinWall');

  it('should line up rectangular aeration basins', () => {
    // The water plant is a row of round vessels and this a row of rectangular ones; that
    // contrast is the difference between them.
    expect(walls.length, '曝氣池不到四座').toBeGreaterThanOrEqual(4);
    for (const w of walls) {
      expect(w.shape, '曝氣池是圓的 —— 那是水廠').toBe('basin');
      expect(w.z, '曝氣池沒有排成一列').toBeCloseTo(walls[0]!.z, 9);
    }
    const xs = [...walls].map(w => w.x).sort((a, b) => a - b);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    for (const g of gaps) {
      expect(m(g), `池距不齊：${m(g).toFixed(2)} m`).toBeCloseTo(m(gaps[0]!), 6);
    }
  });

  /**
   * Sewage is **earth-coloured** and drinking water is blue.
   *
   * "Darker than drinking water" is not enough: with the water ramp running only from deep to
   * pale blue, darker is still blue, and the case stays green without producing an earth colour.
   * With a sludge segment on the ramp, this asks **which segment** each falls in: the two plants
   * have to land on opposite sides of the turning point, which is what "can you tell them apart
   * side by side" amounts to.
   */
  it('should make the sewage muddy and the drinking water blue', () => {
    const dirty = tagged(sewagePlan, 'basinWater')[0]!;
    const clean = tagged(waterPlan, 'tankWater')[0]!;
    expect(dirty.shade!, '汙水不在泥漿那一段 —— 它會是藍的')
      .toBeLessThan(WATER_MURK_MAX);
    expect(clean.shade!, '自來水掉進泥漿那一段 —— 它會是土色的')
      .toBeGreaterThan(WATER_MURK_MAX);
  });

  it('should bridge the basins with a walkway on posts', () => {
    // Without the walkway, a sewage plant's silhouette is a few puddles.
    const deck = sewagePlan.props.find(v => v.tag === 'walkway')!;
    const posts = sewagePlan.props.filter(v => v.tag === 'walkwayPost');
    expect(deck, '沒有走道橋').toBeTruthy();
    expect(posts.length, '走道橋沒有柱子').toBeGreaterThanOrEqual(walls.length);
    for (const p of posts) expect(p.y1, '柱子沒有頂到橋面').toBeCloseTo(deck.y0, 6);
  });

  it('should add one round clarifier among the square ones', () => {
    const c = tagged(sewagePlan, 'clarifierWall')[0]!;
    expect(c, '沒有沉澱池').toBeTruthy();
    expect(c.shape).toBe('tub');
  });
});

/**
 * The four have to be distinguishable side by side.
 *
 * They share a facade and a palette family, so **silhouette** is the only difference, and
 * silhouette is measurable as a highest point: at equal heights the player can only tell them
 * apart by colour, and those four colours are close together already.
 */
describe('四座並排', () => {
  it('should give each utility a different height', () => {
    const tops = PLANS.map(([label, p]) => [label, Math.round(m(topOf(p.massing)))] as const);
    const seen = new Set(tops.map(([, h]) => h));
    expect(seen.size, `四座的最高點有重複：${JSON.stringify(tops)}`).toBe(4);
  });
});
