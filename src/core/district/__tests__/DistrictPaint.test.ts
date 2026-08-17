import { describe, it, expect } from 'vitest';
import { DistrictManager } from '../DistrictManager';
import { paintDistrictRect, resolveDistrictGesture } from '../DistrictPaint';

/**
 * 分區筆刷的三種模式。
 *
 * 一格只能屬於一個分區（`addCellToDistrict` 會把它從舊分區移走），所以「畫進來」
 * 天生就會從別區搶格子 —— 那是對的，玩家看到的就是重疊處歸最後畫的那一區。
 */

function setup() {
  const districts = new DistrictManager();
  const a = districts.createDistrict('A');
  const b = districts.createDistrict('B');
  return { districts, a: a.id, b: b.id };
}

const cellsOf = (dm: DistrictManager, id: string) =>
  [...(dm.getDistrict(id)?.cells ?? [])].sort();

describe('add —— 併進來', () => {
  it('should keep what was already there', () => {
    const { districts, a } = setup();
    paintDistrictRect(districts, a, 0, 0, 1, 0, 'add');
    paintDistrictRect(districts, a, 5, 5, 5, 5, 'add');
    expect(cellsOf(districts, a)).toEqual(['0,0', '1,0', '5,5']);
  });

  it('should take cells away from whichever district held them', () => {
    // 重疊處歸最後畫的那一區。一格屬於兩個分區的話，收入乘數與費用都會算兩次。
    const { districts, a, b } = setup();
    paintDistrictRect(districts, b, 0, 0, 2, 0, 'add');
    paintDistrictRect(districts, a, 1, 0, 1, 0, 'add');
    expect(cellsOf(districts, a)).toEqual(['1,0']);
    expect(cellsOf(districts, b), 'B 沒有把被搶走的格子放掉').toEqual(['0,0', '2,0']);
    expect(districts.getDistrictAt(1, 0)?.id).toBe(a);
  });
});

describe('replace —— 這一區只剩這個矩形', () => {
  it('should drop everything outside the rectangle', () => {
    const { districts, a } = setup();
    paintDistrictRect(districts, a, 0, 0, 3, 3, 'add');
    paintDistrictRect(districts, a, 1, 1, 2, 2, 'replace');
    expect(cellsOf(districts, a)).toEqual(['1,1', '1,2', '2,1', '2,2']);
  });

  it('should leave other districts alone outside the rectangle', () => {
    // 「取代」取代的是這一區，不是整張地圖。
    const { districts, a, b } = setup();
    paintDistrictRect(districts, b, 8, 8, 9, 9, 'add');
    paintDistrictRect(districts, a, 0, 0, 1, 1, 'replace');
    expect(cellsOf(districts, b), 'B 被 A 的取代掃到了').toEqual(['8,8', '8,9', '9,8', '9,9']);
  });

  it('should still take overlapping cells from another district', () => {
    const { districts, a, b } = setup();
    paintDistrictRect(districts, b, 0, 0, 2, 0, 'add');
    paintDistrictRect(districts, a, 1, 0, 3, 0, 'replace');
    expect(cellsOf(districts, a)).toEqual(['1,0', '2,0', '3,0']);
    expect(cellsOf(districts, b)).toEqual(['0,0']);
  });
});

describe('subtract —— 挖掉', () => {
  it('should remove only the rectangle', () => {
    const { districts, a } = setup();
    paintDistrictRect(districts, a, 0, 0, 2, 0, 'add');
    paintDistrictRect(districts, a, 1, 0, 1, 0, 'subtract');
    expect(cellsOf(districts, a)).toEqual(['0,0', '2,0']);
  });

  it('should not touch another district', () => {
    // 你正在編輯 A，挖掉的就只是 A。掃到 B 的話玩家會在完全沒有意識的情況下
    // 拆掉另一區的邊界。
    const { districts, a, b } = setup();
    paintDistrictRect(districts, b, 0, 0, 2, 0, 'add');
    paintDistrictRect(districts, a, 0, 0, 2, 0, 'subtract');
    expect(cellsOf(districts, b), 'B 的格子被 A 的扣除挖掉了').toEqual(['0,0', '1,0', '2,0']);
  });

  it('should leave an empty district behind, not delete it', () => {
    // 分區還在，只是沒有格子 —— 它身上的條例設定不該因為擦掉一次就消失。
    const { districts, a } = setup();
    paintDistrictRect(districts, a, 0, 0, 1, 1, 'add');
    paintDistrictRect(districts, a, 0, 0, 1, 1, 'subtract');
    expect(cellsOf(districts, a)).toEqual([]);
    expect(districts.getDistrict(a), '分區被整個刪掉了').toBeDefined();
  });
});

describe('矩形的兩個角', () => {
  /** 單獨一個 manager，避免第二次畫把第一次的格子搶走 —— 那會蓋掉要驗的東西。 */
  const cellsFor = (x1: number, y1: number, x2: number, y2: number) => {
    const dm = new DistrictManager();
    const d = dm.createDistrict('D');
    paintDistrictRect(dm, d.id, x1, y1, x2, y2, 'add');
    return [...d.cells].sort();
  };

  it('should not care which corner the drag started from', () => {
    const reversed = cellsFor(3, 3, 1, 1);
    // 先確認正著拖真的畫得出東西 —— 少了這一條，兩邊都是空的也會「相等」，
    // 而把正規化拿掉之後迴圈剛好就不會跑。
    expect(cellsFor(1, 1, 3, 3).length, '正著拖也沒畫出格子，這條測試等於空轉').toBe(9);
    expect(reversed, '反著拖畫出來的範圍不一樣').toEqual(cellsFor(1, 1, 3, 3));
  });
});

describe('點一下是選取，拖曳才是畫', () => {
  /** A 佔 0,0–1,1；B 佔 5,5。作用中的是 A。 */
  const world = () => {
    const districts = new DistrictManager();
    const a = districts.createDistrict('A');
    const b = districts.createDistrict('B');
    paintDistrictRect(districts, a.id, 0, 0, 1, 1, 'add');
    paintDistrictRect(districts, b.id, 5, 5, 5, 5, 'add');
    return { districts, a: a.id, b: b.id };
  };

  it('should pick up the district you clicked on', () => {
    const { districts, a, b } = world();
    expect(resolveDistrictGesture(districts, a, 5, 5, 5, 5))
      .toEqual({ kind: 'select', districtId: b });
  });

  it('should pick one up when nothing is selected yet', () => {
    // 手上什麼都沒有的時候，點地圖上任何一區就是把它撿起來 —— 不然玩家得先開一個
    // 新的分區才碰得到既有的。
    const { districts, b } = world();
    expect(resolveDistrictGesture(districts, null, 5, 5, 5, 5))
      .toEqual({ kind: 'select', districtId: b });
  });

  it('should still paint when you click your own district', () => {
    // 從自己這一區挖掉一格是單格點擊唯一的做法。這裡改成選取的話，扣除模式就
    // 再也扣不掉一格。
    const { districts, a } = world();
    expect(resolveDistrictGesture(districts, a, 1, 1, 1, 1)).toEqual({ kind: 'paint' });
  });

  it('should paint on empty land', () => {
    const { districts, a } = world();
    expect(resolveDistrictGesture(districts, a, 9, 9, 9, 9)).toEqual({ kind: 'paint' });
  });

  it('should never select from a dragged rectangle', () => {
    // 拖出範圍就是在畫，即使起點落在別區身上。拖曳中途改成選取的話，玩家拖了一大
    // 塊什麼都不會發生。
    const { districts, a } = world();
    expect(resolveDistrictGesture(districts, a, 5, 5, 6, 6)).toEqual({ kind: 'paint' });
    expect(resolveDistrictGesture(districts, a, 6, 6, 5, 5), '反著拖被當成點擊了')
      .toEqual({ kind: 'paint' });
  });
});

describe('不存在的分區', () => {
  it('should do nothing rather than throw, in every mode', () => {
    // 三種模式都要試。`add` 那條路徑根本不碰 district 物件，只測它的話把守衛
    // 拿掉也不會有事。
    const { districts } = setup();
    for (const mode of ['add', 'replace', 'subtract'] as const) {
      expect(() => paintDistrictRect(districts, 'nope', 0, 0, 1, 1, mode),
        `${mode} 在分區不存在時炸了`).not.toThrow();
    }
    expect(districts.getDistrictAt(0, 0)).toBeNull();
  });
});
