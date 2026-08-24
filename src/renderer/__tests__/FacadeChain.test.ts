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
 * The facade if-chain and the roof palette are generated from one table, `ZONE_CAT`. Written by
 * hand as six thresholds alongside a generated palette, they are two copies of the same data:
 * changing one reports nothing, and the fault shows up as "one zone quietly took another zone's
 * facade".
 *
 * The acceptance standard is the strictest available: the generated source does not change by a
 * single byte.
 *
 * **When the baseline should be regenerated:** only when the shader genuinely should change,
 * such as when a facade category is added. Write a temporary test that dumps `BUILDING_FRAG` to
 * the fixture, delete it afterwards, and **read the diff line by line**. The value here is not
 * "the shader never changes" but "every change was looked at": changing how thresholds are
 * derived shows up as a shift across the whole chain, and touching one zone's facade shows up as
 * having touched another zone's branch too.
 */
describe('生成的 shader 與基準逐字元相同', () => {
  it('should emit a byte-identical fragment shader', () => {
    expect(BUILDING_FRAG).toBe(BASELINE);
  });
});

describe('門檻由 ZONE_CAT 推導', () => {
  /**
   * This case uses a table of its own rather than `ZONE_CAT`.
   *
   * `Object.entries` enumerates integer-string keys in **numeric** order, and `ZONE_CAT`'s key
   * order currently equals its cat order, so testing against it stays green even with `.sort()`
   * removed entirely, as regression checking confirmed. Detecting whether sorting happens takes
   * a table whose key order differs from its cat order.
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
    // `(0.2 + 0.4) / 2` is 0.30000000000000004. GLSL's highp float carries about 7 significant
    // digits, so those trailing figures are gone at compile time and only make the shader harder
    // to read.
    for (const t of facadeThresholds().filter(t => Number.isFinite(t))) {
      const decimals = String(t).split('.')[1]?.length ?? 0;
      expect(decimals, `門檻 ${t} 帶著浮點雜訊`).toBeLessThanOrEqual(6);
    }
  });

  it('should keep every threshold strictly between its two categories', () => {
    // If rounding pushes a threshold above or below a cat, that zone **disappears entirely**:
    // its branch never holds, and on screen it reads only as "one district looks like the one
    // next to it".
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
   * This ties the JS thresholds to the GLSL ones.
   *
   * `facadeKeyOf` is the JS counterpart of the GLSL if-chain and is itself a second copy of the
   * data. Reading the numbers back out of the generated source closes the loop.
   */
  it('should emit exactly the thresholds it computed', () => {
    const wall = BUILDING_FRAG.slice(BUILDING_FRAG.indexOf('=== WALL'));
    const emitted = [...wall.matchAll(/vZoneCat < ([0-9.]+)/g)].map(m => Number(m[1]));
    const expected = facadeThresholds().filter(t => Number.isFinite(t));
    expect(emitted, 'GLSL 裡的門檻與 JS 算出來的不一致').toEqual(expected);
  });

  /** The roof palette chain reads the same threshold table as the facade chain, so it is read back too. */
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
  /** A marker unique to each branch, in ascending cat order. Moved to the wrong place, the order breaks. */
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
    // The markers are ordered by cat, which is what gives the "positions increase in the source"
    // case above its meaning.
    const cats = SIGNATURE.map(([zone]) => ZONE_CAT[zone]!);
    expect(cats).toEqual([...cats].sort((a, b) => a - b));
  });
});

describe('少一張立面表要當場炸掉', () => {
  it('should have a facade body for every category in ZONE_CAT', () => {
    // Without this, adding a category to ZONE_CAT and forgetting its facade gives that class of
    // building a flat windowless wall, which reads as unfinished rather than broken.
    // `facadeChainGlsl` runs at module load, so a missing table stops this file importing at
    // all; this case gives a legible message before that happens.
    for (const key of sortedFacadeKeys()) {
      const cat = ZONE_CAT[key]!;
      expect(facadeKeyOf(cat), `類別 ${key} 沒有自己的分支`).toBe(key);
    }
    // One branch per category. One fewer means two categories share a facade.
    const wall = BUILDING_FRAG.slice(BUILDING_FRAG.indexOf('=== WALL'));
    const opens = (wall.match(/\n    (?:else )?if \(vZoneCat|\n    else \{/g) ?? []).length;
    expect(opens, '立面分支數與 ZONE_CAT 的類別數對不上').toBe(sortedFacadeKeys().length);
  });
});

describe('公共建築的立面類別', () => {
  const CIVIC_KEYS = [FACADE_CIVIC, FACADE_UTILITY, FACADE_TRANSIT, FACADE_GREEN];

  it('should not collide with any ZoneType', () => {
    // ZoneType is 0-6. On a collision a civic building overwrites a zone's cat and roof palette,
    // and duplicate Record keys simply overwrite each other in silence with nothing reported.
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
   * The most important case here.
   *
   * The facade chain's last branch — office — is an unconditional `else` unless it is made an
   * `else if`. With civic categories at cat > 1.0 added, an unconditional else drops civic
   * buildings **silently** into the office window branch: a police station grows curtain-wall
   * office panes with nothing reported.
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
    // Branches follow office, so it can no longer be an unconditional else.
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
    // With no palette they fall to FALLBACK_ROOF, and all four civic types get identical mid-grey
    // roofs.
    for (const k of CIVIC_KEYS) {
      expect(roofPaletteFor(k), `類別 ${k} 沒有自己的屋頂色票`)
        .not.toBe(roofPaletteFor(-1));
    }
  });

  /** This case is BUG-238 itself: if everything is still dark at night when it is done, it turns red. */
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
      // A civic building's gate is whether it has power, not an occupancy ratio. See the group of
      // cases below.
      expect(branch, `${marker} 的亮燈沒有看有沒有電`).toContain('powered');
    }
  });
});

/**
 * Splits the facade chain into one section per category.
 *
 * The split points are `// ---- NAME ----`, a comment generated by `FACADE_COMMENT`, so it is
 * the same data as the branches rather than a separately maintained marker table.
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
    // Without a successful split, the case below passes over zero branches, and an empty loop is
    // always green.
    expect(facadeBranches().length).toBe(sortedFacadeKeys().length);
  });

  /**
   * The shape of BUG-230a: the mask is computed and a colour set, but `windowMask =` is never
   * written. That glass gets no sky reflection by day, never lights at night, and nothing
   * reports it.
   *
   * The rule: every `float ...Mask` declared in a branch either feeds `windowMask` or is
   * explicitly subtracted from another mask. Low-density residential's `doorMask` takes the
   * second route, because a door is solid and should not count as glass. Computed and neither
   * is BUG-230a.
   */
  it('should feed every mask it computes into windowMask, or explicitly exclude it', () => {
    let checked = 0;
    for (const [name, branch] of facadeBranches()) {
      for (const m of branch.matchAll(/float (\w+Mask)\s*=/g)) {
        const mask = m[1]!;
        // In a template literal `\s` is just `s`: building a RegExp from a string needs the
        // backslash doubled, and getting it wrong only shows up as "this case always passes".
        // Hence escaping before composing.
        const feeds = new RegExp(String.raw`windowMask\s*=\s*${mask}\b`).test(branch);
        const excluded = new RegExp(String.raw`\*=\s*1\.0\s*-\s*${mask}\b`).test(branch);
        expect(feeds || excluded,
          `${name} 算了 ${mask} 卻沒有讓它進 windowMask，也沒有明確排除`).toBe(true);
        checked++;
      }
    }
    // Checking no masks at all means the regular expression no longer matches how the GLSL is
    // written.
    expect(checked, '沒有掃到任何遮罩宣告 —— 正規表示式失效了').toBeGreaterThan(5);
  });
});

/**
 * Civic buildings' night lighting means something **different** from zoned buildings'.
 *
 * For residential and office towers, the occupancy ratio decides how many windows light: a
 * half-empty tower should not light every row. Nobody lives in a civic building, so "how many
 * people are inside" means nothing for it; what darkens it is **a power cut**. So `aOccupancy`
 * on a civic building carries whether it has power.
 *
 * Powered is still not **fully** lit: a whole building lit reads as a glowing slab rather than a
 * building. So it follows residential at 85% occupancy — some on, some off, and which ones
 * change over time.
 */
describe('公共建築有電才亮，而且不是全亮', () => {
  const POWERED = ['---- CIVIC', '---- UTILITY', '---- TRANSIT'];

  function branchOf(marker: string): string {
    const wall = BUILDING_FRAG.slice(BUILDING_FRAG.indexOf('=== WALL'));
    const at = wall.indexOf(marker);
    const next = ['---- CIVIC', '---- UTILITY', '---- TRANSIT', '---- GREEN']
      .map(m => wall.indexOf(m)).filter(p => p > at);
    return wall.slice(at, next.length ? Math.min(...next) : undefined);
  }

  it('should not grade the lit windows by occupancy', () => {
    // `mix(a, b, occ)` is "the occupancy ratio decides how much lights", which is the
    // residential rule.
    for (const marker of POWERED) {
      const branch = branchOf(marker);
      expect(branch, `${marker} 還在用住戶比例調亮燈門檻`)
        .not.toMatch(/litThresh\w*\s*=\s*mix\(/);
    }
  });

  it('should leave some windows dark instead of lighting them all', () => {
    // A whole building lit reads as a glowing slab.
    for (const marker of POWERED) {
      const branch = branchOf(marker);
      expect(branch, `${marker} 是整棟全亮 —— 沒有暗的窗`).toContain('civicDark');
    }
  });

  /**
   * The dark fraction has to be **visible**.
   *
   * At 0.15 — 85% lit — nothing on screen reads as some on and some off; 85% lit is still a
   * glowing slab. What is wanted is what the residential rule looks like at 85% occupancy:
   * `mix(0.95, 0.4, 0.85)` ~ 0.48, roughly half lit.
   *
   * This case pins that range: lower returns to fully lit, higher makes the whole building look
   * unpowered.
   */
  it('should keep the dark fraction in a range you can actually see', () => {
    const wall = BUILDING_FRAG.slice(BUILDING_FRAG.indexOf('=== WALL'));
    const m = wall.match(/float civicDark = ([0-9.]+);/);
    expect(m, '找不到 civicDark 的值').toBeTruthy();
    const dark = Number(m![1]);
    expect(dark, `${dark} 太低 —— 幾乎全亮，看不出有的開有的關`).toBeGreaterThan(0.3);
    expect(dark, `${dark} 太高 —— 整棟看起來像沒電`).toBeLessThan(0.7);
  });

  it('should match what the residential rule gives at 85% occupancy', () => {
    // Aligned with residential at 85% occupancy. High-density residential is
    // `mix(0.95, 0.4, occ)`, and the value here has to match it or the comment is lying.
    const wall = BUILDING_FRAG.slice(BUILDING_FRAG.indexOf('=== WALL'));
    const dark = Number(wall.match(/float civicDark = ([0-9.]+);/)![1]);
    const residentialAt85 = 0.95 + (0.4 - 0.95) * 0.85;
    expect(dark, '與住宅在 85% 住戶時的門檻對不上').toBeCloseTo(residentialAt85, 3);
  });

  it('should make which windows are lit change over time', () => {
    // The on-and-off effect comes from the epoch: which windows light is redrawn every so often.
    // Without it the dark ones are always the same ones, which is a still texture.
    for (const marker of POWERED) {
      const branch = branchOf(marker);
      expect(branch, `${marker} 的亮窗不會隨時間換`).toMatch(/[eE]poch/);
      expect(branch, `${marker} 沒有讀 uTime`).toContain('uTime');
    }
  });

  it('should define the dark fraction once, in the shared preamble', () => {
    // With 0.15 written into each of the three branches, changing the brightness means
    // remembering three places.
    const wall = BUILDING_FRAG.slice(BUILDING_FRAG.indexOf('=== WALL'));
    const decl = wall.indexOf('float civicDark');
    expect(decl, '找不到 civicDark 的宣告').toBeGreaterThan(-1);
    expect(decl, 'civicDark 宣告在某個分支裡面，不是共用的前言')
      .toBeLessThan(wall.indexOf('---- RESIDENTIAL LOW'));
    expect((wall.match(/float civicDark/g) ?? []).length, 'civicDark 宣告了不只一次')
      .toBe(1);
  });

  it('should still go dark without power', () => {
    // Lit only with power. Without the test, an unpowered building blazes all night.
    for (const marker of POWERED) {
      const branch = branchOf(marker);
      expect(branch, `${marker} 沒有看有沒有電`).toContain('powered');
      expect(branch, `${marker} 的亮窗沒有吃 powered`).toMatch(/powered && hash21|isLitWindow\s*=\s*powered/);
    }
  });

  it('should define powered from occupancy in the shared preamble', () => {
    // `occ` is defined once (`float occ = vOccupancy < 0.01 ? -1.0 : ...`), so powered should be
    // too: written once per branch, changing one leaves the others behind.
    const wall = BUILDING_FRAG.slice(BUILDING_FRAG.indexOf('=== WALL'));
    const decl = wall.indexOf('bool powered');
    expect(decl, '找不到 powered 的宣告').toBeGreaterThan(-1);
    expect(decl, 'powered 宣告在某個分支裡面，不是共用的前言')
      .toBeLessThan(wall.indexOf('---- RESIDENTIAL LOW'));
  });
});
