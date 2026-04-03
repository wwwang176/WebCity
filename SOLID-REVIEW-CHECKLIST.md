# SOLID Review Checklist - Round 1

## core/simulation
- [ ] SimulationLoop.ts
- [ ] SimulationConstants.ts
- [ ] GameState.ts
- [ ] GameClock.ts
- [ ] DebugTools.ts

## core/grid
- [ ] Grid.ts
- [ ] GridBuffer.ts
- [ ] GridHelpers.ts
- [ ] Terrain.ts
- [ ] TerrainGenerator.ts
- [ ] GroundType.ts
- [ ] PathValidation.ts
- [ ] EdgeUtils.ts
- [ ] BuildReasonMessages.ts
- [ ] types.ts

## core/building
- [ ] BuildingGrowth.ts
- [ ] BuildingClassifier.ts
- [ ] BuildingLevel.ts
- [ ] BuildingAbandonment.ts
- [ ] BuildingQueries.ts
- [ ] BuildingUpgrade.ts
- [ ] DemolishClassifier.ts
- [ ] InfraConfig.ts
- [ ] InfraDetails.ts
- [ ] InfraPlacement.ts
- [ ] InfraServiceActions.ts
- [ ] types.ts

## core/citizen
- [ ] CitizenManager.ts
- [ ] Birth.ts
- [ ] BuildingCandidateBuilder.ts
- [ ] CitizenHealth.ts
- [ ] CityHappinessContext.ts
- [ ] Happiness.ts
- [ ] HousingScore.ts
- [ ] JobRelocation.ts
- [ ] Migration.ts
- [ ] OccupancyAssignment.ts
- [ ] OccupancyRatio.ts
- [ ] Relocation.ts
- [ ] WorkplaceScore.ts
- [ ] types.ts

## core/economy
- [ ] Budget.ts
- [ ] EconomyBreakdown.ts
- [ ] ExpenseCalculator.ts
- [ ] GlobalMarket.ts
- [ ] IncomeCalcAdapter.ts
- [ ] IncomeCalculator.ts
- [ ] LandValue.ts
- [ ] RCIDemand.ts
- [ ] ShoppingAccess.ts
- [ ] Tax.ts
- [ ] TaxMultipliers.ts

## core/service
- [ ] CivicService.ts
- [ ] DeathCareService.ts
- [ ] EducationService.ts
- [ ] FacilityOperational.ts
- [ ] FireDamageProcessor.ts
- [ ] FireService.ts
- [ ] GarbageService.ts
- [ ] GridCoverageArray.ts
- [ ] HealthService.ts
- [ ] NetworkCoverage.ts
- [ ] ParkService.ts
- [ ] PoliceService.ts
- [ ] PowerGrid.ts
- [ ] RadiusCoverageMap.ts
- [ ] RoadCoverageFlood.ts
- [ ] RoadCoverageService.ts
- [ ] ServiceCoverageQuery.ts
- [ ] ServiceDispatch.ts
- [ ] ServiceRegistry.ts
- [ ] SewageService.ts
- [ ] WaterNetwork.ts

## core/road
- [ ] RoadBuilder.ts
- [ ] RoadNetwork.ts
- [ ] RoadUpgrade.ts
- [ ] RoadValidation.ts
- [ ] Intersection.ts
- [ ] UnifiedRoadLookup.ts
- [ ] types.ts

## core/traffic
- [ ] TrafficSimulation.ts
- [ ] Pathfinding.ts
- [ ] LaneGraph.ts
- [ ] LaneGraphPathfinder.ts
- [ ] Congestion.ts
- [ ] CongestionFlowPredictor.ts
- [ ] TrafficLights.ts
- [ ] TrafficStats.ts
- [ ] PedestrianManager.ts
- [ ] PedestrianAgent.ts
- [ ] ServiceVehicleManager.ts
- [ ] VehicleClassification.ts
- [ ] VehicleLookahead.ts
- [ ] CrossEdgeCollision.ts
- [ ] EdgeInterpolation.ts
- [ ] BezierPath.ts
- [ ] SpatialHash.ts
- [ ] SidewalkGraph.ts
- [ ] Parking.ts
- [ ] CommuteCache.ts
- [ ] CommuteCacheHelpers.ts
- [ ] FreightSystem.ts
- [ ] FreightTradeCollector.ts
- [ ] HighwayConnection.ts
- [ ] ODPoolBuilder.ts
- [ ] PathWorkerClient.ts

## core/transport
- [ ] BaseTransportSystem.ts
- [ ] BusSystem.ts
- [ ] MetroSystem.ts
- [ ] MetroLinePath.ts
- [ ] MetroTunnelPath.ts
- [ ] RailSystem.ts
- [ ] RailLinePath.ts
- [ ] FerrySystem.ts
- [ ] FerryLinePath.ts
- [ ] AirportSystem.ts
- [ ] TransportRegistry.ts
- [ ] TransportPlacement.ts
- [ ] ModeChoice.ts
- [ ] MultiModalRouter.ts
- [ ] TransitAvailability.ts
- [ ] collectMetroTrains.ts
- [ ] collectTransportRoutes.ts
- [ ] collectTransportVehicles.ts
- [ ] types.ts

## core/rail
- [ ] RailBuilder.ts
- [ ] RailNetwork.ts
- [ ] LevelCrossingSystem.ts
- [ ] types.ts

## core/district
- [ ] DistrictManager.ts
- [ ] CitySpecialization.ts
- [ ] PolicyManager.ts
- [ ] Specialization.ts
- [ ] types.ts

## core/climate
- [ ] Climate.ts
- [ ] Damage.ts
- [ ] Disaster.ts
- [ ] WarningSystem.ts

## core/environment
- [ ] Pollution.ts
- [ ] CityMetrics.ts
- [ ] GridPollutionSources.ts
- [ ] NaturalResourceManager.ts
- [ ] PollutionSourceRegistry.ts
- [ ] SyncTrafficDensity.ts
- [ ] WaterFlow.ts

## core/elevation
- [ ] ElevationManager.ts
- [ ] ElevatedPath.ts
- [ ] ElevatedPathValidation.ts
- [ ] ElevatedRailBuilder.ts
- [ ] ElevatedRoadBuilder.ts
- [ ] ElevationMaintenance.ts
- [ ] ElevationZoneBlock.ts
- [ ] index.ts
- [ ] types.ts

## core/save
- [ ] SaveManager.ts
- [ ] SaveValidator.ts
- [ ] Serializer.ts
- [ ] AutoSave.ts
- [ ] ImportExport.ts
- [ ] migrations.ts

## core/graph
- [ ] GraphNetwork.ts

## core/overlay
- [ ] CoverageOverlay.ts
- [ ] OverlayBuilders.ts

## core/pathfinding
- [ ] WaterPathfinder.ts

## core/milestone
- [ ] Milestone.ts
- [ ] GreatWorks.ts

## core/zone
- [ ] DensityRules.ts
- [ ] ZoneManager.ts

## core/tutorial
- [ ] Tutorial.ts

## core/workplace
- [ ] WorkplaceDistanceCache.ts
- [ ] WorkplaceDistanceClient.ts
- [ ] WorkplaceDistanceTypes.ts

## core/utils
- [ ] random.ts
- [ ] recoverNextId.ts
- [ ] removeById.ts

## core
- [ ] ViewMode.ts
