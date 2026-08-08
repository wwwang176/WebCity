import { createGameState, type GameState } from '../simulation/GameState';
import { type CellData, isCellDefault, getCellDiff } from '../grid/types';
import { type GameSpeed } from '../simulation/GameClock';
import { RoadType } from '../road/types';
import { type PowerPlant } from '../service/PowerGrid';
import { type WaterPlant } from '../service/WaterNetwork';
import { type Citizen } from '../citizen/types';
import { PoliceService } from '../service/PoliceService';
import { FireService } from '../service/FireService';
import { HealthService } from '../service/HealthService';
import { EducationService } from '../service/EducationService';
import { ParkService } from '../service/ParkService';
import { GarbageService } from '../service/GarbageService';
import { SewageService } from '../service/SewageService';
import { DeathCareService } from '../service/DeathCareService';
import { getInfraConfigById, getInfraBuildingId } from '../building/InfraConfig';
import { MULTI_CELL_OCCUPIED } from '../building/InfraPlacement';
import { Grid } from '../grid/Grid';
import { BusSystem } from '../transport/BusSystem';
import { MetroSystem } from '../transport/MetroSystem';
import { RailSystem } from '../transport/RailSystem';
import { FerrySystem } from '../transport/FerrySystem';
import { AirportSystem } from '../transport/AirportSystem';
import { HighwayConnection } from '../traffic/HighwayConnection';
import { DistrictManager } from '../district/DistrictManager';
import { PolicyManager } from '../district/PolicyManager';
import { CitySpecialization } from '../district/CitySpecialization';
import { GlobalMarket } from '../economy/GlobalMarket';
import { CURRENT_SAVE_VERSION, runMigrations, migrateSavedCitizens } from './migrations';

interface SerializedCell {
  x: number;
  y: number;
  data: Partial<CellData>;
}

interface SerializedState {
  version: number;
  grid: {
    width: number;
    height: number;
    cells: SerializedCell[];
  };
  clock: {
    tick: number;
    speed: GameSpeed;
    paused: boolean;
  };
  budget: {
    funds: number;
    income: number;
    expenses: number;
    loans: number;
    loanInterestRate: number;
  };
  taxRates: {
    residential: number;
    commercial: number;
    industrial: number;
    office: number;
    business?: number; // Added in tax refactor; optional for backward compat with old saves
  };
  powerPlants?: PowerPlant[];
  waterPlants?: WaterPlant[];
  citizens?: Citizen[];
  police?: ReturnType<PoliceService['toJSON']>;
  fire?: ReturnType<FireService['toJSON']>;
  health?: ReturnType<HealthService['toJSON']>;
  education?: ReturnType<EducationService['toJSON']>;
  parks?: ReturnType<ParkService['toJSON']>;
  garbage?: ReturnType<GarbageService['toJSON']>;
  sewage?: ReturnType<SewageService['toJSON']>;
  deathCare?: ReturnType<DeathCareService['toJSON']>;
  bus?: ReturnType<BusSystem['toJSON']>;
  metro?: ReturnType<MetroSystem['toJSON']>;
  rail?: ReturnType<RailSystem['toJSON']>;
  ferry?: ReturnType<FerrySystem['toJSON']>;
  airport?: ReturnType<AirportSystem['toJSON']>;
  highwayConnection?: ReturnType<HighwayConnection['toJSON']>;
  districts?: ReturnType<DistrictManager['toJSON']>;
  policies?: ReturnType<PolicyManager['toJSON']>;
  citySpec?: ReturnType<CitySpecialization['toJSON']>;
  globalMarket?: ReturnType<GlobalMarket['toJSON']>;
  elevation?: Array<{ x: number; y: number; level: number; data: import('../elevation/types').ElevatedSegment }>;
  abandonmentStress?: Record<string, number>;
  /** Rolling 7-day transfer usage history + current day + ring index */
  highestMilestonePop?: number;
  transferHistory?: {
    history: Array<Record<string, number>>;
    index: number;
    today: Record<string, number>;
    pedsSnapshot: number;
    lastDay: number;
  };
}

/** Build a plain-object snapshot of the game state (no stringify). */
export function snapshotGameState(
  state: GameState,
  extra?: {
    abandonmentStress?: Map<string, number>;
    elevationManager?: import('../elevation/ElevationManager').ElevationManager;
    transferHistory?: { history: Map<string, number>[]; index: number; today: Map<string, number>; pedsSnapshot: number; lastDay: number };
    /** Highest milestone population ever reached — see Game.checkMilestone. */
    highestMilestonePop?: number;
  },
): SerializedState {
  const cells: SerializedCell[] = [];

  state.grid.forEachCell((cell, x, y) => {
    if (!isCellDefault(cell)) {
      cells.push({ x, y, data: getCellDiff(cell) });
    }
  });

  return {
    version: CURRENT_SAVE_VERSION,
    grid: {
      width: state.grid.width,
      height: state.grid.height,
      cells,
    },
    clock: {
      tick: state.clock.tick,
      speed: 1,
      paused: false,
    },
    budget: {
      funds: state.budget.funds,
      income: state.budget.income,
      expenses: state.budget.expenses,
      loans: state.budget.loans,
      loanInterestRate: state.budget.loanInterestRate,
    },
    taxRates: {
      residential: state.taxRates.residential,
      commercial: state.taxRates.commercial,
      industrial: state.taxRates.industrial,
      office: state.taxRates.office,
      business: state.taxRates.business,
    },
    powerPlants: [...state.power.getPlants()],
    waterPlants: [...state.water.getPlants()],
    citizens: state.citizens.getCitizens().map(c => ({ ...c })),
    police: state.police.toJSON(),
    fire: state.fire.toJSON(),
    health: state.health.toJSON(),
    education: state.education.toJSON(),
    parks: state.parks.toJSON(),
    garbage: state.garbage.toJSON(),
    sewage: state.sewage.toJSON(),
    deathCare: state.deathCare.toJSON(),
    bus: state.bus.toJSON(),
    metro: state.metro.toJSON(),
    rail: state.rail.toJSON(),
    ferry: state.ferry.toJSON(),
    airport: state.airport.toJSON(),
    highwayConnection: state.highwayConnection.toJSON(),
    districts: state.districts.toJSON(),
    policies: state.policies.toJSON(),
    citySpec: state.citySpec.toJSON(),
    globalMarket: state.globalMarket.toJSON(),
    elevation: extra?.elevationManager?.toJSON(),
    abandonmentStress: extra?.abandonmentStress
      ? Object.fromEntries(extra.abandonmentStress)
      : undefined,
    highestMilestonePop: extra?.highestMilestonePop,
    transferHistory: extra?.transferHistory
      ? {
          history: extra.transferHistory.history.map(m => Object.fromEntries(m)),
          index: extra.transferHistory.index,
          today: Object.fromEntries(extra.transferHistory.today),
          pedsSnapshot: extra.transferHistory.pedsSnapshot,
          lastDay: extra.transferHistory.lastDay,
        }
      : undefined,
  };
}

/** Serialize game state to JSON string (snapshot + stringify). */
export function serializeGameState(
  state: GameState,
  // Taken from snapshotGameState rather than restated: this wrapper's own copy
  // went stale and rejected `transferHistory` / `highestMilestonePop`, which
  // snapshotGameState has handled since they were added.
  extra?: Parameters<typeof snapshotGameState>[1],
): string {
  return JSON.stringify(snapshotGameState(state, extra));
}

export interface DeserializedExtra {
  abandonmentStress: Map<string, number>;
  /** Highest milestone population ever reached — see Game.checkMilestone. */
  highestMilestonePop?: number;
  elevationData?: Array<{ x: number; y: number; level: number; data: import('../elevation/types').ElevatedSegment }>;
  transferHistory?: { history: Map<string, number>[]; index: number; today: Map<string, number>; pedsSnapshot: number; lastDay: number };
}

export function deserializeGameState(json: string): GameState & { _extra?: DeserializedExtra } {
  const saved: SerializedState = JSON.parse(json) as SerializedState;

  const state = createGameState(saved.grid.width, saved.grid.height);

  // Restore grid cells
  for (const entry of saved.grid.cells) {
    state.grid.setCell(entry.x, entry.y, entry.data);
  }

  // Restore clock
  state.clock.tick = saved.clock.tick;
  state.clock.speed = saved.clock.speed;
  state.clock.paused = saved.clock.paused;

  // Restore budget
  state.budget.funds = saved.budget.funds;
  state.budget.income = saved.budget.income;
  state.budget.expenses = saved.budget.expenses;
  state.budget.loans = saved.budget.loans;
  state.budget.loanInterestRate = saved.budget.loanInterestRate;

  // Restore tax rates
  state.taxRates.residential = saved.taxRates.residential;
  state.taxRates.commercial = saved.taxRates.commercial;
  state.taxRates.industrial = saved.taxRates.industrial;
  state.taxRates.office = saved.taxRates.office;
  // Backward compat: old saves may not have business field; default to residential rate
  state.taxRates.business = saved.taxRates.business ?? saved.taxRates.residential;

  // Restore power/water plants
  if (saved.powerPlants) {
    for (const p of saved.powerPlants) state.power.addPlant(p);
  }
  if (saved.waterPlants) {
    for (const p of saved.waterPlants) state.water.addPlant(p);
  }

  // Restore citizens. The legacy age conversion has to happen on the raw payload
  // first — restoreCitizen fabricates a birthTick, which destroys the only signal
  // that identifies a legacy citizen (BUG-055). Passing the saved tick also means
  // any fabricated birthTick encodes the age at save time rather than at tick 0.
  migrateSavedCitizens(saved.citizens, saved.version ?? 0, saved.clock.tick);
  if (saved.citizens) {
    for (const c of saved.citizens) state.citizens.restoreCitizen(c, saved.clock.tick);
  }

  // Restore civic services
  if (saved.police) state.police = PoliceService.fromJSON(saved.police);
  if (saved.fire) state.fire = FireService.fromJSON(saved.fire);
  if (saved.health) state.health = HealthService.fromJSON(saved.health);
  if (saved.education) state.education = EducationService.fromJSON(saved.education);
  if (saved.parks) state.parks = ParkService.fromJSON(saved.parks);
  if (saved.garbage) state.garbage = GarbageService.fromJSON(saved.garbage);
  if (saved.sewage) state.sewage = SewageService.fromJSON(saved.sewage);
  if (saved.deathCare) state.deathCare = DeathCareService.fromJSON(saved.deathCare);

  // Migrate old 1×1 infrastructure to multi-cell
  migrateOldInfra(state.grid);

  // Restore transport systems (new format with full state, or fallback to grid-scan)
  if (saved.bus) {
    state.bus = BusSystem.fromJSON(saved.bus);
  }
  if (saved.metro) {
    state.metro = MetroSystem.fromJSON(saved.metro);
  }
  if (saved.rail) {
    state.rail = RailSystem.fromJSON(saved.rail);
  }
  if (saved.ferry) {
    state.ferry = FerrySystem.fromJSON(saved.ferry);
  }
  if (saved.airport) {
    state.airport = AirportSystem.fromJSON(saved.airport);
  }
  if (saved.highwayConnection) {
    state.highwayConnection = HighwayConnection.fromJSON(saved.highwayConnection);
  }

  // Restore districts / policies / city specialization / market.
  // PolicyManager holds a reference to the DistrictManager, so replacing the
  // latter *must* rebuild the former or policies would query the discarded
  // (empty) manager. Old saves simply have no data here and keep the defaults.
  if (saved.districts) {
    state.districts = DistrictManager.fromJSON(saved.districts);
    state.policies = new PolicyManager(state.districts);
  }
  state.policies.restore(saved.policies);
  if (saved.citySpec) {
    state.citySpec = CitySpecialization.fromJSON(saved.citySpec);
  }
  if (saved.globalMarket) {
    state.globalMarket = GlobalMarket.fromJSON(saved.globalMarket);
  }

  // Fallback: rebuild transit stops from grid for old saves without transport data
  if (!saved.bus && !saved.metro && !saved.rail && !saved.ferry) {
    state.grid.forEachCell((cell, x, y) => {
      if (cell.buildingId === getInfraBuildingId('bus_stop')) state.bus.addStop(x, y);
      else if (cell.buildingId === getInfraBuildingId('metro_station')) state.metro.addStation(x, y);
      else if (cell.buildingId === getInfraBuildingId('train_station')) state.rail.buildStation(x, y);
      else if (cell.buildingId === getInfraBuildingId('ferry_dock')) state.ferry.addDock(x, y);
    });
  }

  // Run save migrations for older versions
  const saveVersion = saved.version ?? 0;
  if (saveVersion < CURRENT_SAVE_VERSION) {
    runMigrations(state, saveVersion);
  }

  // Restore abandonment stress (backward compat: missing field → empty Map)
  const extra: DeserializedExtra = {
    abandonmentStress: saved.abandonmentStress
      ? new Map(Object.entries(saved.abandonmentStress).map(([k, v]) => [k, Number(v)]))
      : new Map(),
    elevationData: saved.elevation,
    highestMilestonePop: saved.highestMilestonePop,
    transferHistory: saved.transferHistory
      ? {
          history: saved.transferHistory.history.map(obj => new Map(Object.entries(obj).map(([k, v]) => [k, Number(v)]))),
          index: saved.transferHistory.index,
          today: new Map(Object.entries(saved.transferHistory.today).map(([k, v]) => [k, Number(v)])),
          pedsSnapshot: saved.transferHistory.pedsSnapshot,
          lastDay: saved.transferHistory.lastDay,
        }
      : undefined,
  };

  return Object.assign(state, { _extra: extra });
}

/**
 * Migrate old saves where infrastructure was stored as 1×1 cells.
 * Detects infrastructure buildingIds without secondary cells (reserved=4)
 * and expands them to their proper multi-cell footprint.
 */
function migrateOldInfra(grid: Grid): void {
  grid.forEachCell((cell, x, y) => {
    if (cell.buildingId === 0) return;

    const cfg = getInfraConfigById(cell.buildingId);
    if (!cfg || cfg.width === 1 && cfg.height === 1) return;

    if (cell.reserved === MULTI_CELL_OCCUPIED) return;

    // Check if secondary cells already exist (new save format)
    let hasSecondary = false;
    for (let dy = 0; dy < cfg.height && !hasSecondary; dy++) {
      for (let dx = 0; dx < cfg.width && !hasSecondary; dx++) {
        if (dx === 0 && dy === 0) continue;
        const sc = grid.getCell(x + dx, y + dy);
        if (sc && sc.buildingId === cfg.buildingId && sc.reserved === MULTI_CELL_OCCUPIED) {
          hasSecondary = true;
        }
      }
    }
    if (hasSecondary) return;

    // Old save: expand to multi-cell. Check if all secondary cells are free.
    let canExpand = true;
    for (let dy = 0; dy < cfg.height && canExpand; dy++) {
      for (let dx = 0; dx < cfg.width && canExpand; dx++) {
        if (dx === 0 && dy === 0) continue;
        const sc = grid.getCell(x + dx, y + dy);
        if (!sc || sc.buildingId !== 0 || sc.roadType !== RoadType.NONE) {
          canExpand = false;
        }
      }
    }
    if (!canExpand) return;

    // Fill secondary cells
    for (let dy = 0; dy < cfg.height; dy++) {
      for (let dx = 0; dx < cfg.width; dx++) {
        if (dx === 0 && dy === 0) continue;
        grid.setCell(x + dx, y + dy, {
          buildingId: cfg.buildingId,
          reserved: MULTI_CELL_OCCUPIED,
          // setCell is a partial patch: without this the zoneType the cell had
          // before the facility claimed it survives, and the v7 migration
          // would be undone on the very next load (BUG-074).
          zoneType: 0,
        });
      }
    }
  });
}
