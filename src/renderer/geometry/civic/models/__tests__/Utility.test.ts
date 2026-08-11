import { describe, it, expect } from 'vitest';
import { powerPlan } from '../power';
import { waterPlan } from '../water';
import { garbagePlan } from '../garbage';
import { sewagePlan } from '../sewage';
import { FACADE_UTILITY, PART_GROUND, PART_LAMP, PART_ROOF } from '../../../buildings/parts';
import { TERRAIN_COLORS } from '../../../../terrainColors';
import { TerrainType } from '../../../../../core/grid/types';
import { topOf } from '../../../buildings/massing/volume';
import { civicColorOf } from '../../colors';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';
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
 * 四座公用設施。共通的驗收在 `CivicPlans.test.ts` 的資料表裡。
 *
 * 它們共用 `FACADE_UTILITY`（鍍鋅浪板色票 + 高窗帶），所以讀起來是同一家族
 * —— 那是刻意的，它們本來就是同一類東西。彼此的差別在**剪影**：
 * 煙囪／圓槽／土丘／方池。
 */
describe.each(PLANS)('%s', (_label, plan, type) => {
  it('should use the utility facade and its own colour', () => {
    expect(plan.facade).toBe(FACADE_UTILITY);
    expect(plan.color).toEqual(civicColorOf(type));
    expect(plan.footprint).toEqual({ w: 2, h: 2 });
  });

  it('should fence the site', () => {
    // 沒有圍籬的廠區看起來是一堆散落在草地上的設備。三面就夠 ——
    // 第四面是大門。
    expect(plan.fixtures.filter(f => f.kind === 'fence').length, '廠區沒有圍籬')
      .toBeGreaterThanOrEqual(3);
  });

  it('should read as industrial, not as a garden', () => {
    // 工業雜項（管架、油桶、氣瓶、棧板）是「這裡有製程」的訊號。
    const industrial = plan.fixtures.filter(f =>
      f.kind === 'pipeRack' || f.kind === 'drum'
      || f.kind === 'gasBottles' || f.kind === 'palletStack').length;
    expect(industrial, '廠區沒有任何工業雜項').toBeGreaterThanOrEqual(3);
  });

  it('should light the yard with tall masts', () => {
    // 廠區的地幾乎全是鋪面。沒有高桿燈的話夜裡整片是一塊黑。
    const masts = plan.fixtures.filter(f => f.kind === 'lamp' && f.heightM >= 5);
    expect(masts.length, '廠區的高桿燈太少').toBeGreaterThanOrEqual(3);
  });

  it('should screen itself from the street', () => {
    // 廠區對外總得有一點遮蔽 —— 而且那是「有人在管理它」的訊號。
    expect(plan.fixtures.some(f => f.kind === 'hedge'), '沒有對外的綠帶').toBe(true);
    expect(plan.fixtures.filter(f => f.kind === 'tree').length, '一棵樹都沒有')
      .toBeGreaterThanOrEqual(2);
  });

  it('should pave the yard rather than grass it', () => {
    // 草地上的電廠不成立。
    const base = plan.decals.filter(d => (d.layer ?? 'base') === 'base');
    expect(base.every(d => !d.lawn), '廠區鋪了草地').toBe(true);
  });

  it('should keep every water surface and earth mound out of the wall branch', () => {
    // 水面與覆土標成牆的話，`FACADE_UTILITY` 會在它們身上畫一條高窗帶。
    for (const v of plan.massing) {
      const isSurface = /Water|mound/.test(v.tag ?? '');
      if (isSurface) expect(v.part, `${v.tag} 會長出高窗帶`).toBe(PART_GROUND);
    }
  });

  it('should give every shaded surface an actual shade', () => {
    // `PART_GROUND` 而沒有 `shade` 的話 B 通道是 0 —— 那是柏油黑，
    // 而不是「我想要的那個顏色」。這個錯完全不會報。
    for (const v of plan.massing.filter(v => v.part === PART_GROUND)) {
      expect(v.shade, `${v.tag} 是 PART_GROUND 卻沒有明度`).toBeGreaterThan(0);
    }
  });

  it('should light something without relying on office windows', () => {
    const lamps = [...plan.massing, ...plan.props].filter(v => v.part === PART_LAMP);
    expect(lamps.length, '廠區沒有自己的燈').toBeGreaterThan(0);
  });
});

describe('電廠', () => {
  const stacks = tagged(powerPlan, 'stack');
  const towers = tagged(powerPlan, 'coolingTower');

  /**
   * 冷卻塔是這一棟的辨識訊號。
   *
   * 使用者：「發電廠的形象也要改一下 現在看不出是電廠」。原本的剪影是兩支
   * 圓柱煙囪加一棟廠房，而旁邊的水廠是一支圓柱水塔加一棟機房 —— 兩者又
   * 共用同一組立面色票。城市裡沒有第二種建築是**有腰的旋轉體**，所以那個
   * 形狀本身就是「這是電廠」。
   */
  it('should stand two cooling towers of different sizes', () => {
    expect(towers.length, '冷卻塔不是兩座').toBe(2);
    for (const t of towers) {
      expect(t.shape, '冷卻塔不是有腰的 —— 那是一個筒倉').toBe('cooling');
      expect(m(t.y1), '冷卻塔太矮').toBeGreaterThan(12);
      expect(t.w, '冷卻塔不是正圓').toBeCloseTo(t.d, 9);
      // 又高又細的話那是煙囪。真實冷卻塔的高徑比在 1.5～2 之間。
      expect((t.y1 - t.y0) / t.w, '冷卻塔太瘦').toBeLessThan(2.2);
    }
    expect(towers[0]!.w).not.toBeCloseTo(towers[1]!.w, 3);
  });

  it('should still raise a chimney above everything', () => {
    // 冷卻塔冒的是水氣。燒的那一支還是要有，而且它是全場最高的東西。
    expect(stacks.length, '沒有煙囪').toBe(1);
    for (const s of stacks) {
      expect(s.shape, '煙囪不是圓的').toBe('cylinder');
      expect(m(s.y1), '煙囪太矮').toBeGreaterThan(18);
      expect(s.y1, '煙囪沒有高過冷卻塔')
        .toBeGreaterThan(Math.max(...towers.map(t => t.y1)));
    }
  });

  it('should be the tallest of the four utilities', () => {
    // 遠景只剩它的煙囪。被水塔蓋過去就白做了。
    const top = m(topOf(powerPlan.massing));
    for (const [, other] of PLANS.filter(([, p]) => p !== powerPlan)) {
      expect(top, '電廠不是最高的').toBeGreaterThan(m(topOf(other.massing)));
    }
  });

  it('should put a warning light on top of each chimney', () => {
    // 夜裡的電廠就是天上那顆紅點。
    const beacons = tagged(powerPlan, 'beacon');
    expect(beacons.length, '航警燈不足').toBe(stacks.length);
    for (const b of beacons) {
      expect(b.part).toBe(PART_LAMP);
      const host = stacks.find(s => Math.abs(s.z - b.z) < 1e-9)!;
      expect(b.y0, '航警燈沒有站在煙囪頂上').toBeCloseTo(host.y1, 9);
    }
  });

  it('should saw-tooth the turbine hall roof', () => {
    // 平頂的話廠房與倉庫分不出來。
    expect(tagged(powerPlan, 'hallRoof')[0]!.shape).toBe('sawtooth');
  });

  it('should stand transformers in the switchyard', () => {
    expect(powerPlan.props.filter(v => v.tag === 'transformer').length)
      .toBeGreaterThanOrEqual(3);
  });
});

describe('水廠', () => {
  const walls = tagged(waterPlan, 'tankWall');

  it('should lay out round settling tanks, not a row of them', () => {
    // 圓的是水廠的辨識訊號。排成一列的話三座讀起來是同一個東西複製三次 ——
    // 品字形才有配置。
    expect(walls.length, '沉澱池不到三座').toBeGreaterThanOrEqual(3);
    for (const w of walls) expect(w.shape, '沉澱池不是圓的').toBe('cylinder');
    const xs = new Set(walls.map(w => w.x.toFixed(6)));
    const zs = new Set(walls.map(w => w.z.toFixed(6)));
    expect(Math.min(xs.size, zs.size), '三座池排成一列').toBeGreaterThan(1);
  });

  it('should inset the water inside the tank wall', () => {
    // 水面與池壁齊寬的話看不出有一圈邊，那就只是一個圓餅。
    for (const w of walls) {
      const water = tagged(waterPlan, 'tankWater')
        .find(v => v.x === w.x && v.z === w.z)!;
      expect(water, '這座池沒有水').toBeTruthy();
      expect(water.w, '水面沒有比池壁窄').toBeLessThan(w.w);
      expect(water.y0, '水面沒有浮在池壁頂').toBeCloseTo(w.y1, 9);
    }
  });

  /**
   * 抽水廠蓋在水岸邊。
   *
   * 使用者：「抽水廠的形象想要改一下，抽水場一定是蓋在水岸邊」。這一條問的
   * 是三件事，缺一件就不成立：
   *
   * 1. 基地上真的有一片**水**（一條明顯比廠區暗的貼片，貼著佔地的一邊）；
   * 2. 岸邊有**護岸**（少了它，水面與鋪面只是兩塊換色的地板）；
   * 3. 取水口**跨在岸線上** —— 整棟站在陸上的話那只是又一間廠房，
   *    而「從水裡取水」正是這一棟存在的理由。
   */
  it('should stand on a water edge', () => {
    const bases = waterPlan.decals.filter(d => (d.layer ?? 'base') === 'base');
    const river = bases.find(d => d.tag === 'river')!;
    const yard = bases.find(d => d.tag === 'yard')!;
    expect(river, '基地上沒有水').toBeTruthy();
    expect(river.shade, '水面不夠暗 —— 那讀起來是一塊鋪面').toBeLessThan(0.1);
    expect(yard.shade - river.shade, '水面與鋪面分不出來').toBeGreaterThan(0.3);
    expect(m(river.w), '水面沒有橫跨整個基地').toBeGreaterThan(20);
    expect(Math.abs(river.z) + river.d / 2, '水面沒有貼著佔地的邊')
      .toBeCloseTo(waterPlan.footprint.h / 2, 6);

    const bank = river.z + river.d / 2;   // 岸線（水在它的 −z 側）
    expect(tagged(waterPlan, 'quay').length, '岸邊沒有護岸').toBeGreaterThan(0);
    for (const q of tagged(waterPlan, 'quay')) {
      expect(Math.abs(q.z - bank), '護岸沒有沿著岸線').toBeLessThan(0.1);
    }

    const intake = tagged(waterPlan, 'intake')[0]!;
    expect(intake, '沒有取水口').toBeTruthy();
    expect(intake.z - intake.d / 2, '取水口沒有伸進水裡').toBeLessThan(bank);
    expect(intake.z + intake.d / 2, '取水口整棟泡在水裡')
      .toBeGreaterThan(river.z - river.d / 2);
  });

  /**
   * 廠區的顏色取自**河**。
   *
   * 使用者：「抽水站的主顏色參考河流的顏色」。比的是**色相與地形水面一致**，
   * 不是一個寫死的十六進位值 —— 哪天地形的水改色，這條會要求抽水廠跟著改，
   * 而那正是「參考河流的顏色」的意思。
   */
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

  it('should keep the water tower white', () => {
    // 使用者：「水塔應該是白色系，看起來比較乾淨」。塔身要有自己的顏色
    // 覆寫（否則它跟著廠區的藍），塔頂不能走共用的屋頂色票（那組有鏽紅）。
    const tower = tagged(waterPlan, 'tower')[0]!;
    expect(tower.color, '塔身沒有自己的顏色 —— 它會跟著廠區').toBeDefined();
    expect(Math.min(...tower.color!), '塔身不夠白').toBeGreaterThan(0.85);
    const cap = tagged(waterPlan, 'towerCap')[0]!;
    expect(cap.part, '塔頂走回共用屋頂色票 —— 那組有鏽紅').not.toBe(PART_ROOF);
    expect(cap.shade!, '塔頂不夠白').toBeGreaterThan(0.85);
  });

  it('should raise one storage tower above the tanks', () => {
    const tower = tagged(waterPlan, 'tower')[0]!;
    expect(tower, '沒有儲水塔').toBeTruthy();
    for (const w of walls) expect(tower.y1).toBeGreaterThan(w.y1 * 2);
  });
});

describe('垃圾場', () => {
  const mounds = tagged(garbagePlan, 'mound');

  it('should pile two mounds of different sizes', () => {
    // 土丘是這一棟的剪影。等大的兩座讀起來是兩個一樣的方塊。
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
    // 地磅是垃圾場真正的入口儀式。少了它，那道大門只是一個缺口。
    const bridge = garbagePlan.props.find(v => v.tag === 'weighbridge')!;
    const hut = tagged(garbagePlan, 'weighHut')[0]!;
    expect(bridge, '沒有地磅').toBeTruthy();
    expect(hut, '沒有地磅房').toBeTruthy();
    expect(m(bridge.y1 - bridge.y0), '秤台太厚 —— 車開不上去').toBeLessThan(0.4);
    // 磅房要在秤台旁邊，不是在場區的另一頭。
    expect(Math.abs(hut.x - bridge.x) + Math.abs(hut.z - bridge.z))
      .toBeLessThan(0.5);
  });
});

describe('汙水廠', () => {
  const walls = tagged(sewagePlan, 'basinWall');

  it('should line up rectangular aeration basins', () => {
    // 水廠是一排圓的、這裡是一排方的 —— 那個對比就是兩者的差別。
    expect(walls.length, '曝氣池不到四座').toBeGreaterThanOrEqual(4);
    for (const w of walls) {
      expect(w.shape ?? 'box', '曝氣池是圓的 —— 那是水廠').toBe('box');
      expect(w.z, '曝氣池沒有排成一列').toBeCloseTo(walls[0]!.z, 9);
    }
    const xs = [...walls].map(w => w.x).sort((a, b) => a - b);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    for (const g of gaps) {
      expect(m(g), `池距不齊：${m(g).toFixed(2)} m`).toBeCloseTo(m(gaps[0]!), 6);
    }
  });

  it('should keep the sewage darker than the drinking water', () => {
    // 兩廠並排時，池水的明暗是它們唯一不共用的東西。
    const dirty = tagged(sewagePlan, 'basinWater')[0]!;
    const clean = tagged(waterPlan, 'tankWater')[0]!;
    expect(dirty.shade!, '汙水比自來水還乾淨').toBeLessThan(clean.shade!);
  });

  it('should bridge the basins with a walkway on posts', () => {
    // 少了走道橋，汙水廠的剪影就只是幾個水坑。
    const deck = sewagePlan.props.find(v => v.tag === 'walkway')!;
    const posts = sewagePlan.props.filter(v => v.tag === 'walkwayPost');
    expect(deck, '沒有走道橋').toBeTruthy();
    expect(posts.length, '走道橋沒有柱子').toBeGreaterThanOrEqual(walls.length);
    for (const p of posts) expect(p.y1, '柱子沒有頂到橋面').toBeCloseTo(deck.y0, 6);
  });

  it('should add one round clarifier among the square ones', () => {
    const c = tagged(sewagePlan, 'clarifierWall')[0]!;
    expect(c, '沒有沉澱池').toBeTruthy();
    expect(c.shape).toBe('cylinder');
  });
});

/**
 * 四座並排時要分得出來。
 *
 * 它們共用立面與色票家族，所以**剪影**是唯一的差別 —— 而剪影可以用最高點
 * 量出來：四座一樣高的話玩家只能靠顏色分辨，而那四個顏色本來就很接近。
 */
describe('四座並排', () => {
  it('should give each utility a different height', () => {
    const tops = PLANS.map(([label, p]) => [label, Math.round(m(topOf(p.massing)))] as const);
    const seen = new Set(tops.map(([, h]) => h));
    expect(seen.size, `四座的最高點有重複：${JSON.stringify(tops)}`).toBe(4);
  });
});
