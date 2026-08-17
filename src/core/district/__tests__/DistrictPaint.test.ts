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
    expect(resolveDistrictGesture(districts, a, 5, 5, 5, 5, 'add'))
      .toEqual({ kind: 'select', districtId: b });
  });

  it('should pick one up when nothing is selected yet', () => {
    // 手上什麼都沒有的時候，點地圖上任何一區就是把它撿起來 —— 不然玩家得先開一個
    // 新的分區才碰得到既有的。
    const { districts, b } = world();
    expect(resolveDistrictGesture(districts, null, 5, 5, 5, 5, 'add'))
      .toEqual({ kind: 'select', districtId: b });
  });

  it('should let go when you click the district you already have', () => {
    // 選取是可以按掉的:點起來、改一改、再點一次放掉。少了這一條，放掉選取只剩
    // 工具列上那顆按鈕。
    const { districts, a } = world();
    expect(resolveDistrictGesture(districts, a, 1, 1, 1, 1, 'add'))
      .toEqual({ kind: 'deselect' });
    expect(resolveDistrictGesture(districts, a, 1, 1, 1, 1, 'replace'),
      '取代模式下點自己反而把整區縮成一格了').toEqual({ kind: 'deselect' });
  });

  it('should erase instead of letting go while the eraser is up', () => {
    // 扣除模式下點自己這一區的格子，意思沒有歧義:擦掉那一格。改成放掉選取的話，
    // 單格擦除就沒有任何手勢做得到了。
    const { districts, a } = world();
    expect(resolveDistrictGesture(districts, a, 1, 1, 1, 1, 'subtract'))
      .toEqual({ kind: 'paint' });
  });

  it('should paint on empty land', () => {
    const { districts, a } = world();
    for (const mode of ['add', 'replace', 'subtract'] as const) {
      expect(resolveDistrictGesture(districts, a, 9, 9, 9, 9, mode), mode)
        .toEqual({ kind: 'paint' });
    }
  });

  it('should never select or deselect from a dragged rectangle', () => {
    // 拖出範圍就是在畫，即使起點落在別區或自己身上。拖曳中途改成選取的話，玩家
    // 拖了一大塊什麼都不會發生。
    const { districts, a } = world();
    expect(resolveDistrictGesture(districts, a, 5, 5, 6, 6, 'add')).toEqual({ kind: 'paint' });
    expect(resolveDistrictGesture(districts, a, 6, 6, 5, 5, 'add'), '反著拖被當成點擊了')
      .toEqual({ kind: 'paint' });
    expect(resolveDistrictGesture(districts, a, 0, 0, 1, 1, 'add'), '拖過自己被當成放掉選取')
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

describe('筆刷回報它動了什麼', () => {
  /**
   * 一格只屬於一個分區，所以「畫進來」天生就會從別區搶格子。搶是對的 —— 錯的是
   * 它不出聲:玩家拖一塊蓋到別區上，二十幾格轉手了，畫面上只有顏色悄悄變了。
   */
  it('should say how many cells it took, and from whom', () => {
    const { districts, a, b } = setup();
    paintDistrictRect(districts, b, 0, 0, 2, 0, 'add');
    const r = paintDistrictRect(districts, a, 0, 0, 1, 0, 'add');
    expect([...r.fromOthers], '沒回報從 B 搶了幾格').toEqual([[b, 2]]);
    expect(r.added, '新增格數不對').toBe(2);
  });

  it('should not count cells that were nobody-s as taken', () => {
    const { districts, a } = setup();
    const r = paintDistrictRect(districts, a, 0, 0, 1, 1, 'add');
    expect(r.fromOthers.size, '無主地被算成從別區搶來的').toBe(0);
    expect(r.added).toBe(4);
  });

  it('should not count cells it already owned as new', () => {
    // 同一塊畫兩次，第二次沒有任何改變。回報 4 格的話，通知會憑空冒出來。
    const { districts, a } = setup();
    paintDistrictRect(districts, a, 0, 0, 1, 1, 'add');
    const r = paintDistrictRect(districts, a, 0, 0, 1, 1, 'add');
    expect(r.added, '本來就是自己的格子被算成新增').toBe(0);
  });

  it('should report what subtract actually removed', () => {
    const { districts, a } = setup();
    paintDistrictRect(districts, a, 0, 0, 2, 0, 'add');
    const r = paintDistrictRect(districts, a, 1, 0, 1, 0, 'subtract');
    expect(r.removed).toBe(1);
  });

  it('should name the owner when subtract has nothing of its own to remove', () => {
    // 扣除只動自己這一區。掃到別區時什麼都不會發生 —— 靜默失敗是這支筆刷最難懂的
    // 一件事，呼叫端要有東西可以說出「那些是 B 的」。
    const { districts, a, b } = setup();
    paintDistrictRect(districts, b, 0, 0, 2, 0, 'add');
    const r = paintDistrictRect(districts, a, 0, 0, 2, 0, 'subtract');
    expect(r.removed).toBe(0);
    expect([...r.fromOthers], '沒說出那些格子是誰的').toEqual([[b, 3]]);
  });

  it('should report the cells replace took from others', () => {
    const { districts, a, b } = setup();
    paintDistrictRect(districts, b, 0, 0, 2, 0, 'add');
    const r = paintDistrictRect(districts, a, 1, 0, 3, 0, 'replace');
    expect([...r.fromOthers]).toEqual([[b, 2]]);
  });

  it('should report nothing at all for a district that is not there', () => {
    const { districts } = setup();
    const r = paintDistrictRect(districts, 'nope', 0, 0, 1, 1, 'add');
    expect(r).toEqual({ added: 0, removed: 0, fromOthers: new Map() });
  });
});
