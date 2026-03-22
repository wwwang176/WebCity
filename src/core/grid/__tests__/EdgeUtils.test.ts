import { describe, it, expect } from 'vitest';
import { hasInwardFlag } from '../EdgeUtils';

// Direction flag values (shared by RoadDirection and TrackDirection)
const NORTH = 0b0001;
const SOUTH = 0b0010;
const WEST  = 0b0100;
const EAST  = 0b1000;

describe('hasInwardFlag', () => {
  const W = 10, H = 10;

  // North edge (y=0): inward = SOUTH
  it('north edge: SOUTH flag → true', () => {
    expect(hasInwardFlag(5, 0, W, H, SOUTH)).toBe(true);
  });
  it('north edge: EAST|WEST only → false', () => {
    expect(hasInwardFlag(5, 0, W, H, EAST | WEST)).toBe(false);
  });

  // South edge (y=H-1): inward = NORTH
  it('south edge: NORTH flag → true', () => {
    expect(hasInwardFlag(5, H - 1, W, H, NORTH)).toBe(true);
  });
  it('south edge: EAST|WEST only → false', () => {
    expect(hasInwardFlag(5, H - 1, W, H, EAST | WEST)).toBe(false);
  });

  // West edge (x=0): inward = EAST
  it('west edge: EAST flag → true', () => {
    expect(hasInwardFlag(0, 5, W, H, EAST)).toBe(true);
  });
  it('west edge: NORTH|SOUTH only → false', () => {
    expect(hasInwardFlag(0, 5, W, H, NORTH | SOUTH)).toBe(false);
  });

  // East edge (x=W-1): inward = WEST
  it('east edge: WEST flag → true', () => {
    expect(hasInwardFlag(W - 1, 5, W, H, WEST)).toBe(true);
  });
  it('east edge: NORTH|SOUTH only → false', () => {
    expect(hasInwardFlag(W - 1, 5, W, H, NORTH | SOUTH)).toBe(false);
  });

  // Corner: on two edges, either inward direction qualifies
  it('corner (0,0): SOUTH flag → true (inward from north edge)', () => {
    expect(hasInwardFlag(0, 0, W, H, SOUTH)).toBe(true);
  });
  it('corner (0,0): EAST flag → true (inward from west edge)', () => {
    expect(hasInwardFlag(0, 0, W, H, EAST)).toBe(true);
  });
  it('corner (0,0): no flags → false', () => {
    expect(hasInwardFlag(0, 0, W, H, 0)).toBe(false);
  });

  // Interior cell: not on any edge
  it('interior cell → false regardless of flags', () => {
    expect(hasInwardFlag(5, 5, W, H, NORTH | SOUTH | EAST | WEST)).toBe(false);
  });
});
