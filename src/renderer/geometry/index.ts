/** Barrel export — 所有車輛幾何建構函式的統一匯出口。 */
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

/** 交通系統公車 — 與道路 bus 相同模型（由 update() 上色） */
export { buildBusGeometry as buildTransportBusGeometry } from './bus';
export { buildAirplaneGeometry, buildAirplaneNavLightsGeometry } from './airplane';
