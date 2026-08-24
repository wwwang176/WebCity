import { describe, it, expect } from 'vitest';
import {
  DISTRICT_SWATCHES, isValidSwatchIndex, swatchCssFor, nextSwatchIndex,
  DISTRICT_COLOR, DISTRICT_LABEL_LIGHTNESS,
} from '../DistrictPalette';
import { DistrictManager } from '../DistrictManager';
import { districtOverlayValue, districtLabelAnchors } from '../../overlay/OverlayBuilders';

/**
 * The swatch, the overlay value and the panel's colour block have to be one colour.
 *
 * They take different code paths — the overlay computes a vertex colour from HSL, the panel is a
 * CSS string — and disagreeing means the player clicks blue in the panel and gets green on the
 * map, with nothing reporting an error.
 */

describe('色票', () => {
  it('should offer enough distinct colours to tell districts apart', () => {
    expect(DISTRICT_SWATCHES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(DISTRICT_SWATCHES.map(s => s.value)).size,
      '有兩個色票是同一個顏色').toBe(DISTRICT_SWATCHES.length);
  });

  it('should never use 0, which the overlay throws away', () => {
    // `buildOverlayData` drops 0 as "nothing on this cell". A swatch at 0 makes any district
    // that chose it disappear from the overlay entirely.
    for (const s of DISTRICT_SWATCHES) {
      expect(s.value, '色票的數值是 0，那一區會從圖層上消失').toBeGreaterThan(0);
      expect(s.value).toBeLessThanOrEqual(100);
    }
  });

  it('should describe each swatch with the hue the overlay will actually draw', () => {
    // The panel's CSS hue has to equal the overlay's value/100 x 360.
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
    // A district that never chose still uses the golden-ratio hash: two districts drawn at the
    // start should be two colours.
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
    // No cells means no centre. Computing one anyway gives NaN and sends the label off screen.
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
    // The overlay's setHSL, the panel's CSS and the label canvas take three different paths. Any
    // one of them writing its own literals means an adjustment that misses it has no symptom
    // beyond looking slightly wrong.
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
    // A district colour is a background to look at for a long time. Saturation creeping back up
    // makes the whole map loud.
    expect(DISTRICT_COLOR.saturation).toBeLessThanOrEqual(0.5);
  });
});

describe('色相避開草地', () => {
  it('should keep every swatch out of the grass band', () => {
    // 80-150 degrees is the colour of grass. At this saturation a swatch there is nearly
    // invisible on the map, which is how two swatches vanished from an evenly divided hue
    // circle.
    for (const s of DISTRICT_SWATCHES) {
      const hue = (s.value / 100) * 360;
      const inGrass = hue >= 80 && hue <= 150;
      expect(inGrass, `色相 ${Math.round(hue)} 度落在草地那一段，鋪在地圖上看不見`)
        .toBe(false);
    }
  });

  it('should still spread them around the wheel', () => {
    // The control: all eight swatches crowded onto one hue would also satisfy the test above.
    const hues = DISTRICT_SWATCHES.map(s => (s.value / 100) * 360).sort((a, b) => a - b);
    expect(hues[hues.length - 1]! - hues[0]!, '所有色票擠在同一段色相裡')
      .toBeGreaterThan(180);
  });
});

describe('新分區馬上配一個顏色', () => {
  /**
   * Without one it falls back to a hue from the golden-ratio hash, which is not among the eight
   * swatches and may land in the invisible grass band of 80-150 degrees. And the player cannot
   * choose it again, because it is not a swatch.
   */
  it('should hand out a colour nobody is using', () => {
    const first = nextSwatchIndex([]);
    expect(isValidSwatchIndex(first)).toBe(true);
    expect(nextSwatchIndex([first]), '第二區拿到跟第一區一樣的').not.toBe(first);
  });

  it('should keep consecutive districts far apart on the wheel', () => {
    // Districts drawn one after another take consecutively handed-out swatches. Handed out by
    // index, the first two get adjacent hues (352 and 20 degrees), the most similar pair of the
    // eight.
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
    // With the first district deleted, its colour has to return to the pool.
    expect(nextSwatchIndex([second])).toBe(first);
  });

  it('should wrap once every colour is taken', () => {
    const all = DISTRICT_SWATCHES.map((_, i) => i);
    expect(isValidSwatchIndex(nextSwatchIndex(all)), '八區之後就配不出顏色了').toBe(true);
  });

  it('should pick the least crowded colour when it has to repeat', () => {
    // Once every swatch has been used, the least repeated one. A plain modulo keeps stacking
    // onto the same one.
    const all = DISTRICT_SWATCHES.map((_, i) => i);
    const twice = [0, 1, 2, 3, 4, 5];
    const picked = nextSwatchIndex([...all, ...twice]);
    expect(twice, '挑了一個已經用兩次的，而還有只用過一次的').not.toContain(picked);
  });

  it('should ignore what a hand-edited save could carry', () => {
    // Saves are editable. This only checks that nothing throws and no broken index comes back;
    // it does **not** guard the line filtering broken indices, because the least-used one is
    // taken and a stray key's count is always at least the untouched zeros.
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
    // A split produces a new district too, and the player has to tell it apart on the map.
    const dm = new DistrictManager();
    const a = dm.createDistrict('A');
    dm.addCellToDistrict(a.id, 0, 0);
    dm.addCellToDistrict(a.id, 1, 0);
    const split = dm.splitDistrict(a.id, new Set(['1,0']));
    expect(isValidSwatchIndex(split.colorIndex), '切出來的分區沒有配到色票').toBe(true);
    expect(split.colorIndex, '切出來的跟原本的同色').not.toBe(a.colorIndex);
  });
});
