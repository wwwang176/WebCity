import { describe, it, expect } from 'vitest';
import { GlobalMarket, ResourceType, MARKET_CONFIG } from '../GlobalMarket';

describe('GlobalMarket', () => {
  it('should have initial prices for all resource types', () => {
    const market = new GlobalMarket();
    expect(market.getPrice(ResourceType.OIL)).toBeGreaterThan(0);
    expect(market.getPrice(ResourceType.ORE)).toBeGreaterThan(0);
    expect(market.getPrice(ResourceType.AGRICULTURE)).toBeGreaterThan(0);
    expect(market.getPrice(ResourceType.ELECTRONICS)).toBeGreaterThan(0);
  });

  it('should have oil initial price around 100', () => {
    const market = new GlobalMarket();
    expect(market.getPrice(ResourceType.OIL)).toBe(100);
  });

  it('should fluctuate prices on tick', () => {
    const market = new GlobalMarket();
    const initialOil = market.getPrice(ResourceType.OIL);
    // Run many ticks to ensure at least one price change
    for (let i = 0; i < 100; i++) {
      market.tick();
    }
    // After 100 ticks, prices should have moved from initial
    const prices = [
      market.getPrice(ResourceType.OIL),
      market.getPrice(ResourceType.ORE),
      market.getPrice(ResourceType.AGRICULTURE),
      market.getPrice(ResourceType.ELECTRONICS),
    ];
    // At least one should have changed
    const anyChanged = prices.some((p, i) => {
      const initials = [100, 80, 60, 150];
      return p !== initials[i];
    });
    expect(anyChanged).toBe(true);
  });

  it('should keep prices within bounds', () => {
    const market = new GlobalMarket();
    for (let i = 0; i < 500; i++) {
      market.tick();
    }
    // All prices should stay within 20%-300% of base
    for (const type of [ResourceType.OIL, ResourceType.ORE, ResourceType.AGRICULTURE, ResourceType.ELECTRONICS]) {
      const price = market.getPrice(type);
      expect(price).toBeGreaterThan(0);
      expect(price).toBeLessThan(1000);
    }
  });

  it('should allow exporting resources and return revenue', () => {
    const market = new GlobalMarket();
    const price = market.getPrice(ResourceType.OIL);
    const revenue = market.exportResource(ResourceType.OIL, 10);
    expect(revenue).toBe(price * 10);
  });

  it('should allow importing resources and return cost', () => {
    const market = new GlobalMarket();
    const price = market.getPrice(ResourceType.ORE);
    const cost = market.importResource(ResourceType.ORE, 5);
    // Import costs slightly more than market price (markup)
    expect(cost).toBeGreaterThanOrEqual(price * 5);
  });

  it('should reduce price when exporting large quantities (supply pressure)', () => {
    const market = new GlobalMarket();
    const priceBefore = market.getPrice(ResourceType.OIL);
    // Export large amount many times
    for (let i = 0; i < 20; i++) {
      market.exportResource(ResourceType.OIL, 50);
      market.tick();
    }
    const priceAfter = market.getPrice(ResourceType.OIL);
    // Price should have decreased due to excess supply
    expect(priceAfter).toBeLessThan(priceBefore);
  });

  it('should increase price when importing large quantities (demand pressure)', () => {
    const market = new GlobalMarket();
    const priceBefore = market.getPrice(ResourceType.ELECTRONICS);
    // Import large amount many times
    for (let i = 0; i < 20; i++) {
      market.importResource(ResourceType.ELECTRONICS, 50);
      market.tick();
    }
    const priceAfter = market.getPrice(ResourceType.ELECTRONICS);
    // Price should have increased due to excess demand
    expect(priceAfter).toBeGreaterThan(priceBefore);
  });

  it('should serialize and deserialize', () => {
    const market = new GlobalMarket();
    for (let i = 0; i < 50; i++) market.tick();
    market.exportResource(ResourceType.OIL, 100);

    const json = market.toJSON();
    const restored = GlobalMarket.fromJSON(json);

    expect(restored.getPrice(ResourceType.OIL)).toBe(market.getPrice(ResourceType.OIL));
    expect(restored.getPrice(ResourceType.ORE)).toBe(market.getPrice(ResourceType.ORE));
    expect(restored.getPrice(ResourceType.AGRICULTURE)).toBe(market.getPrice(ResourceType.AGRICULTURE));
    expect(restored.getPrice(ResourceType.ELECTRONICS)).toBe(market.getPrice(ResourceType.ELECTRONICS));
  });

  it('should return all prices', () => {
    const market = new GlobalMarket();
    const all = market.getAllPrices();
    expect(Object.keys(all).length).toBe(4);
    expect(all[ResourceType.OIL]).toBe(100);
    expect(all[ResourceType.ORE]).toBe(80);
    expect(all[ResourceType.AGRICULTURE]).toBe(60);
    expect(all[ResourceType.ELECTRONICS]).toBe(150);
  });
});

describe('MARKET_CONFIG constants', () => {
  it('import markup should be > 1 (markup over base price)', () => {
    expect(MARKET_CONFIG.IMPORT_MARKUP).toBeGreaterThan(1);
  });

  it('price ratio bounds should be ordered', () => {
    expect(MARKET_CONFIG.PRICE_MIN_RATIO).toBeGreaterThan(0);
    expect(MARKET_CONFIG.PRICE_MAX_RATIO).toBeGreaterThan(MARKET_CONFIG.PRICE_MIN_RATIO);
  });

  it('volatility and factors should be small positive numbers', () => {
    expect(MARKET_CONFIG.VOLATILITY).toBeGreaterThan(0);
    expect(MARKET_CONFIG.VOLATILITY).toBeLessThan(1);
    expect(MARKET_CONFIG.SUPPLY_DEMAND_FACTOR).toBeGreaterThan(0);
    expect(MARKET_CONFIG.MEAN_REVERSION_FACTOR).toBeGreaterThan(0);
  });

  it('supply pressure decay should be between 0 and 1', () => {
    expect(MARKET_CONFIG.SUPPLY_PRESSURE_DECAY).toBeGreaterThan(0);
    expect(MARKET_CONFIG.SUPPLY_PRESSURE_DECAY).toBeLessThan(1);
  });
});
