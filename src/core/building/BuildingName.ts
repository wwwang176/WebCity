import { ZoneType } from '../grid/types';
import { FAMILY_NAMES } from '../citizen/CitizenName';
import { hash32 } from '../utils/hash32';

/**
 * 建築的名字。
 *
 * 跟市民的名字一樣，是從**位置**與城市種子算出來的，不存進存檔:一座城市有上萬棟
 * 房子，每棟多背一個字串就是幾百 KB，而名字只是給玩家看的裝飾。舊存檔一載入就有
 * 名字，不必寫遷移。
 *
 * 名字跟著**用途**走。一塊地拆掉重蓋成別的分區，名字也會換 —— 同一格上的工廠與
 * 公寓不是同一間。等級升上去不換名字:那是同一間店變大，不是換了一間。
 *
 * 重複是允許的。一座城市裡有兩間 Rowan Market 很正常，玩家真正要分辨的是位置。
 */

/** 填進樣板的名詞。都市與自然各半，念起來像招牌。 */
export const BUILDING_NOUNS: readonly string[] = [
  'Alder', 'Amber', 'Anchor', 'Ashford', 'Aspen', 'Beacon', 'Birch', 'Bramble',
  'Bridgeway', 'Cedar', 'Clover', 'Copper', 'Crescent', 'Crown', 'Dockside', 'Elm',
  'Ember', 'Falcon', 'Fernway', 'Foxglove', 'Garnet', 'Granite', 'Harbour', 'Hazel',
  'Heron', 'Hollow', 'Ironway', 'Ivory', 'Juniper', 'Kestrel', 'Lantern', 'Laurel',
  'Linden', 'Maple', 'Marble', 'Meadow', 'Millstone', 'Northgate', 'Oak', 'Orchard',
  'Osprey', 'Pinewood', 'Quarry', 'Ravenswood', 'Redstone', 'Ridgeway', 'Rowan', 'Sable',
  'Saltmarsh', 'Silver', 'Slate', 'Sparrow', 'Spruce', 'Sterling', 'Stonebridge', 'Summit',
  'Thistle', 'Tinder', 'Vantage', 'Waverly', 'Westbrook', 'Wharfside', 'Willow', 'Wren',
];

/**
 * 每一種用途自己的取名法。`{family}` 抽姓氏表，`{noun}` 抽上面那張。
 *
 * 姓氏跟市民共用一張表，所以 Novak Works 的老闆可能真的住在城裡。
 */
export const BUILDING_NAME_TEMPLATES: Record<number, readonly string[]> = {
  [ZoneType.RESIDENTIAL_LOW]: [
    '{family} House', '{noun} Cottage', 'The {noun}s', '{noun} Lodge',
    '{family} Place', '{noun} Bungalow',
  ],
  [ZoneType.RESIDENTIAL_HIGH]: [
    '{noun} Court', '{noun} Towers', '{noun} Apartments', '{family} Residences',
    '{noun} Terrace', '{noun} Heights',
  ],
  [ZoneType.COMMERCIAL_LOW]: [
    '{family} and Sons', '{noun} Market', 'The {noun} Store', '{noun} Bakery',
    '{family} Grocers', '{noun} Corner Shop',
  ],
  [ZoneType.COMMERCIAL_HIGH]: [
    '{noun} Emporium', '{noun} Arcade', '{family} Department Store', '{noun} Galleria',
    '{family} Trading Co', '{noun} Exchange',
  ],
  [ZoneType.INDUSTRIAL]: [
    '{family} Works', '{noun} Foundry', '{family} Industries', '{noun} Mill',
    '{family} Fabrication', '{noun} Refinery',
  ],
  [ZoneType.OFFICE]: [
    '{family} Group', '{noun} Holdings', '{family} Partners', '{noun} Consulting',
    '{family} Capital', '{noun} Chambers',
  ],
};

/** 沒有分區的格子也要答得出東西 —— 面板拿到什麼就問什麼。 */
const FALLBACK_TEMPLATES: readonly string[] = ['{noun} Building', '{family} Property'];

/**
 * 座標揉成一個鍵。
 *
 * 不是 `x + y`:那樣 (3,4) 與 (4,3) 會同名，而整條反對角線都是同一個名字 ——
 * 而城市裡的建築正好是排成格線的。乘一個比地圖還寬的質數，每一格才各自獨立。
 */
function plotKey(x: number, y: number): number {
  return (Math.imul(x | 0, 0x2545f491) ^ (y | 0)) >>> 0;
}

/** 這一格上這種用途的建築叫什麼。 */
export function buildingName(
  x: number, y: number, zoneType: number, citySeed = 0,
): string {
  const templates = BUILDING_NAME_TEMPLATES[zoneType] ?? FALLBACK_TEMPLATES;
  const key = plotKey(x, y);

  // 三個欄位各一顆鹽。共用一顆的話樣板、姓、名詞會鎖在一起，一個樣板永遠只配
  // 一個詞 —— 城裡的 Foundry 就會全部叫 Granite Foundry。
  const template = templates[hash32(key, zoneType ^ 0x5f356495, citySeed) % templates.length]!;
  const family = FAMILY_NAMES[hash32(key, zoneType ^ 0x1b873593, citySeed) % FAMILY_NAMES.length]!;
  const noun = BUILDING_NOUNS[hash32(key, zoneType ^ 0xcc9e2d51, citySeed) % BUILDING_NOUNS.length]!;

  return template.replace('{family}', family).replace('{noun}', noun);
}
