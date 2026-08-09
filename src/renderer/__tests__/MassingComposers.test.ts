import { describe, it, expect } from 'vitest';
import {
  single, mainPlusWing, lShape, podiumTower, setback, notch, twin, splitSpan,
  shedWithStack, siloRow,
  type Composer,
} from '../geometry/buildings/massing/composers';
import {
  maxAbsOf, topOf, overlapOf, centroidOffset, rasterise, differenceRatio,
  type Volume,
} from '../geometry/buildings/massing/volume';
import type { Dimensions } from '../geometry/buildings/massing/dimensions';
import { variantRng } from '../geometry/buildings/massing/rng';

/** 一組有代表性的尺寸：矮寬的房子、高瘦的塔。 */
const HOUSE: Dimensions = { w: 0.62, d: 0.58, floors: 2, floorHeight: 0.26, height: 0.52 };
const TOWER: Dimensions = { w: 0.74, d: 0.70, floors: 13, floorHeight: 0.26, height: 3.38 };

const ALL: Array<[string, Composer]> = [
  ['single', (d) => single(d)],
  ['mainPlusWing', mainPlusWing(0.4, 0.5)],
  ['lShape', lShape(0.55)],
  ['podiumTower', podiumTower(2, 0.66, 0)],
  ['offsetTower', podiumTower(2, 0.6, 0.9)],
  ['setback', setback(3)],
  ['notch', notch(0.34)],
  ['twin', twin(0.24)],
  ['splitSpan', splitSpan(0.55)],
  ['shedWithStack', shedWithStack(0.18, 0.62, 'cylinder')],
  ['siloRow', siloRow(3, 0.24, 0.5)],
];

/** 同一組輸入跑八次，涵蓋 rng 的不同分支。 */
function samples(c: Composer, dims: Dimensions): Volume[][] {
  const out: Volume[][] = [];
  for (let vi = 0; vi < 8; vi++) out.push(c(dims, variantRng(1, 'LOW', 1, vi)));
  return out;
}

describe('composers keep the invariants', () => {
  it('should stay inside the footprint dimensions gave them', () => {
    // 基地是 dimensions 決定的（它已經確認過不越過行人包絡線）。組合器把量體
    // 推出去的話，那個檢查就白做了 —— BUG-221/222 會從這裡漏回來。
    for (const [name, c] of ALL) {
      for (const dims of [HOUSE, TOWER]) {
        for (const vs of samples(c, dims)) {
          expect(maxAbsOf(vs), `${name} 撐開了基地`)
            .toBeLessThanOrEqual(Math.max(dims.w, dims.d) / 2 + 1e-9);
        }
      }
    }
  });

  it('should never overlap its own volumes', () => {
    // 重疊會產生看不見的內部面：白吃三角形，畫面上完全看不出來。
    for (const [name, c] of ALL) {
      for (const dims of [HOUSE, TOWER]) {
        for (const vs of samples(c, dims)) {
          for (let i = 0; i < vs.length; i++) {
            for (let j = i + 1; j < vs.length; j++) {
              expect(overlapOf(vs[i]!, vs[j]!), `${name} 的第 ${i}、${j} 塊重疊`)
                .toBeCloseTo(0, 12);
            }
          }
        }
      }
    }
  });

  it('should reach exactly the height dimensions asked for', () => {
    // 高度是 dimensions 決定的。組合器自己加減會讓等級階梯漂掉。
    for (const [name, c] of ALL) {
      for (const dims of [HOUSE, TOWER]) {
        for (const vs of samples(c, dims)) {
          expect(topOf(vs), `${name} 沒有蓋到目標高度`).toBeCloseTo(dims.height, 9);
        }
      }
    }
  });

  it('should stand on the ground', () => {
    for (const [name, c] of ALL) {
      for (const vs of samples(c, TOWER)) {
        expect(Math.min(...vs.map(v => v.y0)), `${name} 沒有落地`).toBe(0);
      }
    }
  });

  it('should never emit a zero-volume block', () => {
    // 高度或寬度為 0 的量體會產生退化三角形，而且不會有任何東西報錯。
    for (const [name, c] of ALL) {
      for (const dims of [HOUSE, TOWER]) {
        for (const vs of samples(c, dims)) {
          for (const v of vs) {
            expect(v.w * v.d * (v.y1 - v.y0), `${name} 有一塊是空的`).toBeGreaterThan(1e-9);
          }
        }
      }
    }
  });
});

describe('composers earn their keep', () => {
  it('should give the asymmetric ones a real centroid offset', () => {
    // 旋轉是四倍的免費變化，但只有在形狀不對稱時才拿得到。
    const asym = [
      'mainPlusWing', 'lShape', 'offsetTower', 'twin', 'splitSpan', 'shedWithStack',
    ];
    for (const [name, c] of ALL) {
      if (!asym.includes(name)) continue;
      const offs = samples(c, TOWER).map(centroidOffset);
      expect(Math.max(...offs), `${name} 其實是對稱的`).toBeGreaterThan(0.04);
    }
  });

  it('should leave the symmetric ones symmetric', () => {
    // 這一條是上一條的對照。少了它，「不對稱」的門檻可能被一個回傳
    // 常數 0.05 的實作矇混過去。
    for (const name of ['single', 'setback']) {
      const c = ALL.find(e => e[0] === name)![1];
      for (const vs of samples(c, TOWER)) {
        expect(centroidOffset(vs), `${name} 不該偏心`).toBeCloseTo(0, 9);
      }
    }
  });

  it('should give every composer a silhouette of its own', () => {
    // 兩個組合器產出同一個輪廓，就等於少了一個組合器。
    const half = TOWER.floorHeight / 2;
    const grids = ALL.map(([name, c]) =>
      [name, rasterise(c(TOWER, variantRng(1, 'LOW', 1, 0)))] as const);
    for (let i = 0; i < grids.length; i++) {
      for (let j = i + 1; j < grids.length; j++) {
        expect(
          differenceRatio(grids[i]![1], grids[j]![1], half),
          `${grids[i]![0]} 與 ${grids[j]![0]} 輪廓相同`,
        ).toBeGreaterThanOrEqual(0.10);
      }
    }
  });

  it('should fall back to a single block when there are not enough floors', () => {
    // 一層樓的裙樓塔會讓塔身高度歸零。矮建築配到高樓原型是遲早的事。
    const oneFloor: Dimensions = { w: 0.6, d: 0.6, floors: 1, floorHeight: 0.26, height: 0.26 };
    for (const [name, c] of ALL) {
      const vs = c(oneFloor, variantRng(1, 'LOW', 1, 0));
      expect(topOf(vs), `${name} 一層樓時高度不對`).toBeCloseTo(0.26, 9);
      for (const v of vs) {
        expect(v.y1 - v.y0, `${name} 一層樓時有一塊是零高`).toBeGreaterThan(1e-9);
      }
    }
  });
});
