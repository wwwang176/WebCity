import { describe, it, expect } from 'vitest';
import { AgentDistrict, type DistrictHost } from '../AgentDistrict';
import { DISTRICT_SWATCHES } from '../../core/district/DistrictPalette';

/**
 * 行政區。
 *
 * 格子怎麼畫不歸這裡管 —— 那是 `act({ tool: 'district', ... })` 走筆刷做的。
 * 這一層管的是**筆刷要畫在誰身上、用什麼模式**，以及分區本身的增刪改名換色。
 *
 * `DistrictManager` 的每一支寫入遇到不存在的 id 都是靜靜地 return（`merge` 例外，
 * 它丟例外）。所以這裡一律先驗 id。
 */

function fakeHost(over: Partial<DistrictHost> = {}) {
  const districts = [
    { id: 'd1', name: 'Downtown', cells: new Set(['1,1', '1,2']), colorIndex: 0 },
    { id: 'd2', name: 'Docks', cells: new Set(['9,9']), colorIndex: undefined as number | undefined },
  ];
  const calls: string[] = [];
  let active: string | null = null;
  let mode = 'add';
  let nextId = 3;

  const host: DistrictHost & { calls: string[]; districts: typeof districts } = {
    calls,
    districts,
    all: () => districts,
    create(name) {
      calls.push(`create ${name ?? '(auto)'}`);
      const id = `d${nextId++}`;
      districts.push({ id, name: name ?? `District ${nextId}`, cells: new Set(), colorIndex: 0 });
      active = id;
      return id;
    },
    remove(id) {
      calls.push(`remove ${id}`);
      const i = districts.findIndex(d => d.id === id);
      if (i >= 0) districts.splice(i, 1);
    },
    rename(id, name) {
      calls.push(`rename ${id}=${name}`);
      const d = districts.find(x => x.id === id);
      if (d) d.name = name;
    },
    setColor(id, colorIndex) {
      calls.push(`color ${id}=${colorIndex}`);
      const d = districts.find(x => x.id === id);
      if (d) d.colorIndex = colorIndex;
    },
    merge(a, b) {
      calls.push(`merge ${a}+${b}`);
      const da = districts.find(x => x.id === a)!;
      const db = districts.find(x => x.id === b)!;
      for (const c of db.cells) da.cells.add(c);
      districts.splice(districts.indexOf(db), 1);
      return a;
    },
    activeId: () => active,
    setActive(id) { calls.push(`active ${id}`); active = id; },
    paintMode: () => mode as never,
    setPaintMode(m) { calls.push(`mode ${m}`); mode = m; },
    ...over,
  };
  return { d: new AgentDistrict(host), host };
}

describe('看分區', () => {
  it('should list every district with the cells it owns', () => {
    expect(fakeHost().d.list()).toEqual([
      { id: 'd1', name: 'Downtown', cellCount: 2, colorIndex: 0, active: false },
      { id: 'd2', name: 'Docks', cellCount: 1, colorIndex: null, active: false },
    ]);
  });

  it('should mark which one the brush is aimed at', () => {
    const { d } = fakeHost();
    d.setActive('d2');

    expect(d.list().find(x => x.id === 'd2')!.active).toBe(true);
    expect(d.active()).toBe('d2');
  });

  it('should report the brush mode and the modes it accepts', () => {
    expect(fakeHost().d.brush()).toMatchObject({
      active: null, mode: 'add', modes: ['replace', 'add', 'subtract'],
    });
  });
});

describe('筆刷指向誰', () => {
  it('should aim the brush at a district', () => {
    const { d, host } = fakeHost();
    expect(d.setActive('d1')).toMatchObject({ ok: true, districtId: 'd1' });
    expect(host.activeId()).toBe('d1');
  });

  it('should let go of the brush', () => {
    // 放掉之後下一筆拖曳會開一個新的分區 —— 那是工具列 New 的意思。
    const { d, host } = fakeHost();
    d.setActive('d1');

    expect(d.setActive(null)).toMatchObject({ ok: true, districtId: null });
    expect(host.activeId()).toBeNull();
  });

  it('should refuse to aim at a district that does not exist', () => {
    const { d, host } = fakeHost();
    const r = d.setActive('nowhere');

    expect(r.ok).toBe(false);
    expect(r.reason).toContain('nowhere');
    expect(host.calls, '不存在的分區也照樣設下去').toEqual([]);
  });

  it('should switch the brush mode', () => {
    const { d, host } = fakeHost();
    expect(d.setBrushMode('subtract')).toMatchObject({ ok: true, mode: 'subtract' });
    expect(host.paintMode()).toBe('subtract');
  });

  it('should refuse a brush mode that does not exist', () => {
    const { d, host } = fakeHost();
    const r = d.setBrushMode('erase');

    expect(r.ok).toBe(false);
    expect(r.reason, '沒列出收得下的模式').toContain('subtract');
    expect(host.calls).toEqual([]);
  });
});

describe('增刪改', () => {
  it('should create a district and aim the brush at it', () => {
    const { d, host } = fakeHost();
    const r = d.create('Harbour');

    expect(r).toMatchObject({ ok: true, name: 'Harbour' });
    expect(host.activeId(), '開了新的分區卻沒有把筆刷指過去').toBe(r.districtId);
  });

  it('should let the game pick the name when none is given', () => {
    const { d, host } = fakeHost();
    expect(d.create().ok).toBe(true);
    expect(host.calls[0]).toBe('create (auto)');
  });

  it('should refuse a name that is already taken', () => {
    // 分區靠 id 分辨，但人是靠名字講話的。兩個 Downtown 會讓「把 Downtown 的
    // 壅塞費關掉」變成一句沒有答案的話。
    const { d, host } = fakeHost();
    const r = d.create('Downtown');

    expect(r.ok).toBe(false);
    expect(r.reason).toContain('Downtown');
    expect(host.calls).toEqual([]);
  });

  it('should refuse a blank name', () => {
    const { d, host } = fakeHost();
    expect(d.create('   ').ok).toBe(false);
    expect(host.calls).toEqual([]);
  });

  it('should rename a district', () => {
    const { d, host } = fakeHost();
    expect(d.rename('d2', 'Old Docks')).toMatchObject({ ok: true, name: 'Old Docks' });
    expect(host.districts.find(x => x.id === 'd2')!.name).toBe('Old Docks');
  });

  it('should refuse to rename onto a name another district already has', () => {
    const { d, host } = fakeHost();
    expect(d.rename('d2', 'Downtown').ok).toBe(false);
    expect(host.calls).toEqual([]);
  });

  it('should let a district keep its own name', () => {
    // 改色不改名的呼叫端會把原名一起送回來。那不該被當成撞名。
    expect(fakeHost().d.rename('d1', 'Downtown').ok).toBe(true);
  });

  it('should change the colour', () => {
    const { d, host } = fakeHost();
    expect(d.setColor('d2', 3)).toMatchObject({ ok: true, colorIndex: 3 });
    expect(host.districts.find(x => x.id === 'd2')!.colorIndex).toBe(3);
  });

  it('should refuse a colour that is not on the palette', () => {
    // 核心會把超出範圍的靜靜換成 undefined（＝退回預設色），那看起來就像沒反應。
    const { d, host } = fakeHost();
    const r = d.setColor('d1', DISTRICT_SWATCHES.length);

    expect(r.ok).toBe(false);
    expect(r.reason).toContain(String(DISTRICT_SWATCHES.length - 1));
    expect(host.calls).toEqual([]);
  });

  it('should delete a district', () => {
    const { d } = fakeHost();
    expect(d.delete('d2')).toMatchObject({ ok: true });
    expect(d.list().map(x => x.id)).toEqual(['d1']);
  });

  it('should let go of the brush when the district under it is deleted', () => {
    // 筆刷還指著一個不存在的分區的話，下一筆拖曳會拿到「Pick a district first」，
    // 而工具列看起來一切正常。
    const { d, host } = fakeHost();
    d.setActive('d2');
    d.delete('d2');

    expect(host.activeId(), '刪掉了卻還指著它').toBeNull();
  });

  it('should keep the brush where it is when a different district is deleted', () => {
    const { d, host } = fakeHost();
    d.setActive('d1');
    d.delete('d2');

    expect(host.activeId()).toBe('d1');
  });

  it('should merge two districts', () => {
    const { d } = fakeHost();
    const r = d.merge('d1', 'd2');

    expect(r).toMatchObject({ ok: true, districtId: 'd1' });
    expect(d.list().map(x => x.id)).toEqual(['d1']);
    expect(d.list()[0]!.cellCount, '被併進來的格子沒有跟過來').toBe(3);
  });

  it('should refuse to merge a district into itself', () => {
    const { d, host } = fakeHost();
    expect(d.merge('d1', 'd1').ok, '自己併自己').toBe(false);
    expect(host.calls).toEqual([]);
  });

  it('should refuse every operation on an id that does not exist', () => {
    const { d, host } = fakeHost();

    for (const r of [
      d.rename('nowhere', 'X'),
      d.setColor('nowhere', 1),
      d.delete('nowhere'),
      d.merge('d1', 'nowhere'),
      d.merge('nowhere', 'd1'),
    ]) {
      expect(r.ok).toBe(false);
      expect(r.reason).toContain('nowhere');
    }
    // `mergeDistricts` 對不存在的 id 是丟例外的 —— 沒擋住就不只是回錯值而已。
    expect(host.calls, '不存在的 id 也照樣送進遊戲').toEqual([]);
  });
});
