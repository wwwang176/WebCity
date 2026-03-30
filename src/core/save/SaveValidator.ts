import { TerrainType, ZoneType } from '../grid/types';
import { RoadType } from '../road/types';
import { RailType } from '../rail/types';
import { isInfrastructureBuilding } from '../building/InfraConfig';
import { BUILDING_TYPES } from '../building/types';
import { ABANDONED, BURNED, MULTI_CELL_OCCUPIED, ROTATION_RESERVED } from '../building/InfraPlacement';
import { LifeStage, EducationLevel, MAX_AGE } from '../citizen/types';
import { CURRENT_SAVE_VERSION } from './migrations';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export const IMPORT_LIMITS = {
  MAX_FILE_SIZE: 50 * 1024 * 1024,
  MAX_SAVE_NAME_LENGTH: 100,
  MAX_GRID_DIMENSION: 500,
  MAX_CITIZENS: 500_000,
} as const;

/* ------------------------------------------------------------------ */
/*  Derived constant sets (built from existing game constants)        */
/* ------------------------------------------------------------------ */

const VALID_TERRAIN_TYPES = new Set([
  TerrainType.PLAIN, TerrainType.WATER, TerrainType.MOUNTAIN, TerrainType.FOREST,
]);

const VALID_ZONE_TYPES = new Set([
  ZoneType.NONE, ZoneType.RESIDENTIAL_LOW, ZoneType.RESIDENTIAL_HIGH,
  ZoneType.COMMERCIAL_LOW, ZoneType.COMMERCIAL_HIGH,
  ZoneType.INDUSTRIAL, ZoneType.OFFICE,
]);

const VALID_ROAD_TYPES = new Set([
  RoadType.NONE, RoadType.RURAL, RoadType.TWO_LANE,
  RoadType.FOUR_LANE, RoadType.SIX_LANE, RoadType.HIGHWAY, RoadType.ONE_WAY,
]);

const VALID_RAIL_TYPES = new Set([RailType.NONE, RailType.STANDARD]);

const VALID_SPEEDS = new Set([0, 1, 3, 5, 10]);

const VALID_RESERVED = new Set([
  0, ABANDONED, BURNED, MULTI_CELL_OCCUPIED,
  ...Object.values(ROTATION_RESERVED),
]);

const VALID_LIFE_STAGES = new Set(Object.values(LifeStage));
const VALID_EDUCATION_LEVELS = new Set(Object.values(EducationLevel));

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function ok(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

function fail(error: string): ValidationResult {
  return { valid: false, errors: [error], warnings: [] };
}

function merge(...results: ValidationResult[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const r of results) {
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }
  return { valid: errors.length === 0, errors, warnings };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const VALID_ZONE_BUILDING_IDS = new Set(BUILDING_TYPES.map(b => b.id));

function isValidBuildingId(id: number): boolean {
  return id === 0 || VALID_ZONE_BUILDING_IDS.has(id) || isInfrastructureBuilding(id);
}

/* ------------------------------------------------------------------ */
/*  Security                                                          */
/* ------------------------------------------------------------------ */

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function checkPrototypePollution(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null) return false;
  if (Array.isArray(obj)) {
    return obj.some(item => checkPrototypePollution(item));
  }
  for (const key of Object.keys(obj)) {
    if (DANGEROUS_KEYS.has(key)) return true;
    if (checkPrototypePollution((obj as Record<string, unknown>)[key])) return true;
  }
  return false;
}

export function sanitizeSaveName(name: string): string {
  return name
    .replace(/[<>&"']/g, '')
    .slice(0, IMPORT_LIMITS.MAX_SAVE_NAME_LENGTH);
}

/* ------------------------------------------------------------------ */
/*  Validators                                                        */
/* ------------------------------------------------------------------ */

export function validateExportWrapper(raw: unknown): ValidationResult {
  if (!isObj(raw)) return fail('Export file must be a JSON object');
  if (raw.format !== 'webcity-save') return fail('Missing or invalid format field (expected "webcity-save")');
  if (typeof raw.exportVersion !== 'number') return fail('Missing exportVersion');
  if (!isObj(raw.slot)) return fail('Missing slot object');

  const slot = raw.slot;
  if (typeof slot.name !== 'string') return fail('Missing slot.name');
  if (typeof slot.data !== 'string') return fail('Missing or invalid slot.data (expected string)');

  return ok();
}

export function validateVersion(version: unknown): ValidationResult {
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return fail('version must be an integer');
  }
  if (version < 1) return fail('version must be >= 1');
  if (version > CURRENT_SAVE_VERSION) {
    return fail(`Save version ${version} is newer than current (${CURRENT_SAVE_VERSION}). Please update the game.`);
  }
  return ok();
}

export function validateGrid(grid: unknown): ValidationResult {
  if (!isObj(grid)) return fail('grid must be an object');
  const { width, height, cells } = grid as { width: unknown; height: unknown; cells: unknown };

  if (typeof width !== 'number' || !Number.isInteger(width) || width < 1) {
    return fail('grid.width must be a positive integer');
  }
  if (typeof height !== 'number' || !Number.isInteger(height) || height < 1) {
    return fail('grid.height must be a positive integer');
  }
  if (width > IMPORT_LIMITS.MAX_GRID_DIMENSION) {
    return fail(`grid.width ${width} exceeds max ${IMPORT_LIMITS.MAX_GRID_DIMENSION}`);
  }
  if (height > IMPORT_LIMITS.MAX_GRID_DIMENSION) {
    return fail(`grid.height ${height} exceeds max ${IMPORT_LIMITS.MAX_GRID_DIMENSION}`);
  }
  if (!Array.isArray(cells)) return fail('grid.cells must be an array');

  // Validate each cell entry
  for (let i = 0; i < cells.length; i++) {
    const entry = cells[i];
    if (!isObj(entry)) return fail(`grid.cells[${i}] must be an object`);
    const x = entry.x as number;
    const y = entry.y as number;
    if (typeof x !== 'number' || !Number.isInteger(x) || x < 0 || x >= (width as number)) {
      return fail(`grid.cells[${i}].x=${x} is out of bounds (0-${(width as number) - 1})`);
    }
    if (typeof y !== 'number' || !Number.isInteger(y) || y < 0 || y >= (height as number)) {
      return fail(`grid.cells[${i}].y=${y} is out of bounds (0-${(height as number) - 1})`);
    }
    if (!isObj(entry.data) && entry.data !== undefined) {
      return fail(`grid.cells[${i}].data must be an object`);
    }
    if (isObj(entry.data)) {
      const cellResult = validateCell(entry.data);
      if (!cellResult.valid) {
        return fail(`grid.cells[${i}] (${x},${y}): ${cellResult.errors[0]}`);
      }
    }
  }
  return ok();
}

export function validateCell(data: unknown): ValidationResult {
  if (!isObj(data)) return fail('cell data must be an object');

  const d = data as Record<string, unknown>;

  if ('terrainType' in d) {
    if (typeof d.terrainType !== 'number' || !VALID_TERRAIN_TYPES.has(d.terrainType as TerrainType)) {
      return fail(`invalid terrainType: ${d.terrainType}`);
    }
  }
  if ('zoneType' in d) {
    if (typeof d.zoneType !== 'number' || !VALID_ZONE_TYPES.has(d.zoneType as ZoneType)) {
      return fail(`invalid zoneType: ${d.zoneType}`);
    }
  }
  if ('roadType' in d) {
    if (typeof d.roadType !== 'number' || !VALID_ROAD_TYPES.has(d.roadType as RoadType)) {
      return fail(`invalid roadType: ${d.roadType}`);
    }
  }
  if ('railType' in d) {
    if (typeof d.railType !== 'number' || !VALID_RAIL_TYPES.has(d.railType as RailType)) {
      return fail(`invalid railType: ${d.railType}`);
    }
  }
  if ('roadFlags' in d) {
    if (typeof d.roadFlags !== 'number' || d.roadFlags < 0 || d.roadFlags > 15 || !Number.isInteger(d.roadFlags)) {
      return fail(`invalid roadFlags: ${d.roadFlags} (must be 0-15)`);
    }
  }
  if ('railFlags' in d) {
    if (typeof d.railFlags !== 'number' || d.railFlags < 0 || d.railFlags > 15 || !Number.isInteger(d.railFlags)) {
      return fail(`invalid railFlags: ${d.railFlags} (must be 0-15)`);
    }
  }
  if ('buildingId' in d) {
    if (typeof d.buildingId !== 'number' || !Number.isInteger(d.buildingId) || !isValidBuildingId(d.buildingId)) {
      return fail(`invalid buildingId: ${d.buildingId}`);
    }
  }
  if ('reserved' in d) {
    if (typeof d.reserved !== 'number' || !VALID_RESERVED.has(d.reserved)) {
      return fail(`invalid reserved: ${d.reserved}`);
    }
  }

  return ok();
}

export function validateClock(clock: unknown): ValidationResult {
  if (!isObj(clock)) return fail('clock must be an object');
  const c = clock as Record<string, unknown>;

  if (typeof c.tick !== 'number') return fail('clock.tick is required');
  if (!Number.isInteger(c.tick) || (c.tick as number) < 0) return fail('clock.tick must be a non-negative integer');
  if (typeof c.speed !== 'number' || !VALID_SPEEDS.has(c.speed as number)) {
    return fail(`invalid clock.speed: ${c.speed} (expected 0, 1, 3, 5, or 10)`);
  }
  if (typeof c.paused !== 'boolean') return fail('clock.paused must be a boolean');

  return ok();
}

export function validateBudget(budget: unknown): ValidationResult {
  if (!isObj(budget)) return fail('budget must be an object');
  const b = budget as Record<string, unknown>;

  const requiredFields = ['funds', 'income', 'expenses', 'loans', 'loanInterestRate'] as const;
  for (const field of requiredFields) {
    if (typeof b[field] !== 'number') return fail(`budget.${field} is required and must be a number`);
    if (!Number.isFinite(b[field] as number)) return fail(`budget.${field} must be finite (got ${b[field]})`);
  }
  return ok();
}

export function validateTaxRates(rates: unknown): ValidationResult {
  if (!isObj(rates)) return fail('taxRates must be an object');
  const r = rates as Record<string, unknown>;

  const requiredFields = ['residential', 'commercial', 'industrial', 'office'] as const;
  for (const field of requiredFields) {
    if (typeof r[field] !== 'number') return fail(`taxRates.${field} is required and must be a number`);
    if ((r[field] as number) < 0 || (r[field] as number) > 100) {
      return fail(`taxRates.${field} must be 0-100 (got ${r[field]})`);
    }
  }
  // business is optional (backward compat)
  if ('business' in r && r.business !== undefined) {
    if (typeof r.business !== 'number') return fail('taxRates.business must be a number');
    if ((r.business as number) < 0 || (r.business as number) > 100) {
      return fail(`taxRates.business must be 0-100 (got ${r.business})`);
    }
  }
  return ok();
}

export function validateCitizens(citizens: unknown): ValidationResult {
  if (citizens === undefined || citizens === null) return ok();
  if (!Array.isArray(citizens)) return fail('citizens must be an array');
  if (citizens.length > IMPORT_LIMITS.MAX_CITIZENS) {
    return fail(`citizens count ${citizens.length} exceeds max ${IMPORT_LIMITS.MAX_CITIZENS}`);
  }

  for (let i = 0; i < citizens.length; i++) {
    const c = citizens[i];
    if (!isObj(c)) return fail(`citizens[${i}] must be an object`);

    const ci = c as Record<string, unknown>;
    if (typeof ci.age !== 'number') return fail(`citizens[${i}].age must be a number`);
    if ((ci.age as number) < 0) return fail(`citizens[${i}].age must be >= 0`);
    if ((ci.age as number) > MAX_AGE) return fail(`citizens[${i}].age ${ci.age} exceeds MAX_AGE (${MAX_AGE})`);

    if (!VALID_LIFE_STAGES.has(ci.lifeStage as LifeStage)) {
      return fail(`citizens[${i}].lifeStage "${ci.lifeStage}" is invalid`);
    }
    if (!VALID_EDUCATION_LEVELS.has(ci.education as EducationLevel)) {
      return fail(`citizens[${i}].education "${ci.education}" is invalid`);
    }
  }
  return ok();
}

/* ------------------------------------------------------------------ */
/*  Top-level: validate a full export file                            */
/* ------------------------------------------------------------------ */

export function validateExportFile(raw: unknown): ValidationResult {
  // 1. Validate wrapper structure
  const wrapperResult = validateExportWrapper(raw);
  if (!wrapperResult.valid) return wrapperResult;

  const slot = (raw as Record<string, unknown>).slot as Record<string, unknown>;
  const dataStr = slot.data as string;

  // 2. Parse slot.data as JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(dataStr);
  } catch {
    return fail('slot.data contains invalid JSON');
  }

  // 3. Check prototype pollution
  if (checkPrototypePollution(parsed)) {
    return fail('Prototype pollution detected in save data');
  }

  if (!isObj(parsed)) return fail('slot.data must parse to a JSON object');
  const state = parsed as Record<string, unknown>;

  // 4. Validate each section
  const results: ValidationResult[] = [];
  results.push(validateVersion(state.version));
  results.push(validateGrid(state.grid));
  results.push(validateClock(state.clock));
  results.push(validateBudget(state.budget));
  results.push(validateTaxRates(state.taxRates));
  if (state.citizens !== undefined) {
    results.push(validateCitizens(state.citizens));
  }

  return merge(wrapperResult, ...results);
}
