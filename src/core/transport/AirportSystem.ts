
import type { PollutionSource } from '../environment/Pollution';

export type AirportSize = 'SMALL' | 'MEDIUM' | 'LARGE';

/** Consolidated per-size configuration for airports (OCP-friendly). */
export interface AirportSizeConfig {
  footprint: number;
  area: number;
  noise: number;
  tourists: number;
  cargo: number;
  operatingCost: number;
  populationRequired: number;
}

/** Single source of truth for all airport size parameters. */
export const AIRPORT_SIZE_CONFIG: Record<AirportSize, AirportSizeConfig> = {
  SMALL:  { footprint: 3, area: 9,  noise: 10, tourists: 50,  cargo: 20,  operatingCost: 500,  populationRequired: 10000 },
  MEDIUM: { footprint: 5, area: 25, noise: 25, tourists: 200, cargo: 100, operatingCost: 1500, populationRequired: 50000 },
  LARGE:  { footprint: 7, area: 49, noise: 50, tourists: 500, cargo: 300, operatingCost: 4000, populationRequired: 100000 },
};

/** Returns the side length (NxN) of the airport footprint for the given size. */
export function getAirportFootprint(size: AirportSize): number {
  return AIRPORT_SIZE_CONFIG[size].footprint;
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
