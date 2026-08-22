/**
 * The per-service coverage readout the building panel shows for one cell.
 *
 * Built in one place because it used to be built in two: `handleSelectClick`
 * and `handleSelectEmptyZone` each listed the services by hand, and the copies
 * drifted until the zone branch was missing `sewage`.
 */

/** Every service the panel can show. Order is the panel's display order. */
export const SERVICE_STATUS_KEYS = [
  'power', 'water', 'sewage', 'police', 'fire',
  'garbage', 'health', 'education', 'deathCare',
] as const;

export type ServiceStatusKey = (typeof SERVICE_STATUS_KEYS)[number];

/**
 * 一格對一個服務的處境。
 *
 * 兩個維度，因為玩家要做的事不一樣:**太遠**要蓋一座近的，**太滿**要蓋一座分流。
 * 只給距離的話，緊鄰一間爆到兩倍的醫院會顯示成最好的狀態（BUG-362）。
 */
export interface ServiceCellStatus {
  /**
   * 沿馬路走過來的成本 ÷ 預算。0 最好、1 最差，`NO_COVERAGE` = 不在範圍內。
   * 水電是二元的:0 接上了、`NO_COVERAGE` 沒接上。
   */
  cost: number;
  /**
   * **服務這一格的那一座設施**現在多滿。1.0 是剛好滿，2.0 是需求兩倍於容量。
   * `NO_COVERAGE` = 問不到（沒有覆蓋，或這個服務沒有負載的概念）。
   *
   * 不夾在 1 —— 超過 1 是有意義的資訊。
   */
  load: number;
}

export type ServiceStatus = Record<ServiceStatusKey, ServiceCellStatus>;

/** Out of range — distinct from a ratio of 0, which means "served, at no cost". */
export const NO_COVERAGE = -1;

interface UtilityCheck { isPowered(x: number, y: number): boolean }
interface SupplyCheck { isSupplied(x: number, y: number): boolean }
interface CoverageCost {
  getCostRatio(x: number, y: number): number;
  /** 服務這一格的那座設施的負載 ÷ 容量。 */
  getLoadRatioAt(x: number, y: number): number;
}

export interface ServiceStatusSources {
  power: UtilityCheck;
  water: SupplyCheck;
  sewage: SupplyCheck;
  police: CoverageCost;
  fire: CoverageCost;
  garbage: CoverageCost;
  health: CoverageCost;
  education: CoverageCost;
  deathCare: CoverageCost;
}

/** 水電那三個沒有逐格的負載概念 —— 接上了就是接上了。 */
function utility(connected: boolean): ServiceCellStatus {
  return { cost: connected ? 0 : NO_COVERAGE, load: NO_COVERAGE };
}

function covered(src: CoverageCost, x: number, y: number): ServiceCellStatus {
  return { cost: src.getCostRatio(x, y), load: src.getLoadRatioAt(x, y) };
}

export function buildServiceStatus(
  s: ServiceStatusSources, x: number, y: number,
): ServiceStatus {
  return {
    power: utility(s.power.isPowered(x, y)),
    water: utility(s.water.isSupplied(x, y)),
    sewage: utility(s.sewage.isSupplied(x, y)),
    police: covered(s.police, x, y),
    fire: covered(s.fire, x, y),
    garbage: covered(s.garbage, x, y),
    health: covered(s.health, x, y),
    education: covered(s.education, x, y),
    deathCare: covered(s.deathCare, x, y),
  };
}
