import { describe, it, expect } from 'vitest';
import {
  DISTRICT_SWATCHES, isValidSwatchIndex, swatchCssFor, nextSwatchIndex,
  DISTRICT_COLOR, DISTRICT_LABEL_LIGHTNESS,
} from '../DistrictPalette';
import { DistrictManager } from '../DistrictManager';
import { districtOverlayValue, districtLabelAnchors } from '../../overlay/OverlayBuilders';

/**
 * 色票、圖層數值、面板色塊三者必須是同一個顏色。
 *
 * 它們走的是不同的程式碼路徑（圖層是 HSL 算出來的頂點色，面板是 CSS 字串），對不
 * 起來的話玩家在面板上點了藍色，地圖上卻是綠色 —— 而且沒有任何東西會報錯。
 */

describe('色票', () => {
  it('should offer enough distinct colours to tell districts apart', () => {
    expect(DISTRICT_SWATCHES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(DISTRICT_SWATCHES.map(s => s.value)).size,
      '有兩個色票是同一個顏色').toBe(DISTRICT_SWATCHES.length);
  });

  it('should never use 0, which the overlay throws away', () => {
    // `buildOverlayData` 把 0 當成「這一格沒東西」丟掉。色票落在 0 的話，選了那個
    // 顏色的分區會整區從圖層上消失。
    for (const s of DISTRICT_SWATCHES) {
      expect(s.value, '色票的數值是 0，那一區會從圖層上消失').toBeGreaterThan(0);
      expect(s.value).toBeLessThanOrEqual(100);
    }
  });

  it('should describe each swatch with the hue the overlay will actually draw', () => {
    // 面板的 CSS 色相必須等於圖層的 value/100 × 360。
    for (const s of DISTRICT_SWATCHES) {
      const hue = Number(/hsl\(([\d.]+)/.exec(s.css)![1]);
      expect(hue, `色塊的色相跟圖層算出來的不一樣（value=${s.value}）`)
        .toBeCloseTo((s.value / 100) * 360, 6);
    }
  });
});

describe('索引檢查', () => {
  it('should accept every index the palette has', () => {
    for (let i = 0; i < DISTRICT_SWATCHES.length; i++) {
      expect(isValidSwatchIndex(i), `${i} 應該是有效的`).toBe(true);
    }
  });

  it('should reject what a hand-edited save could carry', () => {
    for (const bad of [undefined, -1, DISTRICT_SWATCHES.length, 1.5, NaN]) {
      expect(isValidSwatchIndex(bad as number), `${bad} 不該被接受`).toBe(false);
    }
    expect(swatchCssFor(-1)).toBeUndefined();
  });
});

describe('圖層拿到的數值', () => {
  it('should use the swatch the player picked', () => {
    const picked = 3;
    expect(districtOverlayValue({ id: 'district_1', colorIndex: picked }))
      .toBe(DISTRICT_SWATCHES[picked]!.value);
  });

  it('should still spread the colours when nobody has picked one', () => {
    // 沒選過的分區照舊用黃金比例雜湊 —— 開局畫兩區就該是兩個顏色。
    const a = districtOverlayValue({ id: 'district_1' });
    const b = districtOverlayValue({ id: 'district_2' });
    expect(a).toBeGreaterThan(0);
    expect(a, '兩個沒選色的分區是同一個顏色').not.toBeCloseTo(b, 3);
  });

  it('should fall back rather than vanish on a broken index', () => {
    const v = districtOverlayValue({ id: 'district_1', colorIndex: 999 });
    expect(v, '壞掉的索引讓那一區從圖層上消失了').toBeGreaterThan(0);
    expect(v).toBe(districtOverlayValue({ id: 'district_1' }));
  });
});

describe('圖層上的名稱', () => {
  const d = (id: string, name: string, cells: string[]) => ({ id, name, cells: new Set(cells) });

  it('should put the label in the middle of the district', () => {
    const [a] = districtLabelAnchors([d('district_1', 'Riverside', ['2,2', '4,2', '2,4', '4,4'])]);
    expect(a).toEqual({ id: 'district_1', name: 'Riverside', x: 3, y: 3 });
  });

  it('should skip a district with no cells', () => {
    // 沒有格子就沒有中心點。硬算會得到 NaN，標籤會飛到畫面外。
    expect(districtLabelAnchors([d('district_1', 'Empty', [])])).toEqual([]);
  });

  it('should give every district that has cells a label', () => {
    const anchors = districtLabelAnchors([
      d('district_1', 'A', ['0,0']),
      d('district_2', 'B', ['9,9']),
    ]);
    expect(anchors.map(a => a.name)).toEqual(['A', 'B']);
  });
});

describe('三個地方共用同一組飽和度與亮度', () => {
  it('should build the swatch css from the shared constants', () => {
    // 圖層（setHSL）、面板色塊（CSS）、標籤底色（canvas）走三條不同的路。任何一
    // 個自己寫死數字的話，調色時漏掉它不會有任何徵兆 —— 只會看起來怪怪的。
    for (const s of DISTRICT_SWATCHES) {
      const m = /hsl\([\d.]+ ([\d.]+)% ([\d.]+)%\)/.exec(s.css)!;
      expect(Number(m[1]), '色塊的飽和度不是共用的那個').toBeCloseTo(DISTRICT_COLOR.saturation * 100, 6);
      expect(Number(m[2]), '色塊的亮度不是共用的那個').toBeCloseTo(DISTRICT_COLOR.lightness * 100, 6);
    }
  });

  it('should keep the label darker than the swatch so white text holds up', () => {
    expect(DISTRICT_LABEL_LIGHTNESS, '標籤底色沒有比色塊暗，白字會糊掉')
      .toBeLessThan(DISTRICT_COLOR.lightness);
  });

  it('should stay a background colour, not a warning colour', () => {
    // 分區的顏色是要能長時間看著的底色。飽和度爬回去的話整張地圖會很吵。
    expect(DISTRICT_COLOR.saturation).toBeLessThanOrEqual(0.5);
  });
});

describe('色相避開草地', () => {
  it('should keep every swatch out of the grass band', () => {
    // 80–150 度是草地的顏色。飽和度壓低之後，落在那裡的色票鋪在地圖上幾乎看不見
    // —— 均勻切色相環的版本裡有兩個色票就是這樣化掉的。
    for (const s of DISTRICT_SWATCHES) {
      const hue = (s.value / 100) * 360;
      const inGrass = hue >= 80 && hue <= 150;
      expect(inGrass, `色相 ${Math.round(hue)} 度落在草地那一段，鋪在地圖上看不見`)
        .toBe(false);
    }
  });

  it('should still spread them around the wheel', () => {
    // 反面控制:八個色票全擠在同一個色相也會通過上面那條。
    const hues = DISTRICT_SWATCHES.map(s => (s.value / 100) * 360).sort((a, b) => a - b);
    expect(hues[hues.length - 1]! - hues[0]!, '所有色票擠在同一段色相裡')
      .toBeGreaterThan(180);
  });
});

describe('新分區馬上配一個顏色', () => {
  /**
   * 沒配的話它會落在黃金比例雜湊出來的色相上 —— 那個色相不在八個色票裡，也可能
   * 落進草地那一段（80–150 度）看不見。而且玩家沒得「改回原本那個」，因為原本
   * 那個不是色票。
   */
  it('should hand out a colour nobody is using', () => {
    const first = nextSwatchIndex([]);
    expect(isValidSwatchIndex(first)).toBe(true);
    expect(nextSwatchIndex([first]), '第二區拿到跟第一區一樣的').not.toBe(first);
  });

  it('should keep consecutive districts far apart on the wheel', () => {
    // 玩家連續畫出來的分區拿到的是連續發配的色票。照索引順序發的話，前兩區會拿到
    // 相鄰的色相（352 度與 20 度）—— 那是這八個裡最像的一對。
    const hueOf = (i: number) => (DISTRICT_SWATCHES[i]!.value / 100) * 360;
    const gap = (a: number, b: number) => {
      const d = Math.abs(hueOf(a) - hueOf(b));
      return Math.min(d, 360 - d);
    };
    const handed: number[] = [];
    for (let n = 0; n < DISTRICT_SWATCHES.length; n++) handed.push(nextSwatchIndex(handed));
    for (let i = 1; i < handed.length; i++) {
      expect(gap(handed[i - 1]!, handed[i]!),
        `連續發出的第 ${i} 與第 ${i + 1} 個色票色相只差 ${Math.round(gap(handed[i - 1]!, handed[i]!))} 度`)
        .toBeGreaterThan(60);
    }
    expect(new Set(handed).size, '八次發配沒有把八個色票都發完').toBe(DISTRICT_SWATCHES.length);
  });

  it('should fill a gap left by a deleted district', () => {
    const first = nextSwatchIndex([]);
    const second = nextSwatchIndex([first]);
    // 第一區被刪掉，它的顏色要能被拿回來用。
    expect(nextSwatchIndex([second])).toBe(first);
  });

  it('should wrap once every colour is taken', () => {
    const all = DISTRICT_SWATCHES.map((_, i) => i);
    expect(isValidSwatchIndex(nextSwatchIndex(all)), '八區之後就配不出顏色了').toBe(true);
  });

  it('should pick the least crowded colour when it has to repeat', () => {
    // 全部用過一輪之後，重複用最少的那個。單純取模的話會一直疊在同一個上。
    const all = DISTRICT_SWATCHES.map((_, i) => i);
    const twice = [0, 1, 2, 3, 4, 5];
    const picked = nextSwatchIndex([...all, ...twice]);
    expect(twice, '挑了一個已經用兩次的，而還有只用過一次的').not.toContain(picked);
  });

  it('should ignore what a hand-edited save could carry', () => {
    // 存檔是可以編輯的。這條只驗「不會炸、也不會回一個壞索引」——
    // 它**守不到**過濾壞索引那一行:挑的是用最少的，而雜散的鍵永遠 ≥ 那些
    // 沒被碰過的 0，算不算進去結果都一樣。
    expect(nextSwatchIndex([undefined, -1, 999, 1.5, NaN])).toBe(0);
  });
});

describe('分區一建立就有顏色', () => {
  it('should give a brand new district a swatch', () => {
    const dm = new DistrictManager();
    const d = dm.createDistrict('A');
    expect(isValidSwatchIndex(d.colorIndex), '新分區沒有配到色票').toBe(true);
  });

  it('should not hand the same colour to the next one', () => {
    const dm = new DistrictManager();
    const a = dm.createDistrict('A');
    const b = dm.createDistrict('B');
    expect(b.colorIndex, '連續兩區同色').not.toBe(a.colorIndex);
  });

  it('should reuse a colour freed by a deleted district', () => {
    const dm = new DistrictManager();
    const a = dm.createDistrict('A');
    dm.createDistrict('B');
    dm.deleteDistrict(a.id);
    expect(dm.createDistrict('C').colorIndex, '刪掉之後那個顏色沒有被放回去')
      .toBe(a.colorIndex);
  });

  it('should give a split-off district its own colour', () => {
    // 切出來的也是一個新分區，玩家一樣要在地圖上分得出它。
    const dm = new DistrictManager();
    const a = dm.createDistrict('A');
    dm.addCellToDistrict(a.id, 0, 0);
    dm.addCellToDistrict(a.id, 1, 0);
    const split = dm.splitDistrict(a.id, new Set(['1,0']));
    expect(isValidSwatchIndex(split.colorIndex), '切出來的分區沒有配到色票').toBe(true);
    expect(split.colorIndex, '切出來的跟原本的同色').not.toBe(a.colorIndex);
  });
});
