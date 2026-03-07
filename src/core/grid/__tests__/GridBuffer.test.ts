import { describe, it, expect } from 'vitest';
import { GridBuffer } from '../GridBuffer';
import { BYTES_PER_CELL } from '../types';

describe('GridBuffer (SharedArrayBuffer)', () => {
  it('should create buffer with correct size (200x200 = 480,000 bytes)', () => {
    const buffer = new GridBuffer(200, 200);
    expect(buffer.byteLength).toBe(200 * 200 * BYTES_PER_CELL);
    expect(buffer.byteLength).toBe(480000);
  });

  it('should read and write terrainType via Uint8Array', () => {
    const buffer = new GridBuffer(10, 10);
    buffer.setTerrainType(3, 3, 1); // WATER
    expect(buffer.getTerrainType(3, 3)).toBe(1);
  });

  it('should read and write buildingId via Uint16', () => {
    const buffer = new GridBuffer(10, 10);
    buffer.setBuildingId(5, 5, 1234);
    expect(buffer.getBuildingId(5, 5)).toBe(1234);
  });

  it('should have independent views that read/write correctly', () => {
    const buffer = new GridBuffer(10, 10);
    buffer.setTerrainType(2, 2, 3); // FOREST
    buffer.setBuildingId(2, 2, 555);
    buffer.setElevation(2, 2, 10);

    expect(buffer.getTerrainType(2, 2)).toBe(3);
    expect(buffer.getBuildingId(2, 2)).toBe(555);
    expect(buffer.getElevation(2, 2)).toBe(10);
  });

  it('should expose the underlying SharedArrayBuffer', () => {
    const buffer = new GridBuffer(10, 10);
    const sab = buffer.getBuffer();
    expect(sab).toBeInstanceOf(SharedArrayBuffer);
  });
});
