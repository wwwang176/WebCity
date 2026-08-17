import { describe, it, expect } from 'vitest';
import {
  citizenName, citizenGivenName, citizenFamilyName,
  GIVEN_NAMES, FAMILY_NAMES,
} from '../CitizenName';

describe('citizenName', () => {
  it('should give the same citizen the same name every time', () => {
    // 名字不存進存檔，是從 id 算出來的 —— 算兩次不一樣的話，面板每次重畫都會換人。
    for (const id of [0, 1, 7, 4213, 999999]) {
      expect(citizenName(id)).toBe(citizenName(id));
    }
  });

  it('should read as a family name and a given name', () => {
    const parts = citizenName(1234).split(' ');
    expect(parts).toHaveLength(2);
    expect(GIVEN_NAMES).toContain(parts[0]);
    expect(FAMILY_NAMES).toContain(parts[1]);
  });

  it('should not hand out names in table order', () => {
    // 連號的 id 拿到連號的名字，看起來就是一份名單而不是一城市的人。市民 id 是
    // 流水號（`nextId++`），所以這件事會直接發生在同一棟樓的住戶身上。
    const inOrder = Array.from({ length: 8 }, (_, i) => GIVEN_NAMES[i]);
    const actual = Array.from({ length: 8 }, (_, i) => citizenGivenName(i));
    expect(actual).not.toEqual(inOrder);
  });

  it('should vary the family name among neighbours too', () => {
    // 只換名不換姓的話，整座城市會變成同一個家族。
    const family = new Set(Array.from({ length: 20 }, (_, i) => citizenFamilyName(i)));
    expect(family.size).toBeGreaterThan(5);
  });

  it('should eventually use every name in both tables', () => {
    // 表裡放了卻永遠抽不到的名字等於沒放 —— 通常是雜湊只用了低位元。
    const given = new Set<string>();
    const family = new Set<string>();
    for (let id = 0; id < 20000; id++) {
      given.add(citizenGivenName(id));
      family.add(citizenFamilyName(id));
    }
    expect(given.size).toBe(GIVEN_NAMES.length);
    expect(family.size).toBe(FAMILY_NAMES.length);
  });

  it('should spread names over the whole table, not pile up on a few', () => {
    // 每個名字被抽到的次數要接近平均。差太多代表雜湊有偏。
    const counts = new Map<string, number>();
    const n = 20000;
    for (let id = 0; id < n; id++) {
      const g = citizenGivenName(id);
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const expected = n / GIVEN_NAMES.length;
    for (const [name, count] of counts) {
      expect(count, `${name} 被抽到 ${count} 次，平均是 ${expected}`)
        .toBeGreaterThan(expected * 0.5);
      expect(count, `${name} 被抽到 ${count} 次，平均是 ${expected}`)
        .toBeLessThan(expected * 1.5);
    }
  });

  it('should be able to reach every combination of the two tables', () => {
    // 姓與名如果由同一顆雜湊決定，兩者就鎖在一起:配對只剩 lcm(108,104)=2808 種，
    // 兩張表能組出的 11232 種人裡有四分之三永遠不會出現。
    const seen = new Set<string>();
    for (let id = 0; id < 300000; id++) seen.add(citizenName(id));
    const possible = GIVEN_NAMES.length * FAMILY_NAMES.length;
    expect(seen.size, `只組得出 ${seen.size} 種，兩張表可以組出 ${possible} 種`)
      .toBeGreaterThan(possible * 0.9);
  });

  it('should give a small town mostly distinct names', () => {
    // 重複是允許的（名字表有限），但一個兩百人的小鎮不該有一半同名同姓。
    const names = new Set(Array.from({ length: 200 }, (_, i) => citizenName(i)));
    expect(names.size).toBeGreaterThan(180);
  });

  it('should survive ids the table never planned for', () => {
    for (const id of [0, -1, 2 ** 31, Number.MAX_SAFE_INTEGER]) {
      const name = citizenName(id);
      expect(name, `id=${id}`).toMatch(/^\S+ \S+$/);
    }
  });

  it('should keep both tables in plain ASCII', () => {
    // 遊戲介面一律英文，而名字會跟 id 拼在一起顯示。
    for (const name of [...GIVEN_NAMES, ...FAMILY_NAMES]) {
      expect(name, name).toMatch(/^[A-Za-z'-]+$/);
    }
  });
});
