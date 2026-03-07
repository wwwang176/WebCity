import { BYTES_PER_CELL } from './types';

export class GridBuffer {
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  private buffer: SharedArrayBuffer;
  private view: DataView;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.byteLength = width * height * BYTES_PER_CELL;
    this.buffer = new SharedArrayBuffer(this.byteLength);
    this.view = new DataView(this.buffer);
  }

  getBuffer(): SharedArrayBuffer {
    return this.buffer;
  }

  private getOffset(x: number, y: number): number {
    return (y * this.width + x) * BYTES_PER_CELL;
  }

  getTerrainType(x: number, y: number): number {
    return this.view.getUint8(this.getOffset(x, y) + 0);
  }

  setTerrainType(x: number, y: number, value: number): void {
    this.view.setUint8(this.getOffset(x, y) + 0, value);
  }

  getZoneType(x: number, y: number): number {
    return this.view.getUint8(this.getOffset(x, y) + 1);
  }

  setZoneType(x: number, y: number, value: number): void {
    this.view.setUint8(this.getOffset(x, y) + 1, value);
  }

  getBuildingId(x: number, y: number): number {
    return this.view.getUint16(this.getOffset(x, y) + 2, true);
  }

  setBuildingId(x: number, y: number, value: number): void {
    this.view.setUint16(this.getOffset(x, y) + 2, value, true);
  }

  getRoadFlags(x: number, y: number): number {
    return this.view.getUint8(this.getOffset(x, y) + 4);
  }

  setRoadFlags(x: number, y: number, value: number): void {
    this.view.setUint8(this.getOffset(x, y) + 4, value);
  }

  getTrafficDensity(x: number, y: number): number {
    return this.view.getUint8(this.getOffset(x, y) + 6);
  }

  setTrafficDensity(x: number, y: number, value: number): void {
    this.view.setUint8(this.getOffset(x, y) + 6, value);
  }

  getLandValue(x: number, y: number): number {
    return this.view.getUint8(this.getOffset(x, y) + 7);
  }

  setLandValue(x: number, y: number, value: number): void {
    this.view.setUint8(this.getOffset(x, y) + 7, value);
  }

  getPollution(x: number, y: number): number {
    return this.view.getUint8(this.getOffset(x, y) + 8);
  }

  setPollution(x: number, y: number, value: number): void {
    this.view.setUint8(this.getOffset(x, y) + 8, value);
  }

  getElevation(x: number, y: number): number {
    return this.view.getInt8(this.getOffset(x, y) + 11);
  }

  setElevation(x: number, y: number, value: number): void {
    this.view.setInt8(this.getOffset(x, y) + 11, value);
  }
}
