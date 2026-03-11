
import type { PollutionSource } from '../environment/Pollution';

export type AirportSize = 'SMALL' | 'MEDIUM' | 'LARGE';

const SIZE_FOOTPRINT: Record<AirportSize, number> = {
  SMALL: 3,
  MEDIUM: 5,
  LARGE: 7,
};

/** Returns the side length (NxN) of the airport footprint for the given size. */
export function getAirportFootprint(size: AirportSize): number {
  return SIZE_FOOTPRINT[size];
}

const SIZE_AREA: Record<AirportSize, number> = {
  SMALL: 9,   // 3x3
  MEDIUM: 25, // 5x5
  LARGE: 49,  // 7x7
};

const SIZE_NOISE: Record<AirportSize, number> = {
  SMALL: 10,
  MEDIUM: 25,
  LARGE: 50,
};

const SIZE_TOURISTS: Record<AirportSize, number> = {
  SMALL: 50,
  MEDIUM: 200,
  LARGE: 500,
};

const SIZE_CARGO: Record<AirportSize, number> = {
  SMALL: 20,
  MEDIUM: 100,
  LARGE: 300,
};

const SIZE_OPERATING_COST: Record<AirportSize, number> = {
  SMALL: 500,
  MEDIUM: 1500,
  LARGE: 4000,
};

const POP_REQUIRED: Record<AirportSize, number> = {
  SMALL: 10000,
  MEDIUM: 50000,
  LARGE: 100000,
};

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
    if (currentPopulation < POP_REQUIRED[size]) {
      return null;
    }

    const airport: Airport = {
      id: this.nextId++,
      x,
      y,
      size,
      area: SIZE_AREA[size],
      noisePollution: SIZE_NOISE[size],
      touristsPerTick: SIZE_TOURISTS[size],
      cargoPerTick: SIZE_CARGO[size],
      operatingCost: SIZE_OPERATING_COST[size],
    };
    this.airports.push(airport);
    return airport;
  }

  /** Population required to unlock airport construction. */
  getPopulationRequired(size: AirportSize = 'SMALL'): number {
    return POP_REQUIRED[size];
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
