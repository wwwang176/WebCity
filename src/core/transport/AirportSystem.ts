
import type { PollutionSource } from '../environment/Pollution';
import { MULTI_CELL_OCCUPIED } from '../building/InfraPlacement';

export type AirportSize = 'SMALL' | 'MEDIUM' | 'LARGE';

/** Consolidated per-size configuration for airports (OCP-friendly). */
export interface AirportSizeConfig {
  footprint: number;
  area: number;
  noise: number;
  tourists: number;
  cargo: number;
  buildCost: number;
  operatingCost: number;
  populationRequired: number;
}

/** Single source of truth for all airport size parameters. */
export const AIRPORT_SIZE_CONFIG: Record<AirportSize, AirportSizeConfig> = {
  SMALL:  { footprint: 3, area: 9,  noise: 10, tourists: 50,  cargo: 20,  buildCost: 5000,  operatingCost: 500,  populationRequired: 10000 },
  MEDIUM: { footprint: 5, area: 25, noise: 25, tourists: 200, cargo: 100, buildCost: 15000, operatingCost: 1500, populationRequired: 50000 },
  LARGE:  { footprint: 7, area: 49, noise: 50, tourists: 500, cargo: 300, buildCost: 40000, operatingCost: 4000, populationRequired: 100000 },
};

/** Returns the side length (NxN) of the airport footprint for the given size. */
export function getAirportFootprint(size: AirportSize): number {
  return AIRPORT_SIZE_CONFIG[size].footprint;
}

/** Returns the one-time build cost for the given airport size. */
export function getAirportBuildCost(size: AirportSize): number {
  return AIRPORT_SIZE_CONFIG[size].buildCost;
}

/** Iterate over every cell in an airport footprint (DRY: eliminates repeated footprint loops). */
export function forEachAirportCell(
  x: number, y: number, size: AirportSize,
  fn: (cx: number, cy: number) => void,
): void {
  const footprint = getAirportFootprint(size);
  const half = Math.floor(footprint / 2);
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      fn(x + dx, y + dy);
    }
  }
}

/** Place airport footprint cells on the grid (SRP: grid placement belongs with airport logic). */
export function placeAirportOnGrid(
  grid: { setCell(x: number, y: number, data: { buildingId: number; reserved?: number }): void },
  x: number, y: number, size: AirportSize, airportBuildingId: number,
): void {
  forEachAirportCell(x, y, size, (cx, cy) => {
    const isPrimary = cx === x && cy === y;
    grid.setCell(cx, cy, {
      buildingId: airportBuildingId,
      reserved: isPrimary ? 0 : MULTI_CELL_OCCUPIED,
    });
  });
}

export interface Airport {
  id: number;
  x: number;
  y: number;
  size: AirportSize;
  area: number;
  noisePollution: number;
  touristsPerTick: number;
  cargoPerTick: number;
  operatingCost: number;
}

export type AirportPlaceResult =
  | { ok: true }
  | { ok: false; reason: string };

/** Validate whether an airport can be placed at (x,y) with the given size. Pure function (SRP). */
export function canPlaceAirport(
  grid: { getCell(x: number, y: number): { roadType: number; buildingId: number } | null },
  x: number,
  y: number,
  size: AirportSize,
): AirportPlaceResult {
  const footprint = getAirportFootprint(size);
  const half = Math.floor(footprint / 2);
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const c = grid.getCell(x + dx, y + dy);
      if (!c) return { ok: false, reason: 'AIRPORT_OUT_OF_BOUNDS' };
      if (c.roadType !== 0 || c.buildingId !== 0) return { ok: false, reason: 'AIRPORT_AREA_OCCUPIED' };
    }
  }
  return { ok: true };
}

export class AirportSystem {
  private airports: Airport[] = [];
  private nextId = 1;

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
  ): Airport | null {
    const cfg = AIRPORT_SIZE_CONFIG[size];
    if (currentPopulation < cfg.populationRequired) {
      return null;
    }

    const airport: Airport = {
      id: this.nextId++,
      x,
      y,
      size,
      area: cfg.area,
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

  tick(): void {
    for (const airport of this.airports) {
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
      const half = Math.floor(getAirportFootprint(a.size) / 2);
      if (x >= a.x - half && x <= a.x + half && y >= a.y - half && y <= a.y + half) {
        return a;
      }
    }
    return null;
  }

  /** Noise pollution multiplier for spread calculation. */
  static readonly NOISE_SPREAD_MULTIPLIER = 5;

  getPollutionSources(): PollutionSource[] {
    return this.airports.map(a => ({
      x: a.x,
      y: a.y,
      amount: a.noisePollution * AirportSystem.NOISE_SPREAD_MULTIPLIER,
      type: 'noise' as const,
    }));
  }

  /**
   * Find and demolish an airport that covers the given cell.
   * Invokes clearCell for every cell in the airport footprint, then removes the airport.
   * @returns true if an airport was found and demolished, false otherwise.
   */
  demolishAtCell(x: number, y: number, clearCell: (cx: number, cy: number) => void): boolean {
    const airport = this.findAtCell(x, y);
    if (!airport) return false;
    forEachAirportCell(airport.x, airport.y, airport.size, clearCell);
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
