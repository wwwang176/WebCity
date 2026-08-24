import { describe, it, expect } from 'vitest';
import { AgentDistrict, type DistrictHost } from '../AgentDistrict';
import { DISTRICT_SWATCHES } from '../../core/district/DistrictPalette';

/**
 * Districts.
 *
 * How cells are painted is not this layer's concern; that is `act({ tool: 'district', ... })`
 * driving the brush. This layer handles **which district the brush paints and in which mode**,
 * plus creating, deleting, renaming and recolouring districts themselves.
 *
 * Every `DistrictManager` write returns silently on an unknown id, except `merge`, which
 * throws. So every id is validated first.
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
    // Once released, the next drag creates a new district, which is what the toolbar's New
    // means.
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
    // Districts are identified by id, but people talk about them by name. Two Downtowns make
    // "turn off Downtown's congestion charge" unanswerable.
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
    // A caller changing only the colour sends the existing name back, which is not a collision.
    expect(fakeHost().d.rename('d1', 'Downtown').ok).toBe(true);
  });

  it('should change the colour', () => {
    const { d, host } = fakeHost();
    expect(d.setColor('d2', 3)).toMatchObject({ ok: true, colorIndex: 3 });
    expect(host.districts.find(x => x.id === 'd2')!.colorIndex).toBe(3);
  });

  it('should refuse a colour that is not on the palette', () => {
    // The core silently turns an out-of-range index into undefined, reverting to the default
    // colour, which looks like no response at all.
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
    // A brush still pointing at a district that no longer exists makes the next drag answer
    // "Pick a district first" while the toolbar looks normal.
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
    // `mergeDistricts` throws on an unknown id, so letting one through is worse than a wrong
    // return value.
    expect(host.calls, '不存在的 id 也照樣送進遊戲').toEqual([]);
  });
});
