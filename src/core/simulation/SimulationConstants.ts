/**
 * Simulation tuning constants — extracted from SimulationLoop to break
 * circular dependencies (CityHappinessContext/CityMetrics → SimulationLoop).
 */

import { DEFAULT_TAX_RATE } from '../economy/Tax';

/** Simulation tuning constants */
export const SIMULATION = {
  /** Ticks between service/RCI/growth updates */
  SLOW_TICK_INTERVAL: 6,
  /** Ticks between heavier computations: pollution, land value, vehicle spawning */
  MEDIUM_TICK_INTERVAL: 60,

  /**
   * How many ticks the congestion-flow recomputation is spread over.
   *
   * Smaller than MEDIUM_TICK_INTERVAL: a sweep must finish before the next one starts,
   * otherwise it never publishes a result.
   */
  CONGESTION_FLOW_SPREAD_TICKS: 40,
  /** Ticks between job relocation checks */
  JOB_RELOCATION_INTERVAL: 60,
  /**
   * How many batches housing relocation is split into. One batch per slow slot.
   *
   * The expensive part is evaluation, not the move: every unhappy citizen scores every
   * housing candidate in the city, while the 5% relocation cap only limits citizens who
   * actually move. Measured at 120,000 citizens, one pass took 195ms against 250ms available
   * per tick at speed 1.
   *
   * `10 * SLOW_TICK_INTERVAL = 60`, so each citizen comes up **once every 60 ticks**,
   * identical to the unsliced `MEDIUM_TICK_INTERVAL` cadence. What changes is one 195ms pass
   * becoming ten 20ms ones.
   *
   * Do not turn this into "one batch's list walked slowly over dozens of ticks": that keeps
   * the housing candidates, the occupancy counts and the list of who is still alive valid for
   * dozens of ticks, and produced new bugs through three rounds of fixes (BUG-331). Each
   * batch takes, uses and discards its snapshots **within a single tick**, which is what
   * makes that whole class of problem impossible.
   */
  HOUSING_RELOCATION_SLICES: 10,
  /** Number of random cells sampled per growth tick */
  GROWTH_ATTEMPTS: 20,
  /** Chance per attempt for burned building auto-clearance */
  BURNED_CLEARANCE_CHANCE: 0.02,
  /** Default happiness used when city has no citizens */
  DEFAULT_HAPPINESS: 70,
  /** Business tax baseline — penalty applies above this rate */
  BUSINESS_TAX_BASELINE: DEFAULT_TAX_RATE,
  /** Demand penalty per percentage point above baseline */
  BUSINESS_TAX_PENALTY_PER_POINT: 2,
  /** Crime: max base crime rate */
  CRIME_BASE_MAX: 50,
  /** Crime: population factor for base crime */
  CRIME_POP_FACTOR: 0.02,
  /** Crime: coverage factor per police station */
  CRIME_COVERAGE_PER_STATION: 0.15,
  /** Crime: max reduction from police coverage */
  CRIME_MAX_REDUCTION: 0.6,
  /** Commute: max estimated average commute */
  COMMUTE_MAX: 25,
  /** Commute: base commute distance */
  COMMUTE_BASE: 1,
  /** Commute: multiplier for sqrt(resCount) */
  COMMUTE_SPREAD_FACTOR: 0.7,
  /** Commute: random jitter range */
  COMMUTE_JITTER: 6,
  /** Service coverage: power weight */
  SERVICE_POWER_WEIGHT: 2,
  /** Service coverage: water weight */
  SERVICE_WATER_WEIGHT: 2,
  /** Pollution threshold for service coverage bonus */
  LOW_POLLUTION_THRESHOLD: 10,
  /** Cell value maximum (uint8 range) */
  CELL_VALUE_MAX: 255,
  /** Vehicle cap: maximum vehicles on road */
  VEHICLE_CAP_MAX: 2000,
  /** Vehicle cap: base count */
  VEHICLE_CAP_BASE: 20,
  /** Vehicle cap: fraction of population */
  VEHICLE_CAP_POP_RATIO: 0.3,
  /** Ticks over which to spread commute spawning (higher = fewer vehicles per tick) */
  SPAWN_SPREAD_TICKS: 8,
  /** Minimum commute spawns per tick */
  MIN_SPAWN_PER_TICK: 5,
  /**
   * How many citizens the background commute fill examines per tick.
   *
   * Queueing and computing each have their own budget, but once a budget is exhausted the
   * loop still walks the whole list: measured on a 12,351-citizen save, 46-66% of main-thread
   * time in the first 11 seconds after entering the game went to "examined, nothing to do"
   * (BUG-329).
   *
   * Large enough to fill all 32 queue slots during warmup (when almost nobody has a computed
   * route), small enough to scan within a tick. 1024 is a six-tick cycle for a
   * 12,000-citizen city.
   */
  COMMUTE_FILL_SCAN_PER_TICK: 1024,

  /**
   * How many **synchronous** path searches the background commute fill may run per tick.
   *
   * One `findLanePathVariants` measured at about 16ms in a 2,146-citizen city (up to 4 A*
   * runs internally), against 250ms per tick at speed 1, so 2 already consume more than a
   * tenth. This is the only path available without a pathfinding worker (production without
   * COOP/COEP has no SharedArrayBuffer), so the slowness is deliberate: finishing matters
   * more than finishing fast.
   */
  COMMUTE_FILL_SEARCH_PER_TICK: 2,
  /** Routes queued per tick when a worker is available. Queueing is cheap and the work
   *  happens on another thread. */
  COMMUTE_FILL_ENQUEUE_PER_TICK: 32,
  /** How many attempts a single route gets before it is left until the road network changes.
   *  See `commuteFillAttempts`. */
  COMMUTE_FILL_MAX_ATTEMPTS: 3,
  /** How many worst-commute residential areas the overview panel lists. Enough to point at
   *  the problem without becoming a page of coordinates. */
  COMMUTE_WORST_HOMES: 5,
  /** Commute sampling: minimum sample count */
  SAMPLE_COUNT_MIN: 50,
  /** Commute sampling: maximum sample count */
  SAMPLE_COUNT_MAX: 300,
  /** Commute sampling: eligible commuters per sample */
  SAMPLE_DIVISOR: 5,
  // Walk limits to stops are per transport type; see core/transport/WalkRange. A single
  // global number would give bus stops and metro stations identical catchments.
  /** Max Manhattan distance for transfer walks between stops of different routes */
  TRANSFER_WALK_RANGE: 3,
  /**
   * Reference driving speed in km/h. One tile per tick in the model is this speed.
   *
   * **Not the speed limit** but the real door-to-door average, including junctions, turns
   * and parking. The limit is 50 (100 on motorways), but nobody completes a commute at the
   * limit. The congestion term (`driveTime = distance * (1 + congestion)`) sits on top of
   * this average and represents being more congested than usual.
   *
   * This number is the denominator of the entire time scale. Using the speed limit as the
   * reference makes walking so expensive that only citizens next door to a stop use transit,
   * leaving the transport network inert.
   */
  DRIVE_REFERENCE_KMH: 30,
  /** Walking speed in km/h. */
  WALK_KMH: 9,
  /**
   * Walking speed in tiles per tick.
   *
   * Derived from the two constants above rather than written separately. At 1, walking would
   * be as fast as driving and a tile walked to a stop would cost the same as a tile driven,
   * making a long walk to transit free with only the hard walk limit standing in the way.
   */
  WALK_SPEED: 9 / 30,
  /** Maximum legs per multi-modal trip (walk counts as a leg) */
  MAX_TRIP_LEGS: 7,
  /** Average wait = headway × this factor */
  AVERAGE_WAIT_FACTOR: 0.5,
  /** Industrial zone pollution reduction factor */
  INDUSTRIAL_POLLUTION_FACTOR: 0.2,
  /** Export demand base value for RCI calculation */
  EXPORT_DEMAND: 10,
  /** Fallback resident count when building type lookup fails */
  FALLBACK_RESIDENTS: 8,
  /** Population threshold before shopping access affects happiness */
  SHOPPING_POP_THRESHOLD: 50,
  /** Number of random cells sampled per upgrade tick */
  UPGRADE_ATTEMPTS: 30,
  /** Fraction of vehicle cap reserved for freight */
  FREIGHT_CAP_RATIO: 0.15,
  /** Throughput units per concurrent freight truck at a trade node */
  FREIGHT_TRUCKS_PER_THROUGHPUT: 10,
  /** Minimum Manhattan distance for commute trip */
  MANHATTAN_DISTANCE_THRESHOLD: 3,
  /** Abandonment: service normalization max (residential) */
  SERVICE_MAX_RES: 10,
  /** Abandonment: service normalization max (non-residential) */
  SERVICE_MAX_NON_RES: 6,
} as const;
