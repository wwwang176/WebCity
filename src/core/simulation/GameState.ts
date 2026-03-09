import { Grid } from '../grid/Grid';
import { RoadNetwork } from '../road/RoadNetwork';
import { CitizenManager } from '../citizen/CitizenManager';
import { TrafficSimulation } from '../traffic/TrafficSimulation';
import { TrafficLightSystem } from '../traffic/TrafficLights';
import { PowerGrid } from '../service/PowerGrid';
import { WaterNetwork } from '../service/WaterNetwork';
import { GameClock } from './GameClock';
import { type BudgetState } from '../economy/Budget';
import { type TaxRates, DEFAULT_TAX_RATES } from '../economy/Tax';
import { type RCIDemandValues } from '../economy/RCIDemand';
import { BuildingGrowth } from '../building/BuildingGrowth';
import { BuildingUpgrade } from '../building/BuildingUpgrade';
import { PollutionManager } from '../environment/Pollution';
import { PoliceService } from '../service/PoliceService';
import { FireService } from '../service/FireService';
import { HealthService } from '../service/HealthService';
import { EducationService } from '../service/EducationService';
import { ParkService } from '../service/ParkService';
import { GarbageService } from '../service/GarbageService';
import { SewageService } from '../service/SewageService';
import { DeathCareService } from '../service/DeathCareService';

export interface GameState {
  grid: Grid;
  roadNetwork: RoadNetwork;
  citizens: CitizenManager;
  traffic: TrafficSimulation;
  trafficLights: TrafficLightSystem;
  power: PowerGrid;
  water: WaterNetwork;
  clock: GameClock;
  budget: BudgetState;
  taxRates: TaxRates;
  rciDemand: RCIDemandValues;
  buildingGrowth: BuildingGrowth;
  buildingUpgrade: BuildingUpgrade;
  pollution: PollutionManager;
  police: PoliceService;
  fire: FireService;
  health: HealthService;
  education: EducationService;
  parks: ParkService;
  garbage: GarbageService;
  sewage: SewageService;
  deathCare: DeathCareService;
}

export function createGameState(width = 200, height = 200): GameState {
  const grid = new Grid(width, height);
  return {
    grid,
    roadNetwork: new RoadNetwork(),
    citizens: new CitizenManager(),
    traffic: new TrafficSimulation(),
    trafficLights: new TrafficLightSystem(),
    power: new PowerGrid(),
    water: new WaterNetwork(),
    clock: new GameClock(),
    budget: {
      funds: 50000,
      income: 0,
      expenses: 0,
      loans: 0,
      loanInterestRate: 0.05,
    },
    taxRates: { ...DEFAULT_TAX_RATES },
    rciDemand: { residential: 50, commercial: 50, industrial: 50 },
    buildingGrowth: new BuildingGrowth(grid),
    buildingUpgrade: new BuildingUpgrade(grid),
    pollution: new PollutionManager(width, height),
    police: new PoliceService(),
    fire: new FireService(),
    health: new HealthService(),
    education: new EducationService(),
    parks: new ParkService(),
    garbage: new GarbageService(),
    sewage: new SewageService(),
    deathCare: new DeathCareService(),
  };
}
