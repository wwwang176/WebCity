import { describe, it, expect } from 'vitest';
import {
  validateExportFile,
  validateExportWrapper,
  validateVersion,
  validateGrid,
  validateCell,
  validateClock,
  validateBudget,
  validateTaxRates,
  validateCitizens,
  checkPrototypePollution,
  sanitizeSaveName,
  IMPORT_LIMITS,
} from '../SaveValidator';
import { CURRENT_SAVE_VERSION } from '../migrations';
import { TerrainType, ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { RailType } from '../../rail/types';
import { LifeStage, EducationLevel, MAX_AGE } from '../../citizen/types';
import { serializeGameState } from '../Serializer';
import { createGameState } from '../../simulation/GameState';

/* ------------------------------------------------------------------ */
/*  Helper: build a valid ExportFile wrapper                          */
/* ------------------------------------------------------------------ */
function makeValidExport(dataOverrides?: Record<string, unknown>): unknown {
  const state = createGameState(10, 10);
  const data = serializeGameState(state);
  return {
    format: 'webcity-save',
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    slot: {
      name: 'Test City',
      date: new Date().toISOString(),
      data,
      population: 0,
      ...dataOverrides,
    },
  };
}

function makeValidSerializedState(overrides?: Record<string, unknown>): unknown {
  return {
    version: CURRENT_SAVE_VERSION,
    grid: { width: 10, height: 10, cells: [] },
    clock: { tick: 100, speed: 1, paused: false },
    budget: { funds: 50000, income: 0, expenses: 0, loans: 0, loanInterestRate: 0.05 },
    taxRates: { residential: 9, commercial: 9, industrial: 9, office: 9, business: 9 },
    ...overrides,
  };
}

/* ================================================================== */
/*  validateExportWrapper                                             */
/* ================================================================== */
describe('validateExportWrapper', () => {
  it('should accept a valid export wrapper', () => {
    const result = validateExportWrapper(makeValidExport());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject non-object input', () => {
    expect(validateExportWrapper('string').valid).toBe(false);
    expect(validateExportWrapper(42).valid).toBe(false);
    expect(validateExportWrapper(null).valid).toBe(false);
  });

  it('should reject missing format field', () => {
    const data = makeValidExport();
    delete (data as Record<string, unknown>).format;
    const result = validateExportWrapper(data);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('format');
  });

  it('should reject wrong format value', () => {
    const data = makeValidExport() as Record<string, unknown>;
    data.format = 'wrong-format';
    const result = validateExportWrapper(data);
    expect(result.valid).toBe(false);
  });

  it('should reject missing exportVersion', () => {
    const data = makeValidExport() as Record<string, unknown>;
    delete data.exportVersion;
    const result = validateExportWrapper(data);
    expect(result.valid).toBe(false);
  });

  it('should reject missing slot', () => {
    const data = makeValidExport() as Record<string, unknown>;
    delete data.slot;
    const result = validateExportWrapper(data);
    expect(result.valid).toBe(false);
  });

  it('should reject slot without name', () => {
    const data = makeValidExport() as Record<string, unknown>;
    delete (data.slot as Record<string, unknown>).name;
    const result = validateExportWrapper(data);
    expect(result.valid).toBe(false);
  });

  it('should reject slot without data', () => {
    const data = makeValidExport() as Record<string, unknown>;
    delete (data.slot as Record<string, unknown>).data;
    const result = validateExportWrapper(data);
    expect(result.valid).toBe(false);
  });

  it('should reject slot.data that is not a string', () => {
    const data = makeValidExport() as Record<string, unknown>;
    (data.slot as Record<string, unknown>).data = 123;
    const result = validateExportWrapper(data);
    expect(result.valid).toBe(false);
  });
});

/* ================================================================== */
/*  validateVersion                                                   */
/* ================================================================== */
describe('validateVersion', () => {
  it('should accept current save version', () => {
    expect(validateVersion(CURRENT_SAVE_VERSION).valid).toBe(true);
  });

  it('should accept old versions (1 through current)', () => {
    for (let v = 1; v <= CURRENT_SAVE_VERSION; v++) {
      expect(validateVersion(v).valid).toBe(true);
    }
  });

  it('should reject version 0', () => {
    expect(validateVersion(0).valid).toBe(false);
  });

  it('should reject versions newer than current', () => {
    expect(validateVersion(CURRENT_SAVE_VERSION + 1).valid).toBe(false);
  });

  it('should reject non-integer versions', () => {
    expect(validateVersion(1.5).valid).toBe(false);
  });

  it('should reject negative versions', () => {
    expect(validateVersion(-1).valid).toBe(false);
  });
});

/* ================================================================== */
/*  validateGrid                                                      */
/* ================================================================== */
describe('validateGrid', () => {
  it('should accept a valid empty grid', () => {
    const result = validateGrid({ width: 10, height: 10, cells: [] });
    expect(result.valid).toBe(true);
  });

  it('should accept a grid with valid cells', () => {
    const result = validateGrid({
      width: 10, height: 10,
      cells: [{ x: 0, y: 0, data: { terrainType: TerrainType.WATER } }],
    });
    expect(result.valid).toBe(true);
  });

  it('should reject grid exceeding MAX_GRID_DIMENSION', () => {
    const result = validateGrid({ width: IMPORT_LIMITS.MAX_GRID_DIMENSION + 1, height: 10, cells: [] });
    expect(result.valid).toBe(false);
  });

  it('should reject grid with zero dimensions', () => {
    expect(validateGrid({ width: 0, height: 10, cells: [] }).valid).toBe(false);
    expect(validateGrid({ width: 10, height: 0, cells: [] }).valid).toBe(false);
  });

  it('should reject grid with non-integer dimensions', () => {
    expect(validateGrid({ width: 10.5, height: 10, cells: [] }).valid).toBe(false);
  });

  it('should reject grid with missing cells array', () => {
    expect(validateGrid({ width: 10, height: 10 }).valid).toBe(false);
  });

  it('should reject cells with out-of-bounds coordinates', () => {
    const result = validateGrid({
      width: 10, height: 10,
      cells: [{ x: 10, y: 0, data: {} }], // x=10 is out of bounds for width=10
    });
    expect(result.valid).toBe(false);
  });

  it('should reject cells with negative coordinates', () => {
    const result = validateGrid({
      width: 10, height: 10,
      cells: [{ x: -1, y: 0, data: {} }],
    });
    expect(result.valid).toBe(false);
  });
});

/* ================================================================== */
/*  validateCell                                                      */
/* ================================================================== */
describe('validateCell', () => {
  it('should accept an empty cell (all defaults)', () => {
    expect(validateCell({}).valid).toBe(true);
  });

  it('should accept valid terrainType values', () => {
    expect(validateCell({ terrainType: TerrainType.PLAIN }).valid).toBe(true);
    expect(validateCell({ terrainType: TerrainType.WATER }).valid).toBe(true);
    expect(validateCell({ terrainType: TerrainType.MOUNTAIN }).valid).toBe(true);
    expect(validateCell({ terrainType: TerrainType.FOREST }).valid).toBe(true);
  });

  it('should reject invalid terrainType', () => {
    expect(validateCell({ terrainType: 99 }).valid).toBe(false);
    expect(validateCell({ terrainType: -1 }).valid).toBe(false);
  });

  it('should accept valid zoneType values', () => {
    expect(validateCell({ zoneType: ZoneType.NONE }).valid).toBe(true);
    expect(validateCell({ zoneType: ZoneType.RESIDENTIAL_LOW }).valid).toBe(true);
    expect(validateCell({ zoneType: ZoneType.OFFICE }).valid).toBe(true);
  });

  it('should reject invalid zoneType', () => {
    expect(validateCell({ zoneType: 7 }).valid).toBe(false);
    expect(validateCell({ zoneType: -1 }).valid).toBe(false);
  });

  it('should accept valid roadType values', () => {
    expect(validateCell({ roadType: RoadType.NONE }).valid).toBe(true);
    expect(validateCell({ roadType: RoadType.HIGHWAY }).valid).toBe(true);
    expect(validateCell({ roadType: RoadType.ONE_WAY }).valid).toBe(true);
  });

  it('should reject invalid roadType', () => {
    expect(validateCell({ roadType: 7 }).valid).toBe(false);
  });

  it('should accept valid railType values', () => {
    expect(validateCell({ railType: RailType.NONE }).valid).toBe(true);
    expect(validateCell({ railType: RailType.STANDARD }).valid).toBe(true);
  });

  it('should reject invalid railType', () => {
    expect(validateCell({ railType: 2 }).valid).toBe(false);
  });

  it('should accept valid roadFlags (0-15 bitmask)', () => {
    expect(validateCell({ roadFlags: 0 }).valid).toBe(true);
    expect(validateCell({ roadFlags: 15 }).valid).toBe(true);
    expect(validateCell({ roadFlags: 0b1010 }).valid).toBe(true);
  });

  it('should reject invalid roadFlags', () => {
    expect(validateCell({ roadFlags: 16 }).valid).toBe(false);
    expect(validateCell({ roadFlags: -1 }).valid).toBe(false);
  });

  it('should accept valid railFlags (0-15 bitmask)', () => {
    expect(validateCell({ railFlags: 0 }).valid).toBe(true);
    expect(validateCell({ railFlags: 15 }).valid).toBe(true);
  });

  it('should reject invalid railFlags', () => {
    expect(validateCell({ railFlags: 16 }).valid).toBe(false);
  });

  it('should accept buildingId 0 (empty)', () => {
    expect(validateCell({ buildingId: 0 }).valid).toBe(true);
  });

  it('should accept valid zone building IDs (1-21)', () => {
    expect(validateCell({ buildingId: 1 }).valid).toBe(true);
    expect(validateCell({ buildingId: 21 }).valid).toBe(true);
  });

  it('should accept valid infrastructure building IDs', () => {
    expect(validateCell({ buildingId: 252 }).valid).toBe(true); // police
    expect(validateCell({ buildingId: 248 }).valid).toBe(true); // park
    expect(validateCell({ buildingId: 235 }).valid).toBe(true); // airport_l
  });

  it('should reject invalid building IDs', () => {
    expect(validateCell({ buildingId: 100 }).valid).toBe(false); // gap between zone and infra
    expect(validateCell({ buildingId: 999 }).valid).toBe(false);
    expect(validateCell({ buildingId: -1 }).valid).toBe(false);
  });

  it('should accept valid reserved values', () => {
    expect(validateCell({ reserved: 0 }).valid).toBe(true);   // none
    expect(validateCell({ reserved: 1 }).valid).toBe(true);   // ABANDONED
    expect(validateCell({ reserved: 3 }).valid).toBe(true);   // BURNED
    expect(validateCell({ reserved: 4 }).valid).toBe(true);   // MULTI_CELL_OCCUPIED
    expect(validateCell({ reserved: 5 }).valid).toBe(true);   // rotation 90°
    expect(validateCell({ reserved: 6 }).valid).toBe(true);   // rotation 180°
    expect(validateCell({ reserved: 7 }).valid).toBe(true);   // rotation 270°
  });

  it('should reject invalid reserved values', () => {
    expect(validateCell({ reserved: 2 }).valid).toBe(false);
    expect(validateCell({ reserved: 8 }).valid).toBe(false);
    expect(validateCell({ reserved: -1 }).valid).toBe(false);
  });
});

/* ================================================================== */
/*  validateClock                                                     */
/* ================================================================== */
describe('validateClock', () => {
  it('should accept valid clock', () => {
    expect(validateClock({ tick: 100, speed: 1, paused: false }).valid).toBe(true);
  });

  it('should accept all valid GameSpeed values', () => {
    for (const speed of [0, 1, 3, 5, 10]) {
      expect(validateClock({ tick: 0, speed, paused: false }).valid).toBe(true);
    }
  });

  it('should reject invalid speed', () => {
    expect(validateClock({ tick: 0, speed: 2, paused: false }).valid).toBe(false);
    expect(validateClock({ tick: 0, speed: 7, paused: false }).valid).toBe(false);
  });

  it('should reject negative tick', () => {
    expect(validateClock({ tick: -1, speed: 1, paused: false }).valid).toBe(false);
  });

  it('should reject non-integer tick', () => {
    expect(validateClock({ tick: 1.5, speed: 1, paused: false }).valid).toBe(false);
  });

  it('should reject missing fields', () => {
    expect(validateClock({ tick: 0, speed: 1 }).valid).toBe(false);
    expect(validateClock({ tick: 0, paused: false }).valid).toBe(false);
    expect(validateClock({ speed: 1, paused: false }).valid).toBe(false);
  });

  it('should reject paused not being boolean', () => {
    expect(validateClock({ tick: 0, speed: 1, paused: 'yes' }).valid).toBe(false);
  });
});

/* ================================================================== */
/*  validateBudget                                                    */
/* ================================================================== */
describe('validateBudget', () => {
  it('should accept valid budget', () => {
    const result = validateBudget({ funds: 50000, income: 1000, expenses: 500, loans: 0, loanInterestRate: 0.05 });
    expect(result.valid).toBe(true);
  });

  it('should accept negative funds', () => {
    const result = validateBudget({ funds: -10000, income: 0, expenses: 0, loans: 0, loanInterestRate: 0.05 });
    expect(result.valid).toBe(true);
  });

  it('should reject NaN funds', () => {
    const result = validateBudget({ funds: NaN, income: 0, expenses: 0, loans: 0, loanInterestRate: 0.05 });
    expect(result.valid).toBe(false);
  });

  it('should reject Infinity funds', () => {
    const result = validateBudget({ funds: Infinity, income: 0, expenses: 0, loans: 0, loanInterestRate: 0.05 });
    expect(result.valid).toBe(false);
  });

  it('should reject missing fields', () => {
    expect(validateBudget({ funds: 50000, income: 0 }).valid).toBe(false);
  });
});

/* ================================================================== */
/*  validateTaxRates                                                  */
/* ================================================================== */
describe('validateTaxRates', () => {
  it('should accept valid tax rates', () => {
    const result = validateTaxRates({ residential: 9, commercial: 9, industrial: 9, office: 9 });
    expect(result.valid).toBe(true);
  });

  it('should accept tax rates with optional business field', () => {
    const result = validateTaxRates({ residential: 9, commercial: 9, industrial: 9, office: 9, business: 12 });
    expect(result.valid).toBe(true);
  });

  it('should accept zero tax rate', () => {
    const result = validateTaxRates({ residential: 0, commercial: 0, industrial: 0, office: 0 });
    expect(result.valid).toBe(true);
  });

  it('should reject negative tax rates', () => {
    const result = validateTaxRates({ residential: -1, commercial: 9, industrial: 9, office: 9 });
    expect(result.valid).toBe(false);
  });

  it('should reject tax rates above 100', () => {
    const result = validateTaxRates({ residential: 101, commercial: 9, industrial: 9, office: 9 });
    expect(result.valid).toBe(false);
  });

  it('should reject non-numeric tax rates', () => {
    const result = validateTaxRates({ residential: 'high', commercial: 9, industrial: 9, office: 9 });
    expect(result.valid).toBe(false);
  });

  it('should reject missing required fields', () => {
    expect(validateTaxRates({ residential: 9, commercial: 9 }).valid).toBe(false);
  });
});

/* ================================================================== */
/*  validateCitizens                                                  */
/* ================================================================== */
describe('validateCitizens', () => {
  it('should accept empty citizens array', () => {
    expect(validateCitizens([]).valid).toBe(true);
  });

  it('should accept undefined citizens (optional field)', () => {
    expect(validateCitizens(undefined).valid).toBe(true);
  });

  it('should accept valid citizen', () => {
    const result = validateCitizens([{
      id: 1,
      birthTick: 0,
      age: 100,
      lifeStage: LifeStage.ADULT,
      education: EducationLevel.NONE,
      happiness: 50,
      health: 50,
      homeId: '5,5',
      workplaceId: null,
      unemployedSince: null,
      homelessSince: null,
      emigrationTolerance: 25,
      educationProgress: 0,
    }]);
    expect(result.valid).toBe(true);
  });

  it('should reject citizen with age exceeding MAX_AGE', () => {
    const result = validateCitizens([{
      id: 1, birthTick: 0, age: MAX_AGE + 1,
      lifeStage: LifeStage.SENIOR, education: EducationLevel.NONE,
      happiness: 50, health: 50, homeId: null, workplaceId: null,
      unemployedSince: null, homelessSince: null,
      emigrationTolerance: 25, educationProgress: 0,
    }]);
    expect(result.valid).toBe(false);
  });

  it('should reject citizen with negative age', () => {
    const result = validateCitizens([{
      id: 1, birthTick: 0, age: -1,
      lifeStage: LifeStage.BABY, education: EducationLevel.NONE,
      happiness: 50, health: 50, homeId: null, workplaceId: null,
      unemployedSince: null, homelessSince: null,
      emigrationTolerance: 25, educationProgress: 0,
    }]);
    expect(result.valid).toBe(false);
  });

  it('should reject citizen with invalid lifeStage', () => {
    const result = validateCitizens([{
      id: 1, birthTick: 0, age: 100,
      lifeStage: 'ELDER' as LifeStage, education: EducationLevel.NONE,
      happiness: 50, health: 50, homeId: null, workplaceId: null,
      unemployedSince: null, homelessSince: null,
      emigrationTolerance: 25, educationProgress: 0,
    }]);
    expect(result.valid).toBe(false);
  });

  it('should reject citizen with invalid education', () => {
    const result = validateCitizens([{
      id: 1, birthTick: 0, age: 100,
      lifeStage: LifeStage.ADULT, education: 'PHD' as EducationLevel,
      happiness: 50, health: 50, homeId: null, workplaceId: null,
      unemployedSince: null, homelessSince: null,
      emigrationTolerance: 25, educationProgress: 0,
    }]);
    expect(result.valid).toBe(false);
  });

  it('should reject citizens array exceeding MAX_CITIZENS', () => {
    // We won't actually create 500k objects, just test the length check
    const bigArray = { length: IMPORT_LIMITS.MAX_CITIZENS + 1 };
    const result = validateCitizens(bigArray as unknown as unknown[]);
    expect(result.valid).toBe(false);
  });
});

/* ================================================================== */
/*  checkPrototypePollution                                           */
/* ================================================================== */
describe('checkPrototypePollution', () => {
  it('should return false for clean objects', () => {
    expect(checkPrototypePollution({ a: 1, b: { c: 2 } })).toBe(false);
  });

  it('should detect __proto__ key', () => {
    const obj = JSON.parse('{"__proto__": {"isAdmin": true}}');
    expect(checkPrototypePollution(obj)).toBe(true);
  });

  it('should detect constructor key', () => {
    const obj = JSON.parse('{"constructor": {"prototype": {"isAdmin": true}}}');
    expect(checkPrototypePollution(obj)).toBe(true);
  });

  it('should detect nested prototype pollution', () => {
    const obj = JSON.parse('{"a": {"b": {"__proto__": {"x": 1}}}}');
    expect(checkPrototypePollution(obj)).toBe(true);
  });

  it('should return false for arrays', () => {
    expect(checkPrototypePollution([1, 2, 3])).toBe(false);
  });

  it('should return false for primitives', () => {
    expect(checkPrototypePollution(null)).toBe(false);
    expect(checkPrototypePollution(42)).toBe(false);
    expect(checkPrototypePollution('hello')).toBe(false);
  });
});

/* ================================================================== */
/*  sanitizeSaveName                                                  */
/* ================================================================== */
describe('sanitizeSaveName', () => {
  it('should pass through normal names', () => {
    expect(sanitizeSaveName('My City')).toBe('My City');
  });

  it('should strip HTML tags', () => {
    expect(sanitizeSaveName('<script>alert(1)</script>')).not.toContain('<script>');
  });

  it('should escape angle brackets', () => {
    const result = sanitizeSaveName('a<b>c');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
  });

  it('should truncate long names', () => {
    const longName = 'A'.repeat(200);
    expect(sanitizeSaveName(longName).length).toBeLessThanOrEqual(IMPORT_LIMITS.MAX_SAVE_NAME_LENGTH);
  });

  it('should handle empty string', () => {
    expect(sanitizeSaveName('')).toBe('');
  });
});

/* ================================================================== */
/*  validateExportFile (integration)                                  */
/* ================================================================== */
describe('validateExportFile', () => {
  it('should accept a valid export file from serializeGameState', () => {
    const result = validateExportFile(makeValidExport());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject invalid JSON in slot.data', () => {
    const data = makeValidExport({ data: 'not valid json {{{' });
    const result = validateExportFile(data);
    expect(result.valid).toBe(false);
  });

  it('should reject slot.data with invalid grid', () => {
    const serialized = JSON.stringify(makeValidSerializedState({
      grid: { width: -1, height: 10, cells: [] },
    }));
    const data = makeValidExport({ data: serialized });
    const result = validateExportFile(data);
    expect(result.valid).toBe(false);
  });

  it('should reject slot.data with invalid clock speed', () => {
    const serialized = JSON.stringify(makeValidSerializedState({
      clock: { tick: 0, speed: 99, paused: false },
    }));
    const data = makeValidExport({ data: serialized });
    const result = validateExportFile(data);
    expect(result.valid).toBe(false);
  });

  it('should reject prototype pollution in parsed data', () => {
    const polluted = '{"version":3,"__proto__":{"isAdmin":true},"grid":{"width":10,"height":10,"cells":[]},"clock":{"tick":0,"speed":1,"paused":false},"budget":{"funds":50000,"income":0,"expenses":0,"loans":0,"loanInterestRate":0.05},"taxRates":{"residential":9,"commercial":9,"industrial":9,"office":9}}';
    const data = makeValidExport({ data: polluted });
    const result = validateExportFile(data);
    expect(result.valid).toBe(false);
  });

  it('should reject save version newer than current', () => {
    const serialized = JSON.stringify(makeValidSerializedState({
      version: CURRENT_SAVE_VERSION + 1,
    }));
    const data = makeValidExport({ data: serialized });
    const result = validateExportFile(data);
    expect(result.valid).toBe(false);
  });

  it('should accept old save versions (will be migrated)', () => {
    const serialized = JSON.stringify(makeValidSerializedState({ version: 1 }));
    const data = makeValidExport({ data: serialized });
    const result = validateExportFile(data);
    expect(result.valid).toBe(true);
  });
});
