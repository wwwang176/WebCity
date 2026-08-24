import { describe, it, expect } from 'vitest';
import { ZoneType } from '../../grid/types';
import {
  buildingName, BUILDING_NAME_TEMPLATES, BUILDING_NOUNS,
} from '../BuildingName';
import { FAMILY_NAMES } from '../../citizen/CitizenName';

const CITY = 90210;

const ZONES = [
  ZoneType.RESIDENTIAL_LOW, ZoneType.RESIDENTIAL_HIGH,
  ZoneType.COMMERCIAL_LOW, ZoneType.COMMERCIAL_HIGH,
  ZoneType.INDUSTRIAL, ZoneType.OFFICE,
] as const;

/** Whether a name was filled from one of the given templates. */
function matchesSomeTemplate(name: string, templates: readonly string[]): boolean {
  return templates.some(t => {
    const pattern = '^' + t
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace('\\{family\\}', `(?:${FAMILY_NAMES.join('|')})`)
      .replace('\\{noun\\}', `(?:${BUILDING_NOUNS.join('|')})`) + '$';
    return new RegExp(pattern).test(name);
  });
}

describe('buildingName', () => {
  it('should give the same building the same name every time', () => {
    // Names are derived from coordinates rather than stored. If two calls disagreed, every
    // panel repaint would rename the building.
    expect(buildingName(3, 4, ZoneType.OFFICE, CITY))
      .toBe(buildingName(3, 4, ZoneType.OFFICE, CITY));
  });

  it('should not name the same plot the same in every city', () => {
    const names = new Set([11, 22, 33, 44].map(seed =>
      buildingName(0, 0, ZoneType.RESIDENTIAL_LOW, seed)));
    expect(names.size).toBe(4);
  });

  it('should tell neighbouring plots apart', () => {
    // Coordinates run consecutively. Adding x and y gives (3,4) and (4,3) the same name, so a
    // 12x12 block yields 23 names and every anti-diagonal reads identically.
    //
    // The bar is not 144. The industrial name space is 3x104 + 3x64 = 504, and 144 draws from
    // it land around 125 distinct through birthday collisions alone. Duplicates are allowed;
    // rows of identical names are not.
    const names = new Set<string>();
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 12; y++) names.add(buildingName(x, y, ZoneType.INDUSTRIAL, CITY));
    }
    expect(names.size).toBeGreaterThan(100);
  });

  it.each(ZONES)('should name zone %i in its own style', (zone) => {
    // A factory is not called Court, and an apartment block is not called Foundry.
    const templates = BUILDING_NAME_TEMPLATES[zone]!;
    for (let x = 0; x < 20; x++) {
      const name = buildingName(x, 7, zone, CITY);
      expect(matchesSomeTemplate(name, templates), `${name} 不像 zone ${zone} 的名字`).toBe(true);
    }
  });

  it('should rename a building when it upgrades', () => {
    // An upgrade swaps the building itself (`buildingId` becomes another model), so the name
    // changes with it: a bigger new shop on the same plot, not the same shop grown larger.
    const before = buildingName(6, 9, ZoneType.COMMERCIAL_LOW, CITY, 10);
    const after = buildingName(6, 9, ZoneType.COMMERCIAL_LOW, CITY, 11);
    expect(after).not.toBe(before);
  });

  it('should keep the name while the building stays the same', () => {
    // Without an upgrade the name holds; a new shop name on every panel repaint is unusable.
    expect(buildingName(6, 9, ZoneType.COMMERCIAL_LOW, CITY, 10))
      .toBe(buildingName(6, 9, ZoneType.COMMERCIAL_LOW, CITY, 10));
  });

  it('should still name each upgrade in the zone style', () => {
    // A new name is not a new style: all three commercial levels still read as shop names.
    const templates = BUILDING_NAME_TEMPLATES[ZoneType.COMMERCIAL_LOW]!;
    for (let id = 1; id < 40; id++) {
      const name = buildingName(2, 2, ZoneType.COMMERCIAL_LOW, CITY, id);
      expect(matchesSomeTemplate(name, templates), `${name}`).toBe(true);
    }
  });

  it('should give different zones different names on the same plot', () => {
    // Rezoning a plot changes its name: a factory and an apartment block on one cell are not
    // the same place.
    const names = new Set(ZONES.map(z => buildingName(5, 5, z, CITY)));
    expect(names.size).toBeGreaterThan(4);
  });

  it('should eventually use every template it has', () => {
    // A template that can never be drawn is the same as no template at all.
    for (const zone of ZONES) {
      const used = new Set<string>();
      for (let x = 0; x < 400; x++) {
        for (const t of BUILDING_NAME_TEMPLATES[zone]!) {
          if (matchesSomeTemplate(buildingName(x, 3, zone, CITY), [t])) used.add(t);
        }
      }
      expect(used.size, `zone ${zone}`).toBe(BUILDING_NAME_TEMPLATES[zone]!.length);
    }
  });

  it('should still answer for an unzoned plot', () => {
    // The panel asks about whatever it is given; an unzoned cell must not break it.
    expect(buildingName(1, 1, ZoneType.NONE, CITY)).toMatch(/\S/);
  });

  it('should keep the word lists in plain ASCII', () => {
    // The game UI is English throughout.
    for (const noun of BUILDING_NOUNS) expect(noun, noun).toMatch(/^[A-Za-z'-]+$/);
    for (const list of Object.values(BUILDING_NAME_TEMPLATES)) {
      for (const t of list) expect(t, t).toMatch(/^[A-Za-z'&{} -]+$/);
    }
  });
});
