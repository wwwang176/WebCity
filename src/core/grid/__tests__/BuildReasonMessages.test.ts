import { describe, it, expect } from 'vitest';
import { BUILD_REASON_MESSAGES, getBuildReasonMessage } from '../BuildReasonMessages';

describe('BUILD_REASON_MESSAGES', () => {
  it('should map common build failure reasons to user-friendly messages', () => {
    expect(BUILD_REASON_MESSAGES.WATER_TILE).toBe('Cannot build on water');
    expect(BUILD_REASON_MESSAGES.MOUNTAIN_TILE).toBe('mountain in the way');
    expect(BUILD_REASON_MESSAGES.OUT_OF_BOUNDS).toBe('Out of bounds');
    expect(BUILD_REASON_MESSAGES.INSUFFICIENT_FUNDS).toBe('insufficient funds');
  });

  it('should include road and rail specific reasons', () => {
    expect(BUILD_REASON_MESSAGES.BUILDING_EXISTS).toBe('building in the way');
    expect(BUILD_REASON_MESSAGES.INFRASTRUCTURE_EXISTS).toBe('infrastructure in the way');
  });

  it('should include infrastructure placement reasons', () => {
    expect(BUILD_REASON_MESSAGES.TILE_OCCUPIED).toBe('Tile is occupied');
    expect(BUILD_REASON_MESSAGES.NO_GROUNDWATER).toBe('No groundwater here — build near rivers');
    expect(BUILD_REASON_MESSAGES.UNKNOWN_TYPE).toBe('Unknown building type');
    expect(BUILD_REASON_MESSAGES.NEED_RAIL_TRACK).toBe('Train station must be built on rail track');
    expect(BUILD_REASON_MESSAGES.AIRPORT_OUT_OF_BOUNDS).toBe('Airport area is out of bounds');
    expect(BUILD_REASON_MESSAGES.AIRPORT_AREA_OCCUPIED).toBe('Airport area is not fully clear');
  });
});

describe('getBuildReasonMessage', () => {
  it('should return mapped message for known reasons', () => {
    expect(getBuildReasonMessage('WATER_TILE')).toBe('Cannot build on water');
    expect(getBuildReasonMessage('INSUFFICIENT_FUNDS')).toBe('insufficient funds');
  });

  it('should return raw reason string for unknown reasons', () => {
    expect(getBuildReasonMessage('UNKNOWN_REASON')).toBe('UNKNOWN_REASON');
    expect(getBuildReasonMessage('PARALLEL_ROAD')).toBe('PARALLEL_ROAD');
  });
});
