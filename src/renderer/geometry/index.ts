/** Barrel export — 所有車輛幾何建構函式的統一匯出口。 */
export { setVertexColors } from './common';
export { buildCarGeometry } from './car';
export { buildBusGeometry } from './bus';
export { buildTruckGeometry } from './truck';
export { buildFiretruckGeometry } from './firetruck';
export { buildMetroTrainGeometry, buildMetroCarriageGeometry } from './metro';
export { buildRailTrainGeometry, buildRailCarriageGeometry } from './railTrain';
export { buildFerryGeometry } from './ferry';

/** 計程車 — 與轎車相同模型（由 update() 上色） */
export { buildCarGeometry as buildTaxiGeometry } from './car';

/** 交通系統公車 — 與道路 bus 相同模型（由 update() 上色） */
export { buildBusGeometry as buildTransportBusGeometry } from './bus';
