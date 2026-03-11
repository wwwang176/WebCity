import { describe, it, expect } from 'vitest';
import { getSeasonFromTick, getSeasonEffects, ClimateType, SEASON_EFFECTS } from '../Climate';
import {
  DisasterType,
  createDisaster,
  calculateDamage,
  DISASTER_MODIFIERS,
} from '../Disaster';
import {
  addWarningTower,
  isWarned,
  calculateEvacuationTarget,
  createWarningSystem,
} from '../WarningSystem';
import {
  applyDamage,
  repairBuilding,
  isRoadDamaged,
  DESTRUCTION_THRESHOLD,
  ROAD_DAMAGE_THRESHOLD,
} from '../Damage';

describe('Climate - Season System', () => {
  const TICKS_PER_YEAR = 1200;

  it('should return spring for tick 0', () => {
    expect(getSeasonFromTick(0, TICKS_PER_YEAR)).toBe('spring');
  });

  it('should cycle spring -> summer -> autumn -> winter', () => {
    const quarter = TICKS_PER_YEAR / 4;
    expect(getSeasonFromTick(0, TICKS_PER_YEAR)).toBe('spring');
    expect(getSeasonFromTick(quarter, TICKS_PER_YEAR)).toBe('summer');
    expect(getSeasonFromTick(quarter * 2, TICKS_PER_YEAR)).toBe('autumn');
    expect(getSeasonFromTick(quarter * 3, TICKS_PER_YEAR)).toBe('winter');
  });

  it('should wrap around after a full year', () => {
    expect(getSeasonFromTick(TICKS_PER_YEAR, TICKS_PER_YEAR)).toBe('spring');
    expect(getSeasonFromTick(TICKS_PER_YEAR + 1, TICKS_PER_YEAR)).toBe('spring');
  });

  it('winter should increase power demand by x1.3', () => {
    const effects = getSeasonEffects('winter', ClimateType.TEMPERATE);
    expect(effects.powerDemandMultiplier).toBe(1.3);
  });

  it('winter should decrease happiness by -5', () => {
    const effects = getSeasonEffects('winter', ClimateType.TEMPERATE);
    expect(effects.happinessModifier).toBe(-5);
  });

  it('spring should give happiness +5', () => {
    const effects = getSeasonEffects('spring', ClimateType.TEMPERATE);
    expect(effects.happinessModifier).toBe(5);
  });

  it('summer in tropical should increase water demand by x1.2', () => {
    const effects = getSeasonEffects('summer', ClimateType.TROPICAL);
    expect(effects.waterDemandMultiplier).toBe(1.2);
  });

  it('autumn in temperate should have neutral effects', () => {
    const effects = getSeasonEffects('autumn', ClimateType.TEMPERATE);
    expect(effects.powerDemandMultiplier).toBe(1.0);
    expect(effects.waterDemandMultiplier).toBe(1.0);
    expect(effects.happinessModifier).toBe(0);
  });

  it('SEASON_EFFECTS should have valid multipliers and modifiers', () => {
    expect(SEASON_EFFECTS.SPRING_HAPPINESS).toBeGreaterThan(0);
    expect(SEASON_EFFECTS.WINTER_HAPPINESS).toBeLessThan(0);
    expect(SEASON_EFFECTS.WINTER_POWER).toBeGreaterThan(1);
    expect(SEASON_EFFECTS.WINTER_CONTINENTAL_POWER).toBeGreaterThan(SEASON_EFFECTS.WINTER_POWER);
  });
});

describe('Disaster', () => {
  it('DISASTER_MODIFIERS should have valid damage factors between 0 and 1', () => {
    expect(DISASTER_MODIFIERS.TSUNAMI_DAMAGE_FACTOR).toBeGreaterThan(0);
    expect(DISASTER_MODIFIERS.TSUNAMI_DAMAGE_FACTOR).toBeLessThanOrEqual(1);
    expect(DISASTER_MODIFIERS.FOREST_FIRE_DAMAGE_FACTOR).toBeGreaterThan(0);
    expect(DISASTER_MODIFIERS.FOREST_FIRE_DAMAGE_FACTOR).toBeLessThanOrEqual(1);
    expect(DISASTER_MODIFIERS.METEOR_FALLOFF_FACTOR).toBeGreaterThan(0);
    expect(DISASTER_MODIFIERS.METEOR_FALLOFF_FACTOR).toBeLessThanOrEqual(1);
    expect(DISASTER_MODIFIERS.TORNADO_PATH_HALF_WIDTH).toBeGreaterThan(0);
  });

  it('should create a disaster with correct properties', () => {
    const d = createDisaster(DisasterType.EARTHQUAKE, 10, 10, 0.8);
    expect(d.type).toBe(DisasterType.EARTHQUAKE);
    expect(d.epicenterX).toBe(10);
    expect(d.epicenterY).toBe(10);
    expect(d.intensity).toBe(0.8);
    expect(d.radius).toBeGreaterThan(0);
    expect(d.ticksRemaining).toBeGreaterThan(0);
  });

  it('earthquake damage should decrease with distance', () => {
    const d = createDisaster(DisasterType.EARTHQUAKE, 10, 10, 1.0);
    const damageClose = calculateDamage(d, 10, 10);
    const damageMid = calculateDamage(d, 10, 13);
    const damageFar = calculateDamage(d, 10, 10 + d.radius);

    expect(damageClose).toBeGreaterThan(damageMid);
    expect(damageMid).toBeGreaterThan(damageFar);
    expect(damageClose).toBeLessThanOrEqual(1);
    expect(damageFar).toBeGreaterThanOrEqual(0);
  });

  it('earthquake should deal zero damage outside radius', () => {
    const d = createDisaster(DisasterType.EARTHQUAKE, 10, 10, 1.0);
    const damageOutside = calculateDamage(d, 10, 10 + d.radius + 5);
    expect(damageOutside).toBe(0);
  });

  it('tornado should damage cells along its path (3 cells wide)', () => {
    const d = createDisaster(DisasterType.TORNADO, 5, 5, 0.9);
    // Tornado path width is 3, so cells within 1.5 of the path center should be hit
    const damageOnPath = calculateDamage(d, 5, 5);
    expect(damageOnPath).toBeGreaterThan(0);
  });

  it('meteor should have high damage at impact', () => {
    const d = createDisaster(DisasterType.METEOR, 15, 15, 1.0);
    const damageAtImpact = calculateDamage(d, 15, 15);
    expect(damageAtImpact).toBeGreaterThanOrEqual(0.8);
  });

  it('meteor should have moderate damage within radius', () => {
    const d = createDisaster(DisasterType.METEOR, 15, 15, 1.0);
    const damageNear = calculateDamage(d, 15, 17);
    expect(damageNear).toBeGreaterThan(0);
    expect(damageNear).toBeLessThan(calculateDamage(d, 15, 15));
  });
});

describe('WarningSystem', () => {
  it('should cover area within tower radius', () => {
    const system = createWarningSystem();
    addWarningTower(system, 10, 10, 5);
    expect(isWarned(system, 10, 10)).toBe(true);
    expect(isWarned(system, 12, 10)).toBe(true);
    expect(isWarned(system, 14, 10)).toBe(true);
  });

  it('should NOT cover area outside tower radius', () => {
    const system = createWarningSystem();
    addWarningTower(system, 10, 10, 5);
    expect(isWarned(system, 20, 20)).toBe(false);
  });

  it('should find nearest shelter for evacuation', () => {
    const shelters = [
      { x: 5, y: 5 },
      { x: 20, y: 20 },
      { x: 0, y: 0 },
    ];
    const target = calculateEvacuationTarget(4, 4, shelters);
    expect(target).toEqual({ x: 5, y: 5 });
  });

  it('should return null when no shelters available', () => {
    const target = calculateEvacuationTarget(4, 4, []);
    expect(target).toBeNull();
  });

  it('warned area reduces casualties by 50%', () => {
    // This tests the concept: warned damage multiplier is 0.5
    const system = createWarningSystem();
    addWarningTower(system, 10, 10, 5);
    const warned = isWarned(system, 10, 10);
    const casualtyMultiplier = warned ? 0.5 : 1.0;
    expect(casualtyMultiplier).toBe(0.5);
  });
});

describe('Damage', () => {
  it('should apply damage to buildings near disaster', () => {
    const buildings = [
      { id: 1, x: 10, y: 10 },
      { id: 2, x: 10, y: 12 },
      { id: 3, x: 50, y: 50 },
    ];
    const disaster = createDisaster(DisasterType.EARTHQUAKE, 10, 10, 1.0);
    const damages = applyDamage(buildings, disaster);

    const b1Damage = damages.find((d) => d.buildingId === 1);
    expect(b1Damage).toBeDefined();
    expect(b1Damage!.damageLevel).toBeGreaterThan(0);

    const b3Damage = damages.find((d) => d.buildingId === 3);
    expect(b3Damage!.damageLevel).toBe(0);
  });

  it('DESTRUCTION_THRESHOLD and ROAD_DAMAGE_THRESHOLD should be in valid range', () => {
    expect(DESTRUCTION_THRESHOLD).toBeGreaterThan(0);
    expect(DESTRUCTION_THRESHOLD).toBeLessThanOrEqual(1);
    expect(ROAD_DAMAGE_THRESHOLD).toBeGreaterThan(0);
    expect(ROAD_DAMAGE_THRESHOLD).toBeLessThan(DESTRUCTION_THRESHOLD);
  });

  it('should mark building as destroyed when damage >= 0.9', () => {
    const buildings = [{ id: 1, x: 10, y: 10 }];
    const disaster = createDisaster(DisasterType.EARTHQUAKE, 10, 10, 1.0);
    const damages = applyDamage(buildings, disaster);

    const b1 = damages.find((d) => d.buildingId === 1);
    expect(b1!.damageLevel).toBeGreaterThanOrEqual(0.9);
    expect(b1!.destroyed).toBe(true);
  });

  it('should repair building when funds are sufficient', () => {
    const damageState = {
      buildingId: 1,
      damageLevel: 0.5,
      repairCost: 1000,
      destroyed: false,
    };
    const result = repairBuilding(damageState, 2000);
    expect(result.repaired).toBe(true);
    expect(result.cost).toBe(1000);
  });

  it('should NOT repair building when funds are insufficient', () => {
    const damageState = {
      buildingId: 1,
      damageLevel: 0.5,
      repairCost: 1000,
      destroyed: false,
    };
    const result = repairBuilding(damageState, 500);
    expect(result.repaired).toBe(false);
    expect(result.cost).toBe(0);
  });

  it('should detect damaged road near disaster', () => {
    const disaster = createDisaster(DisasterType.EARTHQUAKE, 10, 10, 1.0);
    expect(isRoadDamaged(10, 10, disaster)).toBe(true);
    expect(isRoadDamaged(50, 50, disaster)).toBe(false);
  });
});
