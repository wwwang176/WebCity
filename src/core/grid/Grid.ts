import { CellData, BYTES_PER_CELL, type Position } from './types';

export class Grid {
  readonly width: number;
  readonly height: number;
  readonly totalCells: number;
  private buffer: ArrayBuffer;
  private view: DataView;
  readonly naturalResources: Uint8Array;
  readonly reservedData: Uint8Array;
  readonly railTypeData: Uint8Array;
  readonly railFlagsData: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.totalCells = width * height;
    this.buffer = new ArrayBuffer(this.totalCells * BYTES_PER_CELL);
    this.view = new DataView(this.buffer);
    this.naturalResources = new Uint8Array(this.totalCells);
    this.reservedData = new Uint8Array(this.totalCells);
    this.railTypeData = new Uint8Array(this.totalCells);
    this.railFlagsData = new Uint8Array(this.totalCells);
  }

  private isInBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  private getOffset(x: number, y: number): number {
    return (y * this.width + x) * BYTES_PER_CELL;
  }

  getCell(x: number, y: number): CellData | null {
    if (!this.isInBounds(x, y)) return null;
    const offset = this.getOffset(x, y);
    return {
      terrainType: this.view.getUint8(offset + 0),
      zoneType: this.view.getUint8(offset + 1),
      buildingId: this.view.getUint16(offset + 2, true),
      roadFlags: this.view.getUint8(offset + 4),
      roadType: this.view.getUint8(offset + 5),
      trafficDensity: this.view.getUint8(offset + 6),
      landValue: this.view.getUint8(offset + 7),
      pollution: this.view.getUint8(offset + 8),
      noiseLevel: this.view.getUint8(offset + 9),
      serviceCoverage: this.view.getUint8(offset + 10),
      elevation: this.view.getInt8(offset + 11),
      reserved: this.reservedData[y * this.width + x] ?? 0,
      railType: this.railTypeData[y * this.width + x] ?? 0,
      railFlags: this.railFlagsData[y * this.width + x] ?? 0,
    };
  }

  setCell(x: number, y: number, data: Partial<CellData>): void {
    if (!this.isInBounds(x, y)) return;
    const offset = this.getOffset(x, y);

    if (data.terrainType !== undefined) this.view.setUint8(offset + 0, data.terrainType);
    if (data.zoneType !== undefined) this.view.setUint8(offset + 1, data.zoneType);
    if (data.buildingId !== undefined) this.view.setUint16(offset + 2, data.buildingId, true);
    if (data.roadFlags !== undefined) this.view.setUint8(offset + 4, data.roadFlags);
    if (data.roadType !== undefined) this.view.setUint8(offset + 5, data.roadType);
    if (data.trafficDensity !== undefined) this.view.setUint8(offset + 6, data.trafficDensity);
    if (data.landValue !== undefined) this.view.setUint8(offset + 7, data.landValue);
    if (data.pollution !== undefined) this.view.setUint8(offset + 8, data.pollution);
    if (data.noiseLevel !== undefined) this.view.setUint8(offset + 9, data.noiseLevel);
    if (data.serviceCoverage !== undefined) this.view.setUint8(offset + 10, data.serviceCoverage);
    if (data.elevation !== undefined) this.view.setInt8(offset + 11, data.elevation);
    if (data.reserved !== undefined) this.reservedData[y * this.width + x] = data.reserved;
    if (data.railType !== undefined) this.railTypeData[y * this.width + x] = data.railType;
    if (data.railFlags !== undefined) this.railFlagsData[y * this.width + x] = data.railFlags;
  }

  getCellsInRect(from: Position, to: Position): CellData[] {
    const x1 = Math.max(0, Math.min(from.x, to.x));
    const y1 = Math.max(0, Math.min(from.y, to.y));
    const x2 = Math.min(this.width - 1, Math.max(from.x, to.x));
    const y2 = Math.min(this.height - 1, Math.max(from.y, to.y));

    const cells: CellData[] = [];
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const cell = this.getCell(x, y);
        if (cell) cells.push(cell);
      }
    }
    return cells;
  }

  /** Fill a pre-allocated CellData object from the binary buffer (no allocation). */
  fillCell(x: number, y: number, out: CellData): void {
    const offset = this.getOffset(x, y);
    const idx = y * this.width + x;
    out.terrainType = this.view.getUint8(offset + 0);
    out.zoneType = this.view.getUint8(offset + 1);
    out.buildingId = this.view.getUint16(offset + 2, true);
    out.roadFlags = this.view.getUint8(offset + 4);
    out.roadType = this.view.getUint8(offset + 5);
    out.trafficDensity = this.view.getUint8(offset + 6);
    out.landValue = this.view.getUint8(offset + 7);
    out.pollution = this.view.getUint8(offset + 8);
    out.noiseLevel = this.view.getUint8(offset + 9);
    out.serviceCoverage = this.view.getUint8(offset + 10);
    out.elevation = this.view.getInt8(offset + 11);
    out.reserved = this.reservedData[idx]!;
    out.railType = this.railTypeData[idx]!;
    out.railFlags = this.railFlagsData[idx]!;
  }

  /** Iterate over every cell in row-major order (y then x).
   *  Uses a single reusable CellData object — do NOT store the cell reference. */
  forEachCell(fn: (cell: CellData, x: number, y: number) => void): void {
    const cell: CellData = {
      terrainType: 0, zoneType: 0, buildingId: 0, roadFlags: 0,
      roadType: 0, trafficDensity: 0, landValue: 0, pollution: 0,
      noiseLevel: 0, serviceCoverage: 0, elevation: 0, reserved: 0,
      railType: 0, railFlags: 0,
    };
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.fillCell(x, y, cell);
        fn(cell, x, y);
      }
    }
  }

  getNeighbors(x: number, y: number): CellData[] {
    const dirs: Position[] = [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ];
    const result: CellData[] = [];
    for (const d of dirs) {
      const cell = this.getCell(x + d.x, y + d.y);
      if (cell) result.push(cell);
    }
    return result;
  }

  getNeighbors8(x: number, y: number): CellData[] {
    const dirs: Position[] = [
      { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
      { x: -1, y: 0 },                   { x: 1, y: 0 },
      { x: -1, y: 1 },  { x: 0, y: 1 },  { x: 1, y: 1 },
    ];
    const result: CellData[] = [];
    for (const d of dirs) {
      const cell = this.getCell(x + d.x, y + d.y);
      if (cell) result.push(cell);
    }
    return result;
  }
}
