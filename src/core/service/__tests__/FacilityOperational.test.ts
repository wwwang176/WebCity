import { describe, it, expect } from 'vitest';
import { isFacilityOperational, isPowerExempt, isWaterExempt } from '../FacilityOperational';
import type { InfraType } from '../../building/InfraConfig';

const YES = () => true;
const NO = () => false;

describe('FacilityOperational', () => {
  describe('isFacilityOperational', () => {
    // ── Power-exempt: power plants don't need power ──
    it('power plant is operational without power (has water)', () => {
      expect(isFacilityOperational(0, 0, 'power', NO, YES)).toBe(true);
    });

    it('power plant is NOT operational without water', () => {
      expect(isFacilityOperational(0, 0, 'power', NO, NO)).toBe(false);
    });

    it('power plant is operational with both', () => {
      expect(isFacilityOperational(0, 0, 'power', YES, YES)).toBe(true);
    });

    // ── Water-exempt: water plants don't need water ──
    it('water plant is operational without water (has power)', () => {
      expect(isFacilityOperational(0, 0, 'water', YES, NO)).toBe(true);
    });

    it('water plant is NOT operational without power', () => {
      expect(isFacilityOperational(0, 0, 'water', NO, NO)).toBe(false);
    });

    it('water plant is operational with both', () => {
      expect(isFacilityOperational(0, 0, 'water', YES, YES)).toBe(true);
    });

    // ── Water-exempt: sewage plants don't need water ──
    it('sewage plant is operational without water (has power)', () => {
      expect(isFacilityOperational(0, 0, 'sewage', YES, NO)).toBe(true);
    });

    it('sewage plant is NOT operational without power', () => {
      expect(isFacilityOperational(0, 0, 'sewage', NO, NO)).toBe(false);
    });

    it('sewage plant is NOT operational without power even with water', () => {
      expect(isFacilityOperational(0, 0, 'sewage', NO, YES)).toBe(false);
    });

    // ── Non-exempt services: need both power AND water ──
    const nonExemptTypes: InfraType[] = [
      'police', 'fire', 'hospital', 'school', 'school_high', 'school_univ',
      'garbage', 'cemetery', 'park',
    ];

    for (const type of nonExemptTypes) {
      it(`${type} is operational with both power and water`, () => {
        expect(isFacilityOperational(0, 0, type, YES, YES)).toBe(true);
      });

      it(`${type} is NOT operational without power`, () => {
        expect(isFacilityOperational(0, 0, type, NO, YES)).toBe(false);
      });

      it(`${type} is NOT operational without water`, () => {
        expect(isFacilityOperational(0, 0, type, YES, NO)).toBe(false);
      });

      it(`${type} is NOT operational without both`, () => {
        expect(isFacilityOperational(0, 0, type, NO, NO)).toBe(false);
      });
    }

    // ── Position-aware: delegates to checker at correct coords ──
    it('passes correct coordinates to utility checkers', () => {
      const isPowered = (x: number, y: number) => x === 5 && y === 10;
      const isWatered = (x: number, y: number) => x === 5 && y === 10;
      expect(isFacilityOperational(5, 10, 'police', isPowered, isWatered)).toBe(true);
      expect(isFacilityOperational(0, 0, 'police', isPowered, isWatered)).toBe(false);
    });
  });

  describe('isPowerExempt', () => {
    it('power is exempt', () => expect(isPowerExempt('power')).toBe(true));
    it('police is not exempt', () => expect(isPowerExempt('police')).toBe(false));
    it('water is not exempt', () => expect(isPowerExempt('water')).toBe(false));
  });

  describe('isWaterExempt', () => {
    it('water is exempt', () => expect(isWaterExempt('water')).toBe(true));
    it('sewage is exempt', () => expect(isWaterExempt('sewage')).toBe(true));
    it('police is not exempt', () => expect(isWaterExempt('police')).toBe(false));
    it('power is not exempt', () => expect(isWaterExempt('power')).toBe(false));
  });
});
