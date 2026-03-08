
export type AirportSize = 'SMALL' | 'MEDIUM' | 'LARGE';

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

const POP_REQUIRED = 10000;

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
    if (currentPopulation < POP_REQUIRED) {
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
  getPopulationRequired(): number {
    return POP_REQUIRED;
  }

  tick(): void {
    // Airport tick -- tourists and cargo arrive each tick
    // (consumed by external systems reading touristsPerTick / cargoPerTick)
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
}
