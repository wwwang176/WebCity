
import type { PollutionSource } from '../environment/Pollution';
import { MULTI_CELL_OCCUPIED } from '../building/InfraPlacement';
import { getRotatedSize, type Rotation, type InfraType } from '../building/InfraConfig';
import { isFacilityOperational, type UtilityChecker } from '../service/FacilityOperational';

export type AirportSize = 'SMALL' | 'MEDIUM' | 'LARGE';

/** Consolidated per-size configuration for airports (OCP-friendly). */
export interface AirportSizeConfig {
  /** Runway direction width (X). */
  width: number;
  /** Perpendicular depth (Y). */
  height: number;
  noise: number;
  /** Noise pollution spread radius (Manhattan distance) per cell. */
  noiseRadius: number;
  tourists: number;
  cargo: number;
  buildCost: number;
  operatingCost: number;
  populationRequired: number;
}

/** Single source of truth for all airport size parameters. */
export const AIRPORT_SIZE_CONFIG: Record<AirportSize, AirportSizeConfig> = {
  SMALL:  { width: 5, height: 4, noise: 30, noiseRadius: 5, tourists: 50,  cargo: 20,  buildCost: 5000,  operatingCost: 500,  populationRequired: 0 },
  MEDIUM: { width: 7, height: 4, noise: 60, noiseRadius: 8, tourists: 200, cargo: 100, buildCost: 15000, operatingCost: 1500, populationRequired: 0 },
  LARGE:  { width: 9, height: 6, noise: 100, noiseRadius: 12, tourists: 500, cargo: 300, buildCost: 40000, operatingCost: 4000, populationRequired: 0 },
};

/** Returns the max dimension (for cursor sizing — square bounding box). */
export function getAirportFootprint(size: AirportSize): number {
  const cfg = AIRPORT_SIZE_CONFIG[size];
  return Math.max(cfg.width, cfg.height);
}

/** Returns the width and height for an airport size. */
export function getAirportDimensions(size: AirportSize): { w: number; h: number } {
  const cfg = AIRPORT_SIZE_CONFIG[size];
  return { w: cfg.width, h: cfg.height };
}

/** Returns the one-time build cost for the given airport size. */
export function getAirportBuildCost(size: AirportSize): number {
  return AIRPORT_SIZE_CONFIG[size].buildCost;
}

/** Iterate over every cell in an airport footprint. (x,y) = top-left cell, same as other infra. */
export function forEachAirportCell(
  x: number, y: number, size: AirportSize,
  fn: (cx: number, cy: number) => void,
  rotation: Rotation = 0,
): void {
  const dim = getAirportDimensions(size);
  const { w, h } = getRotatedSize(dim.w, dim.h, rotation);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      fn(x + dx, y + dy);
    }
  }
}

/** Place airport footprint cells on the grid. (x,y) = top-left, same as placeInfraOnGrid. */
export function placeAirportOnGrid(
  grid: { setCell(x: number, y: number, data: { buildingId: number; reserved?: number }): void },
  x: number, y: number, size: AirportSize, airportBuildingId: number, rotation: Rotation = 0,
): void {
  const dim = getAirportDimensions(size);
  const { w, h } = getRotatedSize(dim.w, dim.h, rotation);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const isPrimary = dx === 0 && dy === 0;
      grid.setCell(x + dx, y + dy, {
        buildingId: airportBuildingId,
        reserved: isPrimary ? ROTATION_RESERVED[rotation] : MULTI_CELL_OCCUPIED,
      });
    }
  }
}

const ROTATION_RESERVED: Record<number, number> = { 0: 0, 90: 5, 180: 6, 270: 7 };

export interface Airport {
  id: number;
  x: number;
  y: number;
  size: AirportSize;
  rotation: Rotation;
  noisePollution: number;
  touristsPerTick: number;
  cargoPerTick: number;
  operatingCost: number;
}

// canPlaceAirport removed — use canPlaceInfra(grid, x, y, 'airport', rotation, undefined, { width, height }) instead

const SIZE_TO_INFRA: Record<AirportSize, InfraType> = {
  SMALL: 'airport_s',
  MEDIUM: 'airport_m',
  LARGE: 'airport_l',
};

export class AirportSystem {
  private airports: Airport[] = [];
  private nextId = 1;
  private operationalIds: Set<number> | null = null;

  /** Accumulated tourists to be consumed by population system. */
  pendingTourists = 0;
  /** Accumulated cargo to be consumed by freight system. */
  pendingCargo = 0;

  /**
   * Build an airport at the given location.
   * Requires a minimum population to unlock.
   * @returns The built airport, or null if population requirement not met.
   */
  build(
    x: number,
    y: number,
    size: AirportSize,
    currentPopulation: number,
    rotation: Rotation = 0,
  ): Airport | null {
    const cfg = AIRPORT_SIZE_CONFIG[size];
    if (currentPopulation < cfg.populationRequired) {
      return null;
    }

    const airport: Airport = {
      id: this.nextId++,
      x,
      y,
      rotation,
      size,
      noisePollution: cfg.noise,
      touristsPerTick: cfg.tourists,
      cargoPerTick: cfg.cargo,
      operatingCost: cfg.operatingCost,
    };
    this.airports.push(airport);
    return airport;
  }

  /** Population required to unlock airport construction. */
  getPopulationRequired(size: AirportSize = 'SMALL'): number {
    return AIRPORT_SIZE_CONFIG[size].populationRequired;
  }

  /** Update which airports are operational (have power + water). */
  updateOperationalStatus(isPowered: UtilityChecker, isWaterSupplied: UtilityChecker): void {
    this.operationalIds = new Set<number>();
    for (const a of this.airports) {
      if (isFacilityOperational(a.x, a.y, SIZE_TO_INFRA[a.size], isPowered, isWaterSupplied)) {
        this.operationalIds.add(a.id);
      }
    }
  }

  isAirportOperational(id: number): boolean {
    return this.operationalIds === null || this.operationalIds.has(id);
  }

  tick(): void {
    for (const airport of this.airports) {
      if (!this.isAirportOperational(airport.id)) continue;
      this.pendingTourists += airport.touristsPerTick;
      this.pendingCargo += airport.cargoPerTick;
    }
  }

  /** Consume accumulated tourists (called by population system). */
  consumeTourists(): number {
    const t = this.pendingTourists;
    this.pendingTourists = 0;
    return t;
  }

  /** Consume accumulated cargo (called by freight system). */
  consumeCargo(): number {
    const c = this.pendingCargo;
    this.pendingCargo = 0;
    return c;
  }

  getNoisePollution(airportId: number): number {
    const airport = this.airports.find((a) => a.id === airportId);
    return airport?.noisePollution ?? 0;
  }

  getOperatingCost(): number {
    return this.airports.reduce((sum, a) => sum + a.operatingCost, 0);
  }

  getAirports(): readonly Airport[] {
    return this.airports;
  }

  /** Find the airport whose footprint covers the given cell. Returns null if none. */
  findAtCell(x: number, y: number): Airport | null {
    for (const a of this.airports) {
      const dim = getAirportDimensions(a.size);
      const { w, h } = getRotatedSize(dim.w, dim.h, a.rotation);
      if (x >= a.x && x < a.x + w && y >= a.y && y < a.y + h) {
        return a;
      }
    }
    return null;
  }

  getPollutionSources(): PollutionSource[] {
    const sources: PollutionSource[] = [];
    for (const a of this.airports) {
      if (!this.isAirportOperational(a.id)) continue;
      const cfg = AIRPORT_SIZE_CONFIG[a.size];
      forEachAirportCell(a.x, a.y, a.size, (cx, cy) => {
        sources.push({
          x: cx,
          y: cy,
          amount: cfg.noise,
          type: 'noise' as const,
          radius: cfg.noiseRadius,
        });
      }, a.rotation);
    }
    return sources;
  }

  /**
   * Find and demolish an airport that covers the given cell.
   * Invokes clearCell for every cell in the airport footprint, then removes the airport.
   * @returns true if an airport was found and demolished, false otherwise.
   */
  demolishAtCell(x: number, y: number, clearCell: (cx: number, cy: number) => void): boolean {
    const airport = this.findAtCell(x, y);
    if (!airport) return false;
    forEachAirportCell(airport.x, airport.y, airport.size, clearCell, airport.rotation);
    this.remove(airport.id);
    return true;
  }

  remove(airportId: number): void {
    this.airports = this.airports.filter(a => a.id !== airportId);
  }

  toJSON() {
    return {
      airports: this.airports.map(a => ({ ...a })),
      nextId: this.nextId,
    };
  }

  static fromJSON(data: ReturnType<AirportSystem['toJSON']>): AirportSystem {
    const sys = new AirportSystem();
    sys.airports = data.airports.map(a => ({ ...a }));
    sys.nextId = data.nextId;
    return sys;
  }
}
