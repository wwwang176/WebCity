import { describe, it, expect } from 'vitest';
import { assembleCivic, assembleDecals } from '../assemble';
import { CIVIC_INSET, type CivicDecal, type CivicVolume, type Footprint } from '../types';
import {
  PART_WALL, PART_GROUND, PART_FOLIAGE, PART_ROOF, triangleCount,
} from '../../buildings/parts';

const FOOT: Footprint = { w: 2, h: 2 };
/** 顏色不是這個檔案在測的東西 —— 顏色的驗收在 `CivicColors.test.ts`。 */
const GREY = [0.7, 0.7, 0.7] as const;

const box = (o: Partial<CivicVolume> = {}): CivicVolume =>
  ({ x: 0, z: 0, w: 1, d: 1, y0: 0, y1: 0.5, ...o });

const decal = (o: Partial<CivicDecal> = {}): CivicDecal =>
  ({ x: 0, z: 0, w: 1, d: 1, shade: 0.5, ...o });

/**
 * 公共建築的量體護欄與分區建築的不一樣。
 *
 * 分區版 `assemble()` 擋的是**行人包絡線** —— 那是格內的概念，門節點放在
 * 它外側，越過就是行人穿牆（BUG-221）。公共建築佔好幾格，包絡線不適用；
 * 它要擋的是佔地邊界，越過的後果是壓到鄰格的建築或馬路。
 */
describe('assembleCivic 的護欄', () => {
  it('should accept volumes inside the footprint', () => {
    expect(() => assembleCivic([box({ w: 1.9, d: 1.9 })], FOOT, GREY)).not.toThrow();
  });

  it('should throw when a volume leaves the footprint', () => {
    // 靜靜地壓到隔壁比當場炸掉難追一百倍 —— 與 `assemble()` 同一個理由。
    expect(() => assembleCivic([box({ w: 2.4, d: 1 })], FOOT, GREY)).toThrow(/超出佔地/);
  });

  it('should throw on an off-centre volume that pokes out one side', () => {
    // 包圍盒**寬度**看不出單邊外凸：這個量體只有 1 格寬，佔地有 2 格，
    // 但它的中心偏了 0.8，所以右緣在 1.3 —— 已經在隔壁格裡了。
    // 這正是 BUG-222 的形狀，所以量的是離中心的最大距離而不是寬度。
    expect(() => assembleCivic([box({ x: 0.8, w: 1, d: 1 })], FOOT, GREY)).toThrow(/超出佔地/);
  });

  it('should measure the footprint per axis, not as a square', () => {
    // 2x3 的醫院在 z 方向有 3 格可用、x 方向只有 2 格。取單一個半徑的話，
    // 不是浪費掉長邊，就是讓短邊溢出。
    const tall: Footprint = { w: 2, h: 3 };
    expect(() => assembleCivic([box({ w: 1.9, d: 2.9 })], tall, GREY)).not.toThrow();
    expect(() => assembleCivic([box({ w: 2.9, d: 1.9 })], tall, GREY)).toThrow(/超出佔地/);
  });

  it('should reserve the inset', () => {
    // 剛好貼齊佔地邊界會與鄰格的東西共面 —— z-fighting 在靜態截圖上看不出來，
    // 一移動鏡頭就整片閃爍。
    const flush = 2 - CIVIC_INSET * 2;
    expect(() => assembleCivic([box({ w: flush, d: flush })], FOOT, GREY)).not.toThrow();
    expect(() => assembleCivic([box({ w: flush + 0.01, d: flush })], FOOT, GREY)).toThrow();
  });

  it('should say how far out it went, in metres', () => {
    // 「超出佔地」四個字不夠用 —— 要知道差多少才改得動量體表。
    expect(() => assembleCivic([box({ w: 3, d: 1 })], FOOT, GREY)).toThrow(/m/);
  });

  it('should tag every vertex it emits', () => {
    const geo = assembleCivic([box({ part: PART_WALL }), box({ x: 0.4, part: PART_ROOF })], FOOT, GREY);
    const col = geo.getAttribute('color');
    expect(col, '沒有頂點色 —— shader 會把整棟當成 partType 0').toBeTruthy();
    expect(col.count).toBe(geo.getAttribute('position').count);
  });

  it('should keep each volume tag on its own vertices', () => {
    // 合併之後標籤混掉的話，屋頂會長出窗戶或牆會被當成屋頂上色。
    const geo = assembleCivic(
      [box({ z: -0.4, d: 0.5, part: PART_WALL }), box({ z: 0.4, d: 0.5, part: PART_ROOF })],
      FOOT, GREY,
    );
    const col = geo.getAttribute('color');
    const tags = new Set<number>();
    for (let i = 0; i < col.count; i++) tags.add(Number(col.getX(i).toFixed(4)));
    expect(tags).toEqual(new Set([PART_WALL, PART_ROOF]));
  });

  it('should return an empty tagged geometry for an empty plan', () => {
    // 公園可能完全沒有量體（只有貼片與樹）。空陣列丟給 mergeGeometries 會
    // 回傳 null，而 null 一路傳到 `new THREE.Mesh` 才炸。
    const geo = assembleCivic([], FOOT, GREY);
    expect(geo.getAttribute('position').count).toBe(0);
    expect(geo.getAttribute('color')).toBeTruthy();
  });
});

/**
 * 離地的鋪面。
 *
 * `CivicDecal` 一律貼在地面（`GROUND_LAYERS` 是固定高度），所以醫院頂樓的
 * 直升機坪、車站的月台面這種**有高度的鋪面**沒有辦法用貼片做。它們只能是
 * 量體 —— 而量體本來沒有辦法帶「這塊鋪面多亮」。
 *
 * 明度住在頂點色的 B 通道（`setGroundShade`），與貼片同一個通道、同一個
 * shader 分支 —— 各走一套的話，屋頂上的混凝土與地上的混凝土會是兩個顏色。
 */
/**
 * 轉向的標線。
 *
 * 跑道是橢圓的，斜的停機線是斜的 —— 兩者都做不成軸對齊的矩形。轉向讓一條
 * 曲線可以用一串短直線逼近，而那正是低多邊形本來的做法。
 *
 * **只有標線層准轉。** 底層貼片的重疊檢查是軸對齊矩形的交集，轉過的底層會
 * 讓那個檢查靜靜地算錯 —— 兩塊其實重疊的鋪面會被放行，然後在畫面上閃爍。
 */
describe('轉向的貼片', () => {
  const bar = (o: Partial<CivicDecal> = {}): CivicDecal =>
    ({ x: 0, z: 0, w: 0.8, d: 0.05, shade: 1, layer: 'mark', ...o });

  it('should turn the marking about its own centre', () => {
    const geo = assembleDecals([bar({ rotationY: Math.PI / 2 })], FOOT);
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    // 轉 90 度之後長邊換到 z。
    expect(b.max.x - b.min.x).toBeCloseTo(0.05, 6);
    expect(b.max.z - b.min.z).toBeCloseTo(0.8, 6);
    // 中心不動 —— 動了的話一整圈跑道會慢慢漂走。
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(0, 6);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(0, 6);
  });

  it('should turn a marking that is not at the origin about its own centre', () => {
    // **必須離開原點測。** 放在 (0, 0) 的話「繞自己轉」與「繞原點轉」是
    // 同一件事 —— 而跑道的每一段都離原點很遠，繞原點轉會把整條跑道甩開。
    const geo = assembleDecals([bar({ x: 0.5, z: 0.3, rotationY: Math.PI / 2 })], FOOT);
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    expect((b.min.x + b.max.x) / 2, '標線繞原點轉了').toBeCloseTo(0.5, 6);
    expect((b.min.z + b.max.z) / 2, '標線繞原點轉了').toBeCloseTo(0.3, 6);
  });

  it('should measure the footprint after the marking is turned', () => {
    // 一條沿 x 剛好放得下的線，轉 90 度之後沿 z 就放不下了。用轉向前的
    // 長寬檢查的話它會被放行，而畫面上它伸進隔壁的格子。
    const long = bar({ w: 1.9, z: 0.9 });
    expect(() => assembleDecals([long], FOOT), '沒轉的時候該放得下').not.toThrow();
    expect(() => assembleDecals([{ ...long, rotationY: Math.PI / 2 }], FOOT))
      .toThrow(/超出佔地/);
  });

  it('should reject a turned base decal', () => {
    // 靜靜地算錯不如大聲地擋下來。
    expect(() => assembleDecals([bar({ layer: 'base', rotationY: 0.3 })], FOOT))
      .toThrow(/只有標線/);
  });

  it('should leave an unturned marking exactly where it was', () => {
    const plain = assembleDecals([bar()], FOOT);
    const zero = assembleDecals([bar({ rotationY: 0 })], FOOT);
    plain.computeBoundingBox();
    zero.computeBoundingBox();
    expect(zero.boundingBox!.min.x).toBeCloseTo(plain.boundingBox!.min.x, 9);
    expect(zero.boundingBox!.min.z).toBeCloseTo(plain.boundingBox!.min.z, 9);
  });
});

describe('量體上的鋪面明度', () => {
  it('should write the shade into the blue channel', () => {
    const geo = assembleCivic([box({ part: PART_GROUND, shade: 0.8 })], FOOT, GREY);
    const c = geo.getAttribute('color');
    expect(c.getZ(0), '明度沒有寫進 B 通道').toBeCloseTo(0.8, 6);
  });

  it('should keep each volume on its own shade', () => {
    // 直升機坪的深色甲板與白色 H 是同一份幾何裡的兩塊。整份一起寫的話
    // H 就消失了 —— 與 `aBldgColor` 逐量體寫是完全一樣的道理。
    const geo = assembleCivic([
      box({ x: -0.3, w: 0.4, part: PART_GROUND, shade: 0.2 }),
      box({ x: 0.3, w: 0.4, part: PART_GROUND, shade: 1.0 }),
    ], FOOT, GREY);
    const c = geo.getAttribute('color');
    const seen = new Set<string>();
    for (let i = 0; i < c.count; i++) seen.add(c.getZ(i).toFixed(2));
    expect(seen, '兩塊鋪面的明度被寫成同一個').toEqual(new Set(['0.20', '1.00']));
  });

  it('should leave the channel alone when no shade is asked for', () => {
    // 牆與屋頂不吃 B 通道。寫進去只是把一個沒有意義的值餵給 shader，
    // 而哪天有人替牆加了一個讀 B 的分支，那個值會突然開始有作用。
    const geo = assembleCivic([box()], FOOT, GREY);
    expect(geo.getAttribute('color').getZ(0)).toBe(0);
  });
});

describe('assembleDecals', () => {
  it('should emit flat quads with no sides', () => {
    // 有厚度的話側面會長出牆，而牆會長出窗戶（`decals.ts` 已經踩過這個坑）。
    const geo = assembleDecals([decal()], FOOT);
    const pos = geo.getAttribute('position');
    const ys = new Set<number>();
    for (let i = 0; i < pos.count; i++) ys.add(Number(pos.getY(i).toFixed(6)));
    expect(ys.size, '貼片有兩個以上的高度 —— 它有厚度').toBe(1);
    expect(triangleCount(geo)).toBe(2);
  });

  it('should face up', () => {
    // 朝下的話從等角視角完全看不到 —— 材質是 FrontSide（BUG-227）。
    const geo = assembleDecals([decal()], FOOT);
    const nrm = geo.getAttribute('normal');
    for (let i = 0; i < nrm.count; i++) {
      expect(nrm.getY(i), `第 ${i} 個頂點的法線朝下`).toBeGreaterThan(0.99);
    }
  });

  it('should tag paving as ground and lawn as foliage', () => {
    const paved = assembleDecals([decal()], FOOT).getAttribute('color');
    expect(paved.getX(0)).toBeCloseTo(PART_GROUND, 6);
    const lawn = assembleDecals([decal({ lawn: true })], FOOT).getAttribute('color');
    expect(lawn.getX(0), '草地走了鋪面的分支 —— 它會是灰的').toBeCloseTo(PART_FOLIAGE, 6);
  });

  it('should write shade into the blue channel', () => {
    // 明度走頂點色而不是 aSeed：同一份貼片幾何裡要同時有深色柏油與淺色人行道，
    // 而 aSeed 是逐實例的 —— 它分不出同一個 mesh 內的兩塊地面。
    const geo = assembleDecals([decal({ shade: 0.85 })], FOOT);
    expect(geo.getAttribute('color').getZ(0)).toBeCloseTo(0.85, 6);
  });

  it('should stack marks above the base layer', () => {
    const base = assembleDecals([decal()], FOOT).getAttribute('position').getY(0);
    const mark = assembleDecals([decal({ layer: 'mark' })], FOOT).getAttribute('position').getY(0);
    expect(mark, '標線沒有疊在鋪面之上 —— 兩者會 z-fighting').toBeGreaterThan(base);
  });

  it('should reject overlapping base decals', () => {
    // 兩塊同高同位的四邊形在靜態截圖上看不出來，一移動鏡頭就整片閃爍。
    expect(() => assembleDecals([decal(), decal({ x: 0.5 })], FOOT))
      .toThrow(/底層貼片重疊/);
  });

  it('should allow base decals that merely touch', () => {
    // 共邊不是重疊。擋掉共邊的話，「四個邊各自一種鋪面」這種結構就寫不出來。
    expect(() => assembleDecals([decal(), decal({ x: 1 })], { w: 3, h: 2 })).not.toThrow();
  });

  it('should allow a mark to sit on top of a base decal', () => {
    expect(() => assembleDecals([decal(), decal({ layer: 'mark' })], FOOT)).not.toThrow();
  });

  it('should allow two marks to overlap', () => {
    // 標線本來就會疊：停車格線畫在入口踏板上。
    expect(() => assembleDecals(
      [decal({ layer: 'mark' }), decal({ layer: 'mark' })], FOOT,
    )).not.toThrow();
  });

  it('should keep decals inside the footprint', () => {
    expect(() => assembleDecals([decal({ w: 3 })], FOOT)).toThrow(/超出佔地/);
  });

  it('should let a decal reach the footprint edge', () => {
    // 貼片與量體不同 —— 它是平的鋪面，鋪到格子邊界是對的（人行道本來就
    // 一路鋪到路邊）。所以它不吃 CIVIC_INSET。
    expect(() => assembleDecals([decal({ w: 2, d: 2 })], FOOT)).not.toThrow();
  });

  it('should return an empty tagged geometry when there are no decals', () => {
    const geo = assembleDecals([], FOOT);
    expect(geo.getAttribute('position').count).toBe(0);
    expect(geo.getAttribute('color')).toBeTruthy();
  });
});
