import { describe, it, expect } from 'vitest';
import { BUILD_REASON_MESSAGES, getBuildReasonMessage } from '../BuildReasonMessages';

describe('BUILD_REASON_MESSAGES', () => {
  it('should map common build failure reasons to user-friendly messages', () => {
    expect(BUILD_REASON_MESSAGES.WATER_TILE).toBe('Cannot build on water');
    expect(BUILD_REASON_MESSAGES.MOUNTAIN_TILE).toBe('Mountain in the way');
    expect(BUILD_REASON_MESSAGES.OUT_OF_BOUNDS).toBe('Out of bounds');
    expect(BUILD_REASON_MESSAGES.INSUFFICIENT_FUNDS).toBe('Insufficient funds');
  });

  it('should include road and rail specific reasons', () => {
    expect(BUILD_REASON_MESSAGES.BUILDING_EXISTS).toBe('Building in the way');
    expect(BUILD_REASON_MESSAGES.INFRASTRUCTURE_EXISTS).toBe('Infrastructure in the way');
    expect(BUILD_REASON_MESSAGES.PARALLEL_RAIL).toBe('Cannot run parallel to rail');
    expect(BUILD_REASON_MESSAGES.PARALLEL_ROAD).toBe('Cannot run parallel to road');
  });

  it('should include infrastructure placement reasons', () => {
    expect(BUILD_REASON_MESSAGES.TILE_OCCUPIED).toBe('Tile is occupied');
    expect(BUILD_REASON_MESSAGES.NO_GROUNDWATER).toBe('No groundwater here — build near rivers');
    expect(BUILD_REASON_MESSAGES.UNKNOWN_TYPE).toBe('Unknown building type');
    expect(BUILD_REASON_MESSAGES.NEED_RAIL_TRACK).toBe('Train station must be built on rail track');
    expect(BUILD_REASON_MESSAGES.AIRPORT_OUT_OF_BOUNDS).toBe('Airport area is out of bounds');
    expect(BUILD_REASON_MESSAGES.AIRPORT_AREA_OCCUPIED).toBe('Airport area is not fully clear');
  });

  it('should include elevated / ramp reasons', () => {
    expect(BUILD_REASON_MESSAGES.START_NOT_ON_ROAD).toBe('Must start on an existing road');
    expect(BUILD_REASON_MESSAGES.PATH_TOO_SHORT).toBe('Not enough space for ramp');
    expect(BUILD_REASON_MESSAGES.LEVEL_OCCUPIED).toBe('Elevation level already occupied');
    expect(BUILD_REASON_MESSAGES.RAMP_OCCUPIED).toBe('Cannot build over existing ramp');
    expect(BUILD_REASON_MESSAGES.RAMP_ON_WATER).toBe('Cannot build ramp on water');
    expect(BUILD_REASON_MESSAGES.RAMP_OVER_ROAD).toBe('Road underneath — no room for ramp');
    expect(BUILD_REASON_MESSAGES.RAMP_ABOVE).toBe('Ramp above — cannot build here');
    expect(BUILD_REASON_MESSAGES.WATER_CROSSING_NO_TURN).toBe('Bridge over water must be straight');
  });
});

describe('getBuildReasonMessage', () => {
  it('should return mapped message for known reasons', () => {
    expect(getBuildReasonMessage('WATER_TILE')).toBe('Cannot build on water');
    expect(getBuildReasonMessage('INSUFFICIENT_FUNDS')).toBe('Insufficient funds');
    expect(getBuildReasonMessage('RAMP_OCCUPIED')).toBe('Cannot build over existing ramp');
  });

  it('should return raw reason string for unknown reasons', () => {
    expect(getBuildReasonMessage('UNKNOWN_REASON')).toBe('UNKNOWN_REASON');
  });
});
