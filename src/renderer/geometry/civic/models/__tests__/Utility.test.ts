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

  /**
   * 水面走水的分支，覆土走地面的分支。
   *
   * 兩者標成牆的話 `FACADE_UTILITY` 會在它們身上畫一條高窗帶 —— 那是第一版
   * 這條測試在守的東西，而它把兩者一起塞進 `PART_GROUND`。
   *
   * 截圖之後才看得出那還不夠：地面的色譜是柏油到磚鋪，**全是灰的**，
   * 所以 `shade: 0.1` 的池水是四個黑洞。`PART_WATER` 就是為這件事加的
   * （BUG-243），只是當時只用在渡輪碼頭的港池上，而那片水後來拿掉了。
   *
   * 一槽水**不是**「自己畫一條河」（BUG-244）：河是地形的，而槽裡的水是
   * 這座廠自己的東西 —— 它就是這一棟在做的事。
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
   * 煙囪與塔身也不准長窗戶，而且要**畫成清水混凝土**。
   *
   * 煙囪不該有窗戶。這是同一個錯的第三種形狀：不標 `part` 就是牆，而
   * `FACADE_UTILITY` 的牆會在上面畫一條高窗帶 —— 覆土、水面、煙囪、
   * 冷卻塔全都中過。
   *
   * 第一版改成了 `PART_DETAIL`，窗戶是沒了，但那條分支寫死一片偏藍的金屬灰
   * （`vec3(m, m*1.02, m*1.06)`，m ≈ 0.42–0.58），`vBldgColor` 連讀都沒讀。
   * 於是冷卻塔 —— 這一棟唯一的辨識剪影 —— 是深灰的，而它應該是混凝土。
   * `PART_SHELL` 才是照著量體自己的顏色畫的那一條。
   */
  it('should not put windows on a chimney or a tower shell', () => {
    for (const v of plan.massing) {
      if (!/stack|tankWall/.test(v.tag ?? '')) continue;
      expect(v.part, `${v.tag} 會長出高窗帶`).toBe(PART_SHELL);
      expect(v.color, `${v.tag} 沒有自己的顏色 —— 它會跟著廠區`).toBeDefined();
    }
  });

  it('should give every shaded surface an actual shade', () => {
    // 沒有 `shade` 的話 B 通道是 0 —— 地面那是柏油黑、水面那是最深的深水，
    // 而不是「我想要的那個顏色」。這個錯完全不會報。
    const shaded = plan.massing.filter(v =>
      v.part === PART_GROUND || v.part === PART_WATER);
    for (const v of shaded) {
      expect(v.shade, `${v.tag} 吃 B 通道卻沒有明度`).toBeGreaterThan(0);
    }
  });

  /**
   * 水面要**低於槽緣**。
   *
   * 前一版的水面貼在池壁的頂上（`y0 === wall.y1`），所以每一座池讀起來是
   * 一個蓋著藍色蓋子的圓筒，而不是一個裝著水的槽。差別在那一圈**內壁**：
   * 有它才看得出深度。
   *
   * 光把 y 調低沒有用 —— 池壁是實心的圓柱／方塊，水面壓到頂面之下就整個
   * 埋進量體裡了。所以池壁同時改成開口容器（`tub` / `basin`），而這條測試
   * 守的是兩者要**一起**成立：水面在槽底之上、槽緣之下。
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
      // 水面要比內壁寬一點，側面才埋進池壁裡 —— 窄了就是四周留一圈看得穿
      // 到地面的縫。
      expect(w.w, `${w.tag} 與池壁之間有一條縫`)
        .toBeGreaterThan(vessel!.w * TUB.INNER);
      expect(w.w, `${w.tag} 漫出池壁外`).toBeLessThan(vessel!.w);
    }
  });

  it('should keep the ripple inside the pool', () => {
    // 水位起伏的振幅比水層本身還厚的話，水面會在池底之下與池壁之上來回
    // 穿刺 —— 那看起來是水在漏。
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
   * 這一棟的剪影是**一座粗的、有腰的塔**。
   *
   * 這個形狀換過三輪。兩支圓柱煙囪與旁邊的水廠幾乎同一個剪影（一根柱子加
   * 一棟房子），而柱子到處都是；兩座冷卻塔的直徑接近 10 m，在 24 m 的地上
   * 佔掉整個北半，等角視角下是兩坨蓋住廠房的圓桶。
   *
   * 一座才成立：城市裡沒有第二種建築是**有腰的旋轉體**，所以那個形狀本身
   * 就是「這是電廠」，而只放一座就留得下整個開關場。
   */
  it('should raise a single thick waisted stack', () => {
    expect(stacks.length, '煙囪不是一座').toBe(1);
    const s = stacks[0]!;
    expect(s.shape, '煙囪不是有腰的 —— 那是一根柱子').toBe('cooling');
    expect(s.w, '煙囪不是正圓').toBeCloseTo(s.d, 9);
    expect(m(s.w), '煙囪不夠粗').toBeGreaterThanOrEqual(10);
    // 又高又細的話那又變回一根柱子。真實冷卻塔的高徑比在 1.5～2 之間。
    expect((s.y1 - s.y0) / s.w, '煙囪太瘦').toBeLessThan(2.2);
    // 上下界一起釘住高度 —— 只留下限的話調回去不會有任何東西轉紅。
    expect(m(s.y1), '煙囪太矮').toBeGreaterThan(15);
    expect(m(s.y1), '煙囪又長回去了').toBeLessThanOrEqual(22);
  });

  /**
   * 塔口要**凹得夠深**，而且裡面是深色的。
   *
   * 深度由幾何顧（見 `MassingGeometry.test.ts` 的 `COOL.DEPTH`），這裡顧的是
   * **顏色**：塔口內壁跟著塔身走混凝土色的話，那個口再深也是亮的 ——
   * 內壁的法線是水平的，拿到的光與塔身外側幾乎一樣，而這個引擎沒有環境光
   * 遮蔽。所以口裡要有一支深色的內襯，從凹槽的底一路到塔口。
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
    // 它自己也要是開口的：實心圓柱的頂是一片圓盤，口就只剩那麼深。
    expect(lining!.shape, '內襯是實心的 —— 塔口下面會蓋著一塊板子').toBe('tub');
    // 塞在塔口裡：比塔口窄，從凹槽的底一路頂到塔口。
    expect(lining!.w, '內襯比塔口還寬 —— 它會從塔身穿出來')
      .toBeLessThan(s.w * COOL.THROAT);
    const bottom = s.y0 + (1 - COOL.DEPTH) * (s.y1 - s.y0);
    expect(m(Math.abs(lining!.y0 - bottom)), '內襯不是從凹槽的底部開始')
      .toBeLessThan(0.6);
    expect(m(Math.abs(lining!.y1 - s.y1)), '內襯沒有頂到塔口')
      .toBeLessThan(0.6);
  });

  /**
   * 開關場：一排電桿，用**黑色的導線**接起來。
   *
   * 「電從這裡出去」是電廠一半的內容，而前一版只有三台變壓器加兩座門型
   * 構架 —— 那是地上的幾個方塊，沒有任何東西在說它們彼此相連。
   *
   * 導線是這一段唯一真正在講話的東西：它把散落的設備串成一條線路，而且
   * 那條線在等角視角下是**唯一**橫跨整個廠區的元素。
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
      // 又細又長，而且是水平的。粗的話那是一根樑。
      const thin = Math.min(m(w.w), m(w.d));
      const long = Math.max(m(w.w), m(w.d));
      expect(thin, `導線粗達 ${thin.toFixed(2)} m`).toBeLessThanOrEqual(0.15);
      expect(long, '導線太短 —— 那是一截接頭').toBeGreaterThan(3);
      expect(m(w.y1 - w.y0), '導線是垂下來的 —— 那是礙子串').toBeLessThanOrEqual(0.15);
      expect(m(w.y0), '導線掛得太低 —— 人走得到').toBeGreaterThan(4);
    }
  });

  /**
   * 導線的兩端要真的**落在桿上**。
   *
   * 浮在空中的線段在其他每一條驗收裡都合法：夠細、夠長、夠黑、夠高。
   * 而畫面上它是一根憑空開始、憑空結束的黑棒子。
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
      // 認最近的那一支。兩支煙囪同排的話，只比 z 會把兩顆燈都算到第一支頭上
      // —— 而那條測試會是綠的。
      const host = [...stacks].sort((p, q) =>
        Math.hypot(p.x - b.x, p.z - b.z) - Math.hypot(q.x - b.x, q.z - b.z))[0]!;
      expect(b.y0, '航警燈沒有站在煙囪頂上').toBeCloseTo(host.y1, 9);
      // 站在塔口的**環**上：內緣是塔口（掉進去），外緣是塔頂的外圈
      // （掛到塔外面去）。塔頂比宣告的寬度窄，所以外界要用 `COOL.RIM`
      // 而不是 `host.w / 2` —— 後者是底座的半徑，那一圈是空的。
      expect(Math.abs(b.x - host.x) - b.w / 2, '航警燈架在塔口上')
        .toBeGreaterThanOrEqual(host.w * COOL.THROAT / 2);
      expect(Math.abs(b.x - host.x) + b.w / 2, '航警燈掛到塔外面去了')
        .toBeLessThanOrEqual(host.w * COOL.RIM / 2);
    }
  });

  it('should saw-tooth the turbine hall roof', () => {
    // 平頂的話廠房與倉庫分不出來。
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
    // 圓的是水廠的辨識訊號。排成一列的話讀起來是同一個東西複製幾次 ——
    // 2×2 才有配置。
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
   * 這一格裡**沒有水**。
   *
   * 中間試過一版把河畫進基地（北端一條水面貼片加護岸、取水口、攔汙柵），
   * 抽水廠蓋在陸地上，不必在基地裡畫河。
   *
   * 而這與火車站畫假鐵軌是同一個錯：真的水是**地形**畫的
   * （`TERRAIN_COLORS[WATER]`），這一格自己畫一條，就是兩份各說各話的水
   * —— 而且它們永遠不會對齊，因為地形的水在哪裡由地圖決定。
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
   * 白色的池壁。這一格的辨識訊號是**四個大水桶**。
   *
   * 白色一直畫不出來，而且**資料一直是對的**：前兩版的儲水塔都帶著接近白的
   * 陣列，測試驗的也正是那個陣列。畫不出來的是 shader —— 牆被
   * `FACADE_UTILITY` 壓成 0.70～0.90 倍再加一條高窗帶；`PART_GROUND` 的色譜
   * 上限只到 `vec3(0.60, 0.58, 0.55)` 的磚鋪，`shade: 0.95` 也只是中灰。
   * 所以這一條驗的是**畫得出來的那條路**：`PART_SHELL` 是唯一照著量體自己的
   * 顏色畫的分支。
   *
   * 儲水塔本身已經拿掉了 —— 白色移到四座池的池壁上，而那正是「大水桶」的
   * 全部：白的桶身、藍的水、低於桶緣的水位。
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
    // 高塔拿掉之後最高的是機房的屋脊。上界釘住它 —— 少了這一條，把塔加回去
    // 不會有任何東西轉紅（四座各不相同那條也照樣是綠的）。
    expect(m(topOf(waterPlan.massing)), '水廠又長出一座塔')
      .toBeLessThanOrEqual(9);
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
   * 汙水是**土色**的，自來水是藍的。
   *
   * 前一版只要求「比自來水暗」，而水的色譜當時只有深藍到淺藍兩端 —— 再暗
   * 也只是很深的藍，那條測試因此永遠是綠的卻換不到土色。色譜補了泥漿那一段
   * 之後，這條改成問**落在哪一段**：兩座廠必須分別在轉折點的兩側，而那正是
   * 「兩廠並排時分不分得出來」的實體。
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
    expect(c.shape).toBe('tub');
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
