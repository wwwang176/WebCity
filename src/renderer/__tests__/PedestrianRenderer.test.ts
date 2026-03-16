import { describe, it, expect } from 'vitest';
import { cullPedestrians } from '../PedestrianRenderer';
import { buildPersonGeometry } from '../geometry/person';
import { PedestrianState } from '../../core/traffic/PedestrianAgent';

describe('buildPersonGeometry', () => {
  // C1: Should return valid BufferGeometry
  it('should return geometry with position attribute', () => {
    const geo = buildPersonGeometry();
    expect(geo).toBeDefined();
    const pos = geo.getAttribute('position');
    expect(pos).toBeDefined();
    expect(pos!.count).toBeGreaterThan(0);
  });

  it('should have color attribute', () => {
    const geo = buildPersonGeometry();
    const col = geo.getAttribute('color');
    expect(col).toBeDefined();
    expect(col!.count).toBeGreaterThan(0);
  });

  it('should have matching position and color vertex counts', () => {
    const geo = buildPersonGeometry();
    const pos = geo.getAttribute('position');
    const col = geo.getAttribute('color');
    expect(pos!.count).toBe(col!.count);
  });
});

describe('cullPedestrians', () => {
  const makePed = (id: number, x: number, y: number, state = PedestrianState.WALKING) => ({
    id, position: { x, y }, heading: 0, colorIndex: 0, state,
  });

  // C5: Camera culling
  it('should include pedestrians within CULL_RADIUS', () => {
    const peds = [makePed(1, 5, 5)];
    const result = cullPedestrians(peds, 5, 5);
    expect(result.length).toBe(1);
  });

  it('should exclude pedestrians outside CULL_RADIUS', () => {
    const peds = [makePed(1, 100, 100)];
    const result = cullPedestrians(peds, 0, 0);
    expect(result.length).toBe(0);
  });

  it('should exclude ARRIVED pedestrians', () => {
    const peds = [makePed(1, 5, 5, PedestrianState.ARRIVED)];
    const result = cullPedestrians(peds, 5, 5);
    expect(result.length).toBe(0);
  });

  it('should return empty for empty input', () => {
    const result = cullPedestrians([], 0, 0);
    expect(result.length).toBe(0);
  });

  it('should correctly filter a mix of near and far pedestrians', () => {
    const peds = [
      makePed(1, 0, 0),     // near camera at (0,0)
      makePed(2, 10, 0),    // within radius
      makePed(3, 100, 100), // far away
      makePed(4, 5, 5, PedestrianState.ARRIVED), // arrived
    ];
    const result = cullPedestrians(peds, 0, 0);
    expect(result.length).toBe(2);
    expect(result.map(r => r.id).sort()).toEqual([1, 2]);
  });
});
