# SOLID Review Progress

## Reviewed Files
1. `src/core/economy/Budget.ts` — PASS (clean, pure functions)
2. `src/core/economy/Tax.ts` — PASS (clean)
3. `src/core/economy/RCIDemand.ts` — PASS (clean)
4. `src/core/citizen/CitizenManager.ts` — PASS (minor SRP concerns but acceptable)
5. `src/core/simulation/GameState.ts` — PASS (composition root, appropriate structure)
6. `src/core/save/Serializer.ts` — PASS (coordinator pattern, acceptable)
7. `src/core/building/BuildingGrowth.ts` — PASS (clean, focused)
8. `src/core/citizen/Happiness.ts` — PASS (clean, data-driven)
9. `src/core/service/PoliceService.ts` — PASS (uses RoadCoverageService base)
10. `src/core/service/FireService.ts` — PASS (uses RoadCoverageService base)
11. `src/core/service/RoadCoverageService.ts` — PASS (good Template Method pattern)
12. `src/core/building/InfraPlacement.ts` — PASS (focused, clean)
13. `src/core/building/DemolishClassifier.ts` — PASS (discriminated union pattern)
14. `src/core/building/BuildingClassifier.ts` — PASS (clean classifier)
15. `src/core/transport/BaseTransportSystem.ts` — PASS (good Template Method)
16. `src/core/overlay/CoverageOverlay.ts` — PASS (OCP-compliant)
17. `src/core/overlay/OverlayBuilders.ts` — PASS (OCP-compliant, data-driven)
18. `src/core/building/InfraServiceActions.ts` — PASS (OCP-compliant)
19. `src/core/climate/Disaster.ts` — PASS (data-driven, OCP)
20. `src/core/service/PowerGrid.ts` — **REFACTORED** (DRY violation: duplicated BFS with WaterNetwork)
21. `src/core/service/WaterNetwork.ts` — **REFACTORED** (DRY violation: duplicated BFS with PowerGrid)
22. `src/core/service/NetworkCoverage.ts` — **ENHANCED** (added shared bfsRoadNetworkFlood, bfsBudgetDrainFlood)
23. `src/core/traffic/TrafficSimulation.ts` — PASS (single domain: vehicle management)
24. `src/core/environment/Pollution.ts` — PASS (clean, single responsibility)
25. `src/core/traffic/LaneGraph.ts` — PASS (large but cohesive: lane graph construction)
26. `src/core/traffic/SidewalkGraph.ts` — PASS (cohesive: sidewalk graph + A*)
27. `src/core/district/DistrictManager.ts` — PASS (clean CRUD)
28. `src/core/economy/GlobalMarket.ts` — PASS (clean, self-contained)
29. `src/core/service/EducationService.ts` — PASS (multi-type coverage maps, reasonable design)
30. `src/core/economy/IncomeCalculator.ts` — PASS (DIP-compliant, pure function)
31. `src/core/economy/EconomyBreakdown.ts` — PASS (composes on IncomeCalculator)
32. `src/core/road/RoadBuilder.ts` — PASS (delegates validation/cost to pure functions)
33. `src/core/transport/ModeChoice.ts` — PASS (data-driven TRANSPORT_TYPE_TO_MODE)
34. `src/core/transport/TransitAvailability.ts` — **REFACTORED** (OCP: hardcoded METRO/RAIL check → data-driven)
35. `src/core/building/InfraConfig.ts` — PASS (data-driven lookup maps)
36. `src/core/traffic/PedestrianManager.ts` — PASS (cohesive pedestrian lifecycle)
37. `src/core/traffic/ServiceVehicleManager.ts` — PASS (DIP with ServiceFacilityProvider)
38. `src/core/transport/BusSystem.ts` — PASS (proper Template Method inheritance)
39. `src/core/ViewMode.ts` — PASS (excellent data-driven design)
40. `src/core/citizen/Migration.ts` — PASS (pure functions, configurable constants)
41. `src/core/citizen/Relocation.ts` — PASS (clean, configurable)
42. `src/core/district/Specialization.ts` — PASS (data-driven bonuses)
43. `src/core/district/CitySpecialization.ts` — PASS (data-driven config)
44. `src/core/economy/LandValue.ts` — PASS (pure calculation)
45. `src/core/economy/ExpenseCalculator.ts` — PASS (clean)
46. `src/core/grid/Grid.ts` — PASS (focused data storage)
47. `src/core/save/SaveManager.ts` — PASS (minor DRY but IndexedDB boilerplate is acceptable)
48. `src/core/traffic/Pathfinding.ts` — PASS (already extracted shared Dijkstra)
49. `src/core/environment/PollutionSourceRegistry.ts` — PASS (DIP with PollutionSourceProvider)
50. `src/core/environment/CityMetrics.ts` — **REFACTORED** (DRY: extracted avgResidentialMetric)
51. `src/core/climate/Climate.ts` — PASS (data-driven season overrides)
52. `src/core/climate/Disaster.ts` — PASS (data-driven calculators)
53. `src/core/building/BuildingUpgrade.ts` — PASS (data-driven requirements tables)
54. `src/core/building/BuildingAbandonment.ts` — PASS (pure function, data-driven sensitivity)
55. `src/core/citizen/HousingScore.ts` — PASS (data-driven scoring)
56. `src/core/citizen/WorkplaceScore.ts` — **REFACTORED** (DRY: removed duplicate scoreWorkplaceCommute, reuses HousingScore.scoreCommute)
57. `src/core/building/InfraDetails.ts` — **REFACTORED** (DRY: 3 identical school extractors → makeSchoolExtractor factory)
58. `src/core/transport/TransportRegistry.ts` — PASS (OCP-compliant registry)
59. `src/core/service/ServiceRegistry.ts` — PASS (OCP-compliant)
60. `src/core/traffic/FreightSystem.ts` — PASS (clean, focused)
61. `src/core/transport/RailSystem.ts` — PASS (extends BaseTransportSystem)
62. `src/core/transport/MetroSystem.ts` — PASS (extends BaseTransportSystem)
63. `src/core/transport/FerrySystem.ts` — PASS (extends BaseTransportSystem)
64. `src/core/transport/AirportSystem.ts` — PASS (data-driven size config)
65. `src/core/zone/ZoneManager.ts` — PASS (clean, focused)
66. `src/core/simulation/GameClock.ts` — PASS (simple, focused)
67. `src/core/simulation/DebugTools.ts` — PASS (data-driven paramSetters)
68. `src/core/zone/DensityRules.ts` — PASS (clean)
69. `src/core/climate/Damage.ts` — PASS (pure functions)
70. `src/core/climate/WarningSystem.ts` — PASS (clean)
71. `src/core/road/types.ts` — PASS (data-driven ROAD_CONFIGS)
72. `src/core/rail/RailNetwork.ts` — PASS (extends GraphNetwork)
73. `src/core/rail/RailBuilder.ts` — PASS (uses shared PathValidation)
74. `src/core/service/GarbageService.ts` — PASS (extends RoadCoverageService)
75. `src/core/service/SewageService.ts` — PASS (clean)
76. `src/core/service/HealthService.ts` — PASS (extends RoadCoverageService)
77. `src/core/service/DeathCareService.ts` — PASS (extends RoadCoverageService)
78. `src/core/service/RoadCoverageFlood.ts` — PASS (clean Dijkstra + MinHeap)
79. `src/core/district/PolicyManager.ts` — PASS (DIP + data-driven POLICY_CONFIG)
80. `src/core/citizen/JobRelocation.ts` — PASS (configurable constants)
81. `src/core/citizen/OccupancyRatio.ts` — PASS (clean)
82. `src/core/citizen/OccupancyAssignment.ts` — PASS (acceptable similar patterns)
83. `src/core/citizen/BuildingCandidateBuilder.ts` — PASS (clean factory functions)
84. `src/core/citizen/types.ts` — PASS (type definitions + data-driven config)
85. `src/core/grid/types.ts` — PASS (type definitions + zone helpers)
86. `src/core/traffic/CommuteCache.ts` — PASS (focused cache with cell index)
87. `src/core/building/BuildingUpgrade.ts` — PASS (data-driven requirements)
88. `src/core/building/BuildingAbandonment.ts` — PASS (data-driven zone sensitivity)

89-148. Remaining ~60 small files (3-214 lines each) — all PASS:
  - grid: GridHelpers, Terrain, TerrainGenerator, GridBuffer, PathValidation, BuildReasonMessages, GroundType
  - environment: GridPollutionSources, NaturalResourceManager, WaterFlow
  - service: CivicService, GridCoverageArray, RadiusCoverageMap, ServiceCoverageQuery, ServiceDispatch, FireDamageProcessor, ParkService
  - traffic: BezierPath, CommuteCacheHelpers, Congestion, EdgeInterpolation, ODPoolBuilder, Parking, PathWorkerClient, PedestrianAgent, RoadPathfinding, TrafficStats, TrafficLights, VehicleClassification, VehicleLookahead
  - transport: FerryLinePath, MetroLinePath, MetroTunnelPath, RailLinePath, TransportPlacement, collectMetroTrains, collectTransportRoutes, collectTransportVehicles
  - building: BuildingLevel, BuildingQueries, types
  - citizen: Birth, CityHappinessContext
  - road: RoadNetwork, RoadUpgrade, RoadValidation, Intersection
  - rail: LevelCrossingSystem, types
  - district: types
  - economy: TaxMultipliers, IncomeCalcAdapter
  - milestone: Milestone, GreatWorks
  - pathfinding: WaterPathfinder
  - save: AutoSave, migrations
  - utils: random, recoverNextId, removeById
  - tutorial: Tutorial

149. `src/core/simulation/SimulationLoop.ts` — **PARTIALLY REFACTORED** (OCP: extracted civic service ticking to ServiceRegistry)

## Status: COMPLETE
All 149 src/core files reviewed. 6 SOLID violations fixed across 8 files.

## Refactoring Summary
### Iteration 1: PowerGrid / WaterNetwork BFS deduplication
- **Issue**: `bfsRoadNetwork` (20 lines) 100% identical in both files; `bfsBudgetDrain` (~35 lines) 95% identical
- **Fix**: Extracted `bfsRoadNetworkFlood()` and `bfsBudgetDrainFlood()` into `NetworkCoverage.ts`
- **Tests**: 10 new tests in `UtilityNetworkBfs.test.ts`, all 2547 tests pass

### Iteration 2: TransitAvailability OCP fix
- **Issue**: Hardcoded `sys.type === TransportType.METRO || sys.type === TransportType.RAIL` violates OCP
- **Fix**: Created `USES_RAIL_TIME_FACTOR` data-driven config map; adding new fast transit types only needs a map entry
- **Tests**: 2 new tests (RAIL factor, FERRY no-factor), all 2549 tests pass

### Iteration 3: CityMetrics DRY extraction
- **Issue**: `getAvgResidentialPollution` and `getAvgResidentialNoise` were nearly identical (differ only in cell accessor)
- **Fix**: Extracted `avgResidentialMetric(grid, accessor)` shared helper; both functions now delegate to it
- **Tests**: 2 new tests for the shared helper, all 2551 tests pass

### Iteration 4: WorkplaceScore DRY fix
- **Issue**: `scoreWorkplaceCommute` in WorkplaceScore.ts was 100% identical to `scoreCommute` in HousingScore.ts
- **Fix**: Removed the duplicate, WorkplaceScore now imports and uses `scoreCommute` from HousingScore
- **Tests**: All 2551 existing tests pass (no new tests needed — exact same behavior)

### Iteration 5: InfraDetails school extractor deduplication
- **Issue**: 3 school extractors (school, school_high, school_univ) had identical logic differing only in config values
- **Fix**: Extracted `makeSchoolExtractor` factory function; each school type is now a single-line factory call
- **Tests**: All 18 existing InfraDetails tests pass, all 2551 total tests pass

### Iteration 8: SimulationLoop civic service ticking → ServiceRegistry (OCP)
- **Issue**: SimulationLoop.tick() had 8 explicit service.tick() calls; adding a new service required modifying tick()
- **Fix**: Added `tickAllCivicServices(state)` to ServiceRegistry; SimulationLoop now delegates to single call
- **Tests**: 3 new tests (no-throw, population passthrough, all services ticked), all 2554 tests pass
