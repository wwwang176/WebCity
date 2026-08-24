import type { InfraType } from '../../../../core/building/InfraConfig';
import type { CivicPlan } from '../types';
import { policePlan } from './police';
import { firePlan } from './fire';
import { hospitalPlan } from './hospital';
import { schoolPlan } from './school';
import { highSchoolPlan } from './schoolHigh';
import { universityPlan } from './schoolUniv';
import { parkPlan } from './park';
import { cemeteryPlan } from './cemetery';
import { powerPlan } from './power';
import { waterPlan } from './water';
import { garbagePlan } from './garbage';
import { sewagePlan } from './sewage';
import {
  busStopPlan, metroStationPlan, trainStationPlan, ferryDockPlan,
} from './transit';
import {
  airportSmallPlan, airportMediumPlan, airportLargePlan,
} from './airport';

/**
 * The civic buildings that have been converted.
 *
 * **A static table, not side-effect registration.** Side-effect registration, where each model
 * file calls `registerCivicPlan` at load, fails silently: nothing imports that file, that
 * building type does not exist, and on screen it reads only as "the one I changed did not show
 * up". A static table turns "is it wired in" into a type-level question — a missing row is one
 * fewer entry in the menu, and that is visible.
 *
 * One building per file (spec section 4.5): each mass description runs 80 to 150 lines with its
 * comments, and together they would be a second 2929-line `BuildingRenderer.ts`.
 *
 * The table is filled in batches. Types absent from it stay on `BuildingRenderer`'s older
 * hand-written `MeshLambertMaterial` path, so a partial state is usable and all 19 need not be
 * finished first.
 */
export const CIVIC_MODELS: Partial<Record<InfraType, CivicPlan>> = {
  // Batch 1: everyday services (police, fire, hospital, primary, high school, university)
  police: policePlan,
  fire: firePlan,
  hospital: hospitalPlan,
  school: schoolPlan,
  school_high: highSchoolPlan,
  school_univ: universityPlan,
  // Batch 2: green space (park, cemetery)
  park: parkPlan,
  cemetery: cemeteryPlan,
  // Batch 3: utilities (power plant, water plant, landfill, sewage plant)
  power: powerPlan,
  water: waterPlan,
  garbage: garbagePlan,
  sewage: sewagePlan,
  // Batch 4: transit stops (bus stop, metro station, train station, ferry terminal)
  bus_stop: busStopPlan,
  metro_station: metroStationPlan,
  train_station: trainStationPlan,
  ferry_dock: ferryDockPlan,
  // Batch 5: airports (small, medium, large)
  airport_s: airportSmallPlan,
  airport_m: airportMediumPlan,
  airport_l: airportLargePlan,
};
