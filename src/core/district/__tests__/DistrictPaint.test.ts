import { describe, it, expect } from 'vitest';
import { DistrictManager } from '../DistrictManager';
import { paintDistrictRect, resolveDistrictGesture } from '../DistrictPaint';

/**
 * The district brush's three modes.
 *
 * A cell belongs to one district — `addCellToDistrict` moves it out of the old one — so painting
 * inherently takes cells from other districts. That is correct: what the player sees is an
 * overlap going to whichever district was painted last.
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
    // An overlap goes to whichever was painted last. A cell in two districts has its revenue
    // multiplier and its fees counted twice.
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
    // Replace replaces this district, not the whole map.
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
    // Editing A carves out A alone. Reaching into B would dismantle another district's boundary
    // with the player entirely unaware.
    const { districts, a, b } = setup();
    paintDistrictRect(districts, b, 0, 0, 2, 0, 'add');
    paintDistrictRect(districts, a, 0, 0, 2, 0, 'subtract');
    expect(cellsOf(districts, b), 'B 的格子被 A 的扣除挖掉了').toEqual(['0,0', '1,0', '2,0']);
  });

  it('should leave an empty district behind, not delete it', () => {
    // The district survives with no cells: its policy settings should not vanish because of one
    // erase.
    const { districts, a } = setup();
    paintDistrictRect(districts, a, 0, 0, 1, 1, 'add');
    paintDistrictRect(districts, a, 0, 0, 1, 1, 'subtract');
    expect(cellsOf(districts, a)).toEqual([]);
    expect(districts.getDistrict(a), '分區被整個刪掉了').toBeDefined();
  });
});

describe('矩形的兩個角', () => {
  /** A separate manager each time, so the second paint does not take the first's cells and mask
   *  what is being checked. */
  const cellsFor = (x1: number, y1: number, x2: number, y2: number) => {
    const dm = new DistrictManager();
    const d = dm.createDistrict('D');
    paintDistrictRect(dm, d.id, x1, y1, x2, y2, 'add');
    return [...d.cells].sort();
  };

  it('should not care which corner the drag started from', () => {
    const reversed = cellsFor(3, 3, 1, 1);
    // Confirms a forward drag paints anything at all: without it, two empty results are also
    // equal, and removing the normalisation happens to make the loop not run.
    expect(cellsFor(1, 1, 3, 3).length, '正著拖也沒畫出格子，這條測試等於空轉').toBe(9);
    expect(reversed, '反著拖畫出來的範圍不一樣').toEqual(cellsFor(1, 1, 3, 3));
  });
});

describe('點一下是選取，拖曳才是畫', () => {
  /** A holds 0,0-1,1 and B holds 5,5. A is active. */
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
    // With nothing in hand, clicking any district on the map picks it up; otherwise the player
    // has to create a new district before touching an existing one.
    const { districts, b } = world();
    expect(resolveDistrictGesture(districts, null, 5, 5, 5, 5, 'add'))
      .toEqual({ kind: 'select', districtId: b });
  });

  it('should let go when you click the district you already have', () => {
    // A selection can be pressed off: pick it up, adjust it, click again to put it down. Without
    // this, releasing a selection is only the toolbar button.
    const { districts, a } = world();
    expect(resolveDistrictGesture(districts, a, 1, 1, 1, 1, 'add'))
      .toEqual({ kind: 'deselect' });
    expect(resolveDistrictGesture(districts, a, 1, 1, 1, 1, 'replace'),
      '取代模式下點自己反而把整區縮成一格了').toEqual({ kind: 'deselect' });
  });

  it('should erase instead of letting go while the eraser is up', () => {
    // In subtract mode, clicking your own cell unambiguously means erasing it. Releasing the
    // selection instead would leave no gesture that erases a single cell.
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
    // A drag is painting, even starting on another district or on your own. Turning a drag into
    // a selection means a large drag does nothing at all.
    const { districts, a } = world();
    expect(resolveDistrictGesture(districts, a, 5, 5, 6, 6, 'add')).toEqual({ kind: 'paint' });
    expect(resolveDistrictGesture(districts, a, 6, 6, 5, 5, 'add'), '反著拖被當成點擊了')
      .toEqual({ kind: 'paint' });
    expect(resolveDistrictGesture(districts, a, 0, 0, 1, 1, 'add'), '拖過自己被當成放掉選取')
      .toEqual({ kind: 'paint' });
  });

  it('should treat a straight drag as a drag, not a click', () => {
    // A drag along one axis is still a drag. The cases above move both x and y, so writing
    // "x changed **and** y changed" instead of "or" would also pass — while drawing a one-cell
    // strip is a common action.
    const { districts, a, b } = world();
    expect(resolveDistrictGesture(districts, a, 5, 5, 8, 5, 'add'), '水平拖被當成點擊')
      .toEqual({ kind: 'paint' });
    expect(resolveDistrictGesture(districts, a, 5, 5, 5, 8, 'add'), '垂直拖被當成點擊')
      .toEqual({ kind: 'paint' });
    // A straight drag starting on your own district must not become a release either.
    expect(resolveDistrictGesture(districts, a, 0, 0, 3, 0, 'add')).toEqual({ kind: 'paint' });
    void b;
  });
});

describe('不存在的分區', () => {
  it('should do nothing rather than throw, in every mode', () => {
    // All three modes are exercised. The `add` path never touches the district object, so
    // testing only that would let the guard be removed with no consequence.
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
   * A cell belongs to one district, so painting inherently takes cells from other districts.
   * Taking is correct; doing it silently is not: a stroke over another district transfers two
   * dozen cells with nothing but a quiet colour change on screen.
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
    // The same area painted twice changes nothing the second time. Reporting 4 cells would
    // conjure a notification out of nothing.
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
    // Subtract touches your own district alone and does nothing over another. That silent no-op
    // is the hardest thing about this brush to understand, so the caller needs something with
    // which to say those cells belong to B.
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
