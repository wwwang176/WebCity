import { describe, it, expect } from 'vitest';
import { canPlaceTransportStop } from '../TransportPlacement';

describe('canPlaceTransportStop', () => {
  it('should reject null cell (out of bounds)', () => {
    const result = canPlaceTransportStop('bus', null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('OUT_OF_BOUNDS');
  });

  it('should allow bus stop on empty cell', () => {
    const cell = { roadType: 0, buildingId: 0, railType: 0 };
    expect(canPlaceTransportStop('bus', cell)).toEqual({ ok: true });
  });

  it('should allow metro station on empty cell', () => {
    const cell = { roadType: 0, buildingId: 0, railType: 0 };
    expect(canPlaceTransportStop('metro', cell)).toEqual({ ok: true });
  });

  it('should reject bus stop on cell with road', () => {
    const cell = { roadType: 2, buildingId: 0, railType: 0 };
    const result = canPlaceTransportStop('bus', cell);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('TILE_OCCUPIED');
  });

  it('should reject bus stop on cell with building', () => {
    const cell = { roadType: 0, buildingId: 5, railType: 0 };
    const result = canPlaceTransportStop('bus', cell);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('TILE_OCCUPIED');
  });

  it('should allow rail station on cell with rail track', () => {
    const cell = { roadType: 0, buildingId: 0, railType: 1 };
    expect(canPlaceTransportStop('rail', cell)).toEqual({ ok: true });
  });

  it('should reject rail station on cell without rail track', () => {
    const cell = { roadType: 0, buildingId: 0, railType: 0 };
    const result = canPlaceTransportStop('rail', cell);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('NEED_RAIL_TRACK');
  });

  it('should reject rail station on cell with existing building', () => {
    const cell = { roadType: 0, buildingId: 5, railType: 1 };
    const result = canPlaceTransportStop('rail', cell);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('TILE_OCCUPIED');
  });

  it('should allow rail station on cell with road + rail (level crossing)', () => {
    // Rail stations can be built on track cells (may have road for level crossing)
    const cell = { roadType: 2, buildingId: 0, railType: 1 };
    expect(canPlaceTransportStop('rail', cell)).toEqual({ ok: true });
  });

  it('should allow ferry dock on empty cell', () => {
    const cell = { roadType: 0, buildingId: 0, railType: 0 };
    expect(canPlaceTransportStop('ferry', cell)).toEqual({ ok: true });
  });

  it('should reject ferry dock on occupied cell', () => {
    const cell = { roadType: 1, buildingId: 0, railType: 0 };
    const result = canPlaceTransportStop('ferry', cell);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('TILE_OCCUPIED');
  });

  it('should allow airport on empty cell', () => {
    const cell = { roadType: 0, buildingId: 0, railType: 0 };
    expect(canPlaceTransportStop('airport', cell)).toEqual({ ok: true });
  });
});
