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

const IMPORT_MARKUP = 1.1; // 10% markup on imports
const PRICE_MIN_RATIO = 0.2; // Price won't go below 20% of base
const PRICE_MAX_RATIO = 3.0; // Price won't go above 300% of base
const VOLATILITY = 0.02; // Random price fluctuation per tick
const SUPPLY_DEMAND_FACTOR = 0.005; // How much trade affects price
const MEAN_REVERSION_FACTOR = 0.01; // Pull price back toward base
const SUPPLY_PRESSURE_DECAY = 0.9; // Decay factor per tick

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
    const cost = this.resources[type].price * quantity * IMPORT_MARKUP;
    this.resources[type].supplyPressure -= quantity;
    return Math.round(cost * 100) / 100;
  }

  tick(): void {
    for (const type of Object.values(ResourceType)) {
      const state = this.resources[type];
      const base = BASE_PRICES[type];

      // Random market fluctuation
      const randomChange = (Math.random() - 0.5) * 2 * VOLATILITY * base;

      // Supply/demand pressure effect
      const pressureEffect = -state.supplyPressure * SUPPLY_DEMAND_FACTOR;

      // Mean reversion: gently pull price back toward base
      const reversion = (base - state.price) * MEAN_REVERSION_FACTOR;

      state.price += randomChange + pressureEffect + reversion;

      // Clamp price
      const minPrice = base * PRICE_MIN_RATIO;
      const maxPrice = base * PRICE_MAX_RATIO;
      state.price = Math.max(minPrice, Math.min(maxPrice, state.price));

      // Decay supply pressure over time
      state.supplyPressure *= SUPPLY_PRESSURE_DECAY;
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
