/** Barrel export: the single entry point for every vehicle geometry builder. */
export { setVertexColors } from './common';
export { buildCarGeometry } from './car';
export { buildBusGeometry } from './bus';
export { buildTruckGeometry } from './truck';
export { buildFiretruckGeometry } from './firetruck';
export { buildPoliceCarGeometry } from './policeCar';
export { buildAmbulanceGeometry } from './ambulance';
export { buildGarbageTruckGeometry } from './garbageTruck';
export { buildVanGeometry } from './van';
export { buildMetroTrainGeometry, buildMetroCarriageGeometry } from './metro';
export { buildRailTrainGeometry, buildRailCarriageGeometry } from './railTrain';
export { buildFerryGeometry } from './ferry';

/** The transit system's bus: the same model as the road bus, coloured by update(). */
export { buildBusGeometry as buildTransportBusGeometry } from './bus';
export { buildAirplaneGeometry, buildAirplaneNavLightsGeometry, buildAirplaneVTailGeometry } from './airplane';
