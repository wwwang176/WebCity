import { describe, it, expect } from 'vitest';
import {
  citizenName, citizenGivenName, citizenFamilyName,
  GIVEN_NAMES, FAMILY_NAMES,
} from '../CitizenName';

/** Some city's seed. The tests have to hold with one present. */
const CITY = 90210;

describe('citizenName', () => {
  it('should give the same citizen the same name every time', () => {
    // Names are derived from the id rather than saved, and two different results would rename
    // the citizen on every repaint.
    for (const id of [0, 1, 7, 4213, 999999]) {
      expect(citizenName(id)).toBe(citizenName(id));
    }
  });

  it('should not name the first citizen of every city the same', () => {
    // Ids are a per-session sequence from 1. From the id alone, every new city's first citizen
    // has the same name — a replay of one list rather than random naming.
    const names = new Set([0, 1, 2].flatMap(
      id => [11, 22, 33, 44].map(seed => citizenName(id, seed)),
    ));
    expect(names.size).toBe(12);
  });

  it('should not make neighbouring seeds the same roster, one step over', () => {
    // Adding the seed to the id makes seed s+1's nth citizen equal seed s's (n+1)th: two cities
    // with the same list, offset by one. Map seeds are often tried one after another, so adjacent
    // seeds are exactly the two cities most likely to exist side by side.
    const shifted = Array.from({ length: 40 }, (_, id) =>
      citizenName(id, 1000 + 1) === citizenName(id + 1, 1000)).filter(Boolean);
    expect(shifted.length).toBeLessThan(3);
  });

  it('should still name the same citizen the same within one city', () => {
    // The city seed lives in the save and does not change within a session.
    expect(citizenName(5, 4242)).toBe(citizenName(5, 4242));
  });

  it('should default to a city with no seed', () => {
    // Older saves have no seed field and read back as 0, which must neither throw nor produce a
    // different name each time.
    expect(citizenName(5)).toBe(citizenName(5, 0));
  });

  it('should read as a family name and a given name', () => {
    const parts = citizenName(1234).split(' ');
    expect(parts).toHaveLength(2);
    expect(GIVEN_NAMES).toContain(parts[0]);
    expect(FAMILY_NAMES).toContain(parts[1]);
  });

  it('should not hand out names in table order', () => {
    // Consecutive ids with consecutive names read as a list rather than a city's people. Citizen
    // ids are a sequence (`nextId++`), so this happens directly to one building's residents.
    const inOrder = Array.from({ length: 8 }, (_, i) => GIVEN_NAMES[i]);
    const actual = Array.from({ length: 8 }, (_, i) => citizenGivenName(i, CITY));
    expect(actual).not.toEqual(inOrder);
  });

  it('should vary the family name among neighbours too', () => {
    // Varying the given name alone makes the whole city one family.
    const family = new Set(Array.from({ length: 20 }, (_, i) => citizenFamilyName(i, CITY)));
    expect(family.size).toBeGreaterThan(5);
  });

  it('should eventually use every name in both tables', () => {
    // A name in the table that is never drawn might as well not be there, usually because the
    // hash uses only the low bits.
    const given = new Set<string>();
    const family = new Set<string>();
    for (let id = 0; id < 20000; id++) {
      given.add(citizenGivenName(id, CITY));
      family.add(citizenFamilyName(id, CITY));
    }
    expect(given.size).toBe(GIVEN_NAMES.length);
    expect(family.size).toBe(FAMILY_NAMES.length);
  });

  it('should spread names over the whole table, not pile up on a few', () => {
    // Each name should be drawn about equally often; a large spread means a biased hash.
    const counts = new Map<string, number>();
    const n = 20000;
    for (let id = 0; id < n; id++) {
      const g = citizenGivenName(id, CITY);
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
    // One hash for both names locks them together: only lcm(108,104)=2808 pairings remain, and
    // three quarters of the 11,232 people the two tables can produce never appear.
    const seen = new Set<string>();
    for (let id = 0; id < 300000; id++) seen.add(citizenName(id, CITY));
    const possible = GIVEN_NAMES.length * FAMILY_NAMES.length;
    expect(seen.size, `只組得出 ${seen.size} 種，兩張表可以組出 ${possible} 種`)
      .toBeGreaterThan(possible * 0.9);
  });

  it('should give a small town mostly distinct names', () => {
    // Repeats are allowed, since the tables are finite, but half a town of two hundred should
    // not share a full name.
    const names = new Set(Array.from({ length: 200 }, (_, i) => citizenName(i, CITY)));
    expect(names.size).toBeGreaterThan(180);
  });

  it('should survive ids the table never planned for', () => {
    for (const id of [0, -1, 2 ** 31, Number.MAX_SAFE_INTEGER]) {
      const name = citizenName(id, CITY);
      expect(name, `id=${id}`).toMatch(/^\S+ \S+$/);
    }
  });

  it('should keep both tables in plain ASCII', () => {
    // The interface is entirely English, and a name is displayed joined to an id.
    for (const name of [...GIVEN_NAMES, ...FAMILY_NAMES]) {
      expect(name, name).toMatch(/^[A-Za-z'-]+$/);
    }
  });
});
