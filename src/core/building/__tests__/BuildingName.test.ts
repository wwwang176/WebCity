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

/** 一個名字是照哪一個樣板填出來的。 */
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
    // 名字不存進存檔，是從座標算出來的 —— 算兩次不一樣的話，面板每次重畫都會改名。
    expect(buildingName(3, 4, ZoneType.OFFICE, CITY))
      .toBe(buildingName(3, 4, ZoneType.OFFICE, CITY));
  });

  it('should not name the same plot the same in every city', () => {
    const names = new Set([11, 22, 33, 44].map(seed =>
      buildingName(0, 0, ZoneType.RESIDENTIAL_LOW, seed)));
    expect(names.size).toBe(4);
  });

  it('should tell neighbouring plots apart', () => {
    // 座標是連號的。x 與 y 如果只是加起來，(3,4) 與 (4,3) 就會同名 —— 12×12 的
    // 街廓只剩 23 個名字，整條反對角線一模一樣。
    //
    // 門檻不是 144。工業的名字空間是 3×104 + 3×64 = 504 種，從裡面抽 144 次，
    // 生日碰撞本來就會讓不重複的落在 125 上下 —— 重複是允許的，成排同名不是。
    const names = new Set<string>();
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 12; y++) names.add(buildingName(x, y, ZoneType.INDUSTRIAL, CITY));
    }
    expect(names.size).toBeGreaterThan(100);
  });

  it.each(ZONES)('should name zone %i in its own style', (zone) => {
    // 工廠不該叫 Court，公寓不該叫 Foundry。
    const templates = BUILDING_NAME_TEMPLATES[zone]!;
    for (let x = 0; x < 20; x++) {
      const name = buildingName(x, 7, zone, CITY);
      expect(matchesSomeTemplate(name, templates), `${name} 不像 zone ${zone} 的名字`).toBe(true);
    }
  });

  it('should rename a building when it upgrades', () => {
    // 升級會換掉建築本體（`buildingId` 是另一款），所以名字也換 —— 那是一間更大的
    // 新店開在同一塊地上，不是同一間變大。
    const before = buildingName(6, 9, ZoneType.COMMERCIAL_LOW, CITY, 10);
    const after = buildingName(6, 9, ZoneType.COMMERCIAL_LOW, CITY, 11);
    expect(after).not.toBe(before);
  });

  it('should keep the name while the building stays the same', () => {
    // 沒升級就不能改名 —— 面板每次重畫都換一個店名的話沒有人受得了。
    expect(buildingName(6, 9, ZoneType.COMMERCIAL_LOW, CITY, 10))
      .toBe(buildingName(6, 9, ZoneType.COMMERCIAL_LOW, CITY, 10));
  });

  it('should still name each upgrade in the zone style', () => {
    // 換名字不是換風格。三級商業建築都還是商店名。
    const templates = BUILDING_NAME_TEMPLATES[ZoneType.COMMERCIAL_LOW]!;
    for (let id = 1; id < 40; id++) {
      const name = buildingName(2, 2, ZoneType.COMMERCIAL_LOW, CITY, id);
      expect(matchesSomeTemplate(name, templates), `${name}`).toBe(true);
    }
  });

  it('should give different zones different names on the same plot', () => {
    // 一塊地改建之後要換名字 —— 同一格上的工廠與公寓不是同一間。
    const names = new Set(ZONES.map(z => buildingName(5, 5, z, CITY)));
    expect(names.size).toBeGreaterThan(4);
  });

  it('should eventually use every template it has', () => {
    // 樣板放了卻永遠抽不到等於沒放。
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
    // 面板拿到什麼就問什麼。沒有分區的格子不該讓它爆掉。
    expect(buildingName(1, 1, ZoneType.NONE, CITY)).toMatch(/\S/);
  });

  it('should keep the word lists in plain ASCII', () => {
    // 遊戲介面一律英文。
    for (const noun of BUILDING_NOUNS) expect(noun, noun).toMatch(/^[A-Za-z'-]+$/);
    for (const list of Object.values(BUILDING_NAME_TEMPLATES)) {
      for (const t of list) expect(t, t).toMatch(/^[A-Za-z'&{} -]+$/);
    }
  });
});
