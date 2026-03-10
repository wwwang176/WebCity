import type { MetroSystem } from './MetroSystem';

export interface MetroTrainRenderData {
  id: number;
  lineId: number;
  fromStopIndex: number;
  toStopIndex: number;
  progress: number;       // 0..1
  atStop: boolean;
}

export function collectMetroTrainData(metro: MetroSystem): MetroTrainRenderData[] {
  const result: MetroTrainRenderData[] = [];
  for (const train of metro.getTrains()) {
    const info = metro.getTrainSegmentInfo(train);
    result.push({
      id: train.id,
      lineId: train.routeId,
      fromStopIndex: info.fromStopIndex,
      toStopIndex: info.toStopIndex,
      progress: info.progress,
      atStop: info.atStop,
    });
  }
  return result;
}
