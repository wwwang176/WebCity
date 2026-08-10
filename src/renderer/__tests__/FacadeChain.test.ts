import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILDING_FRAG, sortedFacadeKeys, sortKeysByCat, facadeThresholds, facadeKeyOf,
} from '../BuildingMaterial';
import { ZONE_CAT } from '../geometry/buildings/parts';
import { ZoneType } from '../../core/grid/types';

const BASELINE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'building-frag-baseline.glsl'),
  'utf8',
);

/**
 * 立面的 if 鏈原本是手寫的六個門檻，而屋頂色票是由 `ZONE_CAT` 生成的。
 * 同一張表兩份資料 —— 改了一邊不會有任何東西報錯，而錯的表現是「某個分區
 * 默默拿到別人的立面」。
 *
 * 這一輪只把生成方式統一，**不改變任何行為**。所以驗收標準取最嚴格的那一種：
 * 產生出來的原始碼一個 byte 都不變。
 */
describe('生成的 shader 與手寫版逐字元相同', () => {
  it('should emit a byte-identical fragment shader', () => {
    expect(BUILDING_FRAG).toBe(BASELINE);
  });
});

describe('門檻由 ZONE_CAT 推導', () => {
  /**
   * 這一條用的是自備的表，不是 `ZONE_CAT`。
   *
   * `Object.entries` 對整數字串 key 是照**數值**遞增列舉的，而 `ZONE_CAT`
   * 現在的 key 順序剛好等於 cat 順序 —— 拿它來測的話，把 `.sort()` 整條
   * 拿掉也不會轉紅（回退驗證時實際發生過）。要 key 順序與 cat 順序不一致
   * 的表才測得到排序有沒有真的發生。
   */
  it('should sort by category, not by key', () => {
    expect(sortKeysByCat({ 1: 0.9, 2: 0.5, 3: 0.1 })).toEqual([3, 2, 1]);
    expect(sortKeysByCat({ 7: 0.1, 3: 0.4, 9: 0.2 })).toEqual([7, 9, 3]);
  });

  it('should order the branches by ascending category', () => {
    const keys = sortedFacadeKeys();
    const cats = keys.map(k => ZONE_CAT[k]!);
    expect(cats).toEqual([...cats].sort((a, b) => a - b));
    expect(keys.length).toBe(Object.keys(ZONE_CAT).length);
  });

  it('should put each threshold at the midpoint of two neighbouring categories', () => {
    const keys = sortedFacadeKeys();
    const th = facadeThresholds();
    expect(th.length).toBe(keys.length);
    for (let i = 0; i < keys.length - 1; i++) {
      expect(th[i]).toBeCloseTo((ZONE_CAT[keys[i]!]! + ZONE_CAT[keys[i + 1]!]!) / 2, 10);
    }
    expect(th[th.length - 1], '最後一個分支不是 else').toBe(Infinity);
  });

  it('should not emit float noise', () => {
    // `(0.2 + 0.4) / 2` 是 0.30000000000000004。GLSL 的 highp float 只有約
    // 7 位有效數字，那些尾數編譯時就沒了 —— 留著只會讓 shader 難讀。
    for (const t of facadeThresholds().filter(t => Number.isFinite(t))) {
      const decimals = String(t).split('.')[1]?.length ?? 0;
      expect(decimals, `門檻 ${t} 帶著浮點雜訊`).toBeLessThanOrEqual(6);
    }
  });

  it('should keep every threshold strictly between its two categories', () => {
    // 四捨五入若把門檻推到某個 cat 之上或之下，那個分區會**整個消失** ——
    // 它的分支永遠不成立，而畫面上只表現為「某一區長得像隔壁區」。
    const keys = sortedFacadeKeys();
    const th = facadeThresholds();
    for (let i = 0; i < keys.length - 1; i++) {
      expect(th[i]!, `門檻 ${th[i]} 沒有高過 ${keys[i]} 的 cat`)
        .toBeGreaterThan(ZONE_CAT[keys[i]!]!);
      expect(th[i]!, `門檻 ${th[i]} 沒有低於 ${keys[i + 1]} 的 cat`)
        .toBeLessThan(ZONE_CAT[keys[i + 1]!]!);
    }
  });

  it('should route every category to its own branch', () => {
    for (const key of sortedFacadeKeys()) {
      expect(facadeKeyOf(ZONE_CAT[key]!), `cat ${ZONE_CAT[key]} 沒有走進自己的分支`)
        .toBe(key);
    }
  });

  /**
   * 這一條把「JS 的門檻」與「GLSL 的門檻」綁在一起。
   *
   * `facadeKeyOf` 是 GLSL if 鏈的 JS 分身 —— 它本身就是第二份資料。從產生
   * 出來的原始碼把數字挖回來比對，這個迴圈才閉合。
   */
  it('should emit exactly the thresholds it computed', () => {
    const wall = BUILDING_FRAG.slice(BUILDING_FRAG.indexOf('=== WALL'));
    const emitted = [...wall.matchAll(/vZoneCat < ([0-9.]+)/g)].map(m => Number(m[1]));
    const expected = facadeThresholds().filter(t => Number.isFinite(t));
    expect(emitted, 'GLSL 裡的門檻與 JS 算出來的不一致').toEqual(expected);
  });

  /** 屋頂色票鏈與立面鏈吃同一張門檻表，所以它也要挖回來比對。 */
  it('should emit the same thresholds in the roof colour chain', () => {
    const roof = BUILDING_FRAG.slice(
      BUILDING_FRAG.indexOf('vec3 getRoofColor'),
      BUILDING_FRAG.indexOf('void main()'),
    );
    const emitted = [...roof.matchAll(/zoneCat < ([0-9.]+)/g)].map(m => Number(m[1]));
    const expected = facadeThresholds().filter(t => Number.isFinite(t));
    expect(emitted, '屋頂與立面兩條鏈的門檻不一致').toEqual(expected);
  });
});

describe('六個分區的立面沒有被搬錯', () => {
  /** 每個分支獨有的標記，照 cat 遞增的順序。搬錯位置的話順序會亂。 */
  const SIGNATURE: Array<[number, string]> = [
    [ZoneType.RESIDENTIAL_LOW, 'RESIDENTIAL LOW'],
    [ZoneType.RESIDENTIAL_HIGH, 'RESIDENTIAL HIGH'],
    [ZoneType.COMMERCIAL_LOW, 'COMMERCIAL LOW'],
    [ZoneType.COMMERCIAL_HIGH, 'COMMERCIAL HIGH'],
    [ZoneType.INDUSTRIAL, 'INDUSTRIAL'],
    [ZoneType.OFFICE, 'OFFICE'],
  ];

  it('should keep the branches in ascending category order', () => {
    const positions = SIGNATURE.map(([, marker]) => BUILDING_FRAG.indexOf(marker));
    for (const [i, p] of positions.entries()) {
      expect(p, `找不到分支標記 ${SIGNATURE[i]![1]}`).toBeGreaterThan(-1);
    }
    expect(positions, '立面分支的順序與 ZONE_CAT 不一致').toEqual(
      [...positions].sort((a, b) => a - b),
    );
  });

  it('should order the signatures the same way ZONE_CAT does', () => {
    // 標記的順序是照 cat 排的 —— 這一條讓上面那條「原始碼位置遞增」有意義。
    const cats = SIGNATURE.map(([zone]) => ZONE_CAT[zone]!);
    expect(cats).toEqual([...cats].sort((a, b) => a - b));
  });
});

describe('少一張立面表要當場炸掉', () => {
  it('should have a facade body for every category in ZONE_CAT', () => {
    // 沒有這一條的話，在 ZONE_CAT 加了類別卻忘了寫立面，結果是那一類建築
    // 拿到一片沒有窗的純色牆 —— 看起來像「還沒做完」而不像「壞了」。
    // `facadeChainGlsl` 在模組載入時就會跑，所以缺表的話這個檔案根本 import
    // 不進來；這一條在那之前先給出看得懂的訊息。
    for (const key of sortedFacadeKeys()) {
      const cat = ZONE_CAT[key]!;
      expect(facadeKeyOf(cat), `類別 ${key} 沒有自己的分支`).toBe(key);
    }
    // 分支數 = 類別數。少一個就表示某兩個類別共用了一段立面。
    const wall = BUILDING_FRAG.slice(BUILDING_FRAG.indexOf('=== WALL'));
    const opens = (wall.match(/\n    (?:else )?if \(vZoneCat|\n    else \{/g) ?? []).length;
    expect(opens, '立面分支數與 ZONE_CAT 的類別數對不上').toBe(sortedFacadeKeys().length);
  });
});
