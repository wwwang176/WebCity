import { ZoneType } from '../grid/types';
import { FAMILY_NAMES } from '../citizen/CitizenName';
import { hash32 } from '../utils/hash32';

/**
 * Building names.
 *
 * Like citizen names, derived from **position** and the city seed rather than stored in the
 * save: a city holds tens of thousands of buildings, and one extra string each is hundreds of
 * KB for what is decoration. Old saves get names the moment they load, with no migration.
 *
 * A name belongs to **that building**: it changes with the zone, and it changes on upgrade,
 * because an upgrade tears the building down and replaces it with another model — a bigger
 * new shop on the same plot.
 *
 * Duplicates are allowed. Two Rowan Markets in one city is normal; what the player tells
 * apart is the location.
 */

/** Nouns filled into the templates. Half urban, half natural, all reading like signage. */
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
 * A naming scheme per land use. `{family}` draws from the surname table, `{noun}` from the
 * list above.
 *
 * Surnames come from the same table as citizens', so the owner of Novak Works may well live
 * in the city.
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

/** Unzoned cells still need an answer; the panel asks about whatever it is given. */
const FALLBACK_TEMPLATES: readonly string[] = ['{noun} Building', '{family} Property'];

/**
 * Folds coordinates into one key.
 *
 * Not `x + y`: that gives (3,4) and (4,3) the same name and one name to every cell along an
 * anti-diagonal, and city buildings sit on exactly such a grid. Multiplying by a prime wider
 * than the map keeps every cell independent.
 */
function plotKey(x: number, y: number): number {
  return (Math.imul(x | 0, 0x2545f491) ^ (y | 0)) >>> 0;
}

/**
 * The name of this building on this cell.
 *
 * `buildingId` is the building model (an id from `BUILDING_TYPES`). An upgrade swaps the
 * model, so the name follows. Omitted — empty land, an unbuilt preview — the zone alone
 * decides.
 */
export function buildingName(
  x: number, y: number, zoneType: number, citySeed = 0, buildingId = 0,
): string {
  const templates = BUILDING_NAME_TEMPLATES[zoneType] ?? FALLBACK_TEMPLATES;
  const key = plotKey(x, y);
  // Zone and model together identify which building this is. XOR is enough: `hash32`'s
  // finalizer spreads a one-bit difference across the whole hash, so consecutive model ids do
  // not produce similar names.
  //
  // Different (zone, model) pairs can collide on the same variant, which is harmless: the
  // template is chosen separately by zone, and two colliding buildings stand on land of
  // different uses.
  //
  // The zone term only matters while nothing is built (buildingId = 0); with a building, the
  // model already determines the zone. **No test guards that half**: dropping zoneType leaves
  // every test green, because the template list is picked by zone regardless and names stay
  // distinct. It is kept so empty land's default name follows its zone.
  const variant = zoneType ^ buildingId;

  // One salt per field. Sharing a salt locks template, surname and noun together, so each
  // template pairs with exactly one word and every Foundry in the city becomes Granite
  // Foundry.
  const template = templates[hash32(key, variant ^ 0x5f356495, citySeed) % templates.length]!;
  const family = FAMILY_NAMES[hash32(key, variant ^ 0x1b873593, citySeed) % FAMILY_NAMES.length]!;
  const noun = BUILDING_NOUNS[hash32(key, variant ^ 0xcc9e2d51, citySeed) % BUILDING_NOUNS.length]!;

  return template.replace('{family}', family).replace('{noun}', noun);
}
