/**
 * 向後相容轉發 — 所有幾何函式已移至 geometry/ 子目錄。
 * 現有的 import 路徑不會壞掉。
 */
export {
  setVertexColors,
  buildCarGeometry,
  buildBusGeometry,
  buildTruckGeometry,
  buildFiretruckGeometry,
  buildTransportBusGeometry,
  buildMetroTrainGeometry,
  buildMetroCarriageGeometry,
  buildRailTrainGeometry,
  buildFerryGeometry,
  buildTaxiGeometry,
} from './geometry';
