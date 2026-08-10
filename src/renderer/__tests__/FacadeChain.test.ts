import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILDING_FRAG, sortedFacadeKeys, sortKeysByCat, facadeThresholds, facadeKeyOf,
} from '../BuildingMaterial';
import {
  ZONE_CAT, FACADE_CIVIC, FACADE_UTILITY, FACADE_TRANSIT, FACADE_GREEN,
} from '../geometry/buildings/parts';
import { roofPaletteFor } from '../ColorPalettes';
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
 * 統一的那一輪不改變任何行為，所以驗收標準取最嚴格的那一種：產生出來的
 * 原始碼一個 byte 都不變。
 *
 * **基準什麼時候該重新產生：** 只有在 shader 真的該變的時候（例如加一個
 * 立面類別）。做法是暫時寫一個把 `BUILDING_FRAG` 寫進 fixture 的測試，跑完
 * 刪掉，然後**逐行看 diff** —— 這一條的價值不在「shader 永遠不變」，而在
 * 「每一次改變都被人看過」。改門檻的推導方式時它會抓到整條鏈的位移；
 * 動某個分區的立面時它會抓到你不小心也碰到了別人的分支。
 */
describe('生成的 shader 與基準逐字元相同', () => {
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

describe('公共建築的立面類別', () => {
  const CIVIC_KEYS = [FACADE_CIVIC, FACADE_UTILITY, FACADE_TRANSIT, FACADE_GREEN];

  it('should not collide with any ZoneType', () => {
    // ZoneType 是 0–6。撞號的話公共建築會覆蓋掉某個分區的 cat 與屋頂色票，
    // 而 Record 的 key 相同只會靜靜地互相蓋掉，不會有任何東西報錯。
    for (const k of CIVIC_KEYS) expect(k).toBeGreaterThan(100);
    expect(new Set(CIVIC_KEYS).size, '公共類別之間撞號').toBe(CIVIC_KEYS.length);
  });

  it('should sit above every zone category', () => {
    const zoneCats = Object.values(ZoneType)
      .filter((z): z is number => typeof z === 'number' && z > 0)
      .map(z => ZONE_CAT[z]!);
    for (const k of CIVIC_KEYS) {
      expect(ZONE_CAT[k], `公共類別 ${k} 沒有排在所有分區之後`)
        .toBeGreaterThan(Math.max(...zoneCats));
    }
  });

  /**
   * 這是整輪最重要的一條。
   *
   * 立面鏈的最後一個分支原本是無條件的 `else` —— 辦公。加了 cat > 1.0 的
   * 公共類別之後，若那個 else 沒有變成 else if，公共建築會**靜靜地**掉進
   * 辦公的窗格分支：一座警局長出玻璃帷幕的辦公窗格，而不會有任何東西報錯。
   */
  it('should NOT fall through to the office branch', () => {
    for (const k of CIVIC_KEYS) {
      expect(facadeKeyOf(ZONE_CAT[k]!), `類別 ${k} 掉進了辦公分支`)
        .not.toBe(ZoneType.OFFICE);
      expect(facadeKeyOf(ZONE_CAT[k]!)).toBe(k);
    }
  });

  it('should give the office branch a guard instead of the bare else', () => {
    const wall = BUILDING_FRAG.slice(BUILDING_FRAG.indexOf('=== WALL'));
    const officeAt = wall.indexOf('---- OFFICE');
    expect(officeAt, '找不到辦公分支').toBeGreaterThan(-1);
    // 辦公之後還有分支 → 它不能再是無條件的 else
    const afterOffice = wall.slice(officeAt);
    expect(afterOffice, '辦公之後沒有公共分支').toContain('---- CIVIC');
    const guard = wall.slice(officeAt).split('\n')[1]!;
    expect(guard, `辦公仍是無條件的 else：${guard.trim()}`).toContain('vZoneCat <');
  });

  it('should end the chain with the last civic category, not office', () => {
    const keys = sortedFacadeKeys();
    expect(keys[keys.length - 1], '鏈的最後一個不是排序最大的公共類別')
      .toBe(FACADE_GREEN);
  });

  it('should give every civic category its own roof palette', () => {
    // 沒有色票會落到 FALLBACK_ROOF —— 四種公共建築的屋頂會一模一樣的中灰。
    for (const k of CIVIC_KEYS) {
      expect(roofPaletteFor(k), `類別 ${k} 沒有自己的屋頂色票`)
        .not.toBe(roofPaletteFor(-1));
    }
  });

  /** 這一條就是 BUG-238 本身 —— 做完了夜裡還是全黑的話它要轉紅。 */
  it('should light something at night in every civic branch', () => {
    const wall = BUILDING_FRAG.slice(BUILDING_FRAG.indexOf('=== WALL'));
    for (const marker of ['---- CIVIC', '---- UTILITY', '---- TRANSIT']) {
      const at = wall.indexOf(marker);
      expect(at, `找不到分支 ${marker}`).toBeGreaterThan(-1);
      const next = ['---- CIVIC', '---- UTILITY', '---- TRANSIT', '---- GREEN']
        .map(m => wall.indexOf(m))
        .filter(p => p > at);
      const branch = wall.slice(at, next.length ? Math.min(...next) : undefined);
      expect(branch, `${marker} 沒有設 windowMask —— 白天沒有玻璃、夜裡不會亮`)
        .toContain('windowMask');
      expect(branch, `${marker} 沒有 isLitWindow —— 夜裡一扇燈都不會亮`)
        .toContain('isLitWindow');
      expect(branch, `${marker} 的亮燈沒有看 occ`).toContain('occ');
    }
  });
});

/**
 * 把立面鏈切成每個類別一段。
 *
 * 切點是 `// ---- NAME ----` —— 那個註解由 `FACADE_COMMENT` 產生，所以它與
 * 分支是同一份資料，不是另外維護的標記表。
 */
function facadeBranches(): Array<[string, string]> {
  const wall = BUILDING_FRAG.slice(BUILDING_FRAG.indexOf('=== WALL'));
  const marks = [...wall.matchAll(/^ {4}\/\/ ---- ([A-Z ]+):/gm)];
  return marks.map((m, i) => [
    m[1]!.trim(),
    wall.slice(m.index!, i + 1 < marks.length ? marks[i + 1]!.index! : undefined),
  ]);
}

describe('每個算出來的遮罩都要有去處', () => {
  it('should split the chain into one branch per category', () => {
    // 切不出來的話下面那條會在零個分支上通過 —— 空迴圈永遠是綠的。
    expect(facadeBranches().length).toBe(sortedFacadeKeys().length);
  });

  /**
   * BUG-230a 的形狀：算好了遮罩、設了顏色，卻忘了寫 `windowMask =`。
   * 那一塊玻璃白天沒有天空反射、夜裡永遠不亮，而且不會有任何東西報錯。
   *
   * 規則：分支裡宣告的每一個 `float ...Mask`，要嘛進 `windowMask`，要嘛被
   * 明確地從別的遮罩裡扣掉 —— 住宅低密度的 `doorMask` 走的是後者，因為門是
   * 實心的，不該當成玻璃。「算了但兩者都不是」就是 BUG-230a。
   */
  it('should feed every mask it computes into windowMask, or explicitly exclude it', () => {
    let checked = 0;
    for (const [name, branch] of facadeBranches()) {
      for (const m of branch.matchAll(/float (\w+Mask)\s*=/g)) {
        const mask = m[1]!;
        // 模板字面值裡的 `\s` 就是 `s` —— 用 RegExp 組字串時反斜線必須寫兩個，
        // 而寫錯只表現成「這條測試永遠通過」。所以改成先跳脫再組。
        const feeds = new RegExp(String.raw`windowMask\s*=\s*${mask}\b`).test(branch);
        const excluded = new RegExp(String.raw`\*=\s*1\.0\s*-\s*${mask}\b`).test(branch);
        expect(feeds || excluded,
          `${name} 算了 ${mask} 卻沒有讓它進 windowMask，也沒有明確排除`).toBe(true);
        checked++;
      }
    }
    // 一個遮罩都沒檢查到就表示正規表示式與 GLSL 的寫法對不上了。
    expect(checked, '沒有掃到任何遮罩宣告 —— 正規表示式失效了').toBeGreaterThan(5);
  });
});
