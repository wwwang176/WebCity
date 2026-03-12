export enum ResourceType {
  OIL = 'OIL',
  ORE = 'ORE',
  AGRICULTURE = 'AGRICULTURE',
  ELECTRONICS = 'ELECTRONICS',
}

const BASE_PRICES: Record<ResourceType, number> = {
  [ResourceType.OIL]: 100,
  [ResourceType.ORE]: 80,
  [ResourceType.AGRICULTURE]: 60,
  [ResourceType.ELECTRONICS]: 150,
};

/** Global market simulation constants */
export const MARKET_CONFIG = {
  /** Markup multiplier on import prices (10%) */
  IMPORT_MARKUP: 1.1,
  /** Price floor ratio relative to base price (20%) */
  PRICE_MIN_RATIO: 0.2,
  /** Price ceiling ratio relative to base price (300%) */
  PRICE_MAX_RATIO: 3.0,
  /** Random price fluctuation per tick */
  VOLATILITY: 0.02,
  /** How much trade volume affects price */
  SUPPLY_DEMAND_FACTOR: 0.005,
  /** Strength of price mean reversion toward base */
  MEAN_REVERSION_FACTOR: 0.01,
  /** Supply pressure decay per tick */
  SUPPLY_PRESSURE_DECAY: 0.9,
} as const;

interface ResourceState {
  price: number;
  supplyPressure: number; // positive = oversupply (exports), negative = excess demand (imports)
}

export class GlobalMarket {
  private resources: Record<ResourceType, ResourceState>;

  constructor() {
    this.resources = {
      [ResourceType.OIL]: { price: BASE_PRICES[ResourceType.OIL], supplyPressure: 0 },
      [ResourceType.ORE]: { price: BASE_PRICES[ResourceType.ORE], supplyPressure: 0 },
      [ResourceType.AGRICULTURE]: { price: BASE_PRICES[ResourceType.AGRICULTURE], supplyPressure: 0 },
      [ResourceType.ELECTRONICS]: { price: BASE_PRICES[ResourceType.ELECTRONICS], supplyPressure: 0 },
    };
  }

  getPrice(type: ResourceType): number {
    return Math.round(this.resources[type].price * 100) / 100;
  }

  getAllPrices(): Record<ResourceType, number> {
    const result = {} as Record<ResourceType, number>;
    for (const type of Object.values(ResourceType)) {
      result[type] = this.getPrice(type);
    }
    return result;
  }

  exportResource(type: ResourceType, quantity: number): number {
    const revenue = this.resources[type].price * quantity;
    this.resources[type].supplyPressure += quantity;
    return Math.round(revenue * 100) / 100;
  }

  importResource(type: ResourceType, quantity: number): number {
    const cost = this.resources[type].price * quantity * MARKET_CONFIG.IMPORT_MARKUP;
    this.resources[type].supplyPressure -= quantity;
    return Math.round(cost * 100) / 100;
  }

  tick(): void {
    for (const type of Object.values(ResourceType)) {
      const state = this.resources[type];
      const base = BASE_PRICES[type];

      // Random market fluctuation
      const randomChange = (Math.random() - 0.5) * 2 * MARKET_CONFIG.VOLATILITY * base;

      // Supply/demand pressure effect
      const pressureEffect = -state.supplyPressure * MARKET_CONFIG.SUPPLY_DEMAND_FACTOR;

      // Mean reversion: gently pull price back toward base
      const reversion = (base - state.price) * MARKET_CONFIG.MEAN_REVERSION_FACTOR;

      state.price += randomChange + pressureEffect + reversion;

      // Clamp price
      const minPrice = base * MARKET_CONFIG.PRICE_MIN_RATIO;
      const maxPrice = base * MARKET_CONFIG.PRICE_MAX_RATIO;
      state.price = Math.max(minPrice, Math.min(maxPrice, state.price));

      // Decay supply pressure over time
      state.supplyPressure *= MARKET_CONFIG.SUPPLY_PRESSURE_DECAY;
    }
  }

  toJSON(): Record<string, unknown> {
    const data: Record<string, { price: number; supplyPressure: number }> = {};
    for (const type of Object.values(ResourceType)) {
      data[type] = { ...this.resources[type] };
    }
    return data;
  }

  static fromJSON(data: Record<string, unknown>): GlobalMarket {
    const market = new GlobalMarket();
    for (const type of Object.values(ResourceType)) {
      const saved = data[type] as { price: number; supplyPressure: number } | undefined;
      if (saved) {
        market.resources[type].price = saved.price;
        market.resources[type].supplyPressure = saved.supplyPressure;
      }
    }
    return market;
  }
}
