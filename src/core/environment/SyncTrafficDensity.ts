/**
 * Syncs predicted traffic flow from TrafficSimulation (+ elevated roads)
 * into grid trafficDensity cells for noise pollution calculation.
 *
 * Extracted from SimulationLoop for SRP — traffic density sync is a
 * cross-cutting concern between traffic and environment subsystems.
 *
 * @param reusableFlowMap — Caller-owned Map reused across calls to avoid GC.
 *   Cleared at start and end (caller can inspect size === 0 to verify).
 */

interface TrafficDensitySource {
  getSegmentDensity(segmentKey: string): number;
}

interface ElevationSource {
  toJSON(): ReadonlyArray<{ x: number; y: number; level: number; data: { roadType: number } }>;
}

interface GridSink {
  forEachCell(fn: (cell: { roadType: number; trafficDensity: number }, x: number, y: number) => void): void;
  setField(x: number, y: number, field: string, value: number): void;
}

export function syncTrafficDensityToGrid(
  grid: GridSink,
  traffic: TrafficDensitySource,
  elevationManager: ElevationSource | null,
  reusableFlowMap: Map<string, number>,
): void {
  const maxFlow = reusableFlowMap;
  maxFlow.clear();

  // Ground-level roads
  grid.forEachCell((cell, x, y) => {
    if (cell.roadType === 0) return;
    const flow = traffic.getSegmentDensity(`${x},${y}`);
    if (flow > 0) maxFlow.set(`${x},${y}`, flow);
  });

  // Elevated roads: project flow to ground cell (take max)
  if (elevationManager) {
    for (const entry of elevationManager.toJSON()) {
      if (entry.data.roadType === 0) continue;
      const flow = traffic.getSegmentDensity(`${entry.x},${entry.y},${entry.level}`);
      if (flow > 0) {
        const key = `${entry.x},${entry.y}`;
        maxFlow.set(key, Math.max(maxFlow.get(key) ?? 0, flow));
      }
    }
  }

  // Write to grid with log scale
  grid.forEachCell((cell, x, y) => {
    const flow = maxFlow.get(`${x},${y}`) ?? 0;
    const scaled = flow > 0 ? Math.min(10, Math.round(Math.log2(1 + flow))) : 0;
    if (cell.trafficDensity !== scaled) {
      grid.setField(x, y, 'trafficDensity', scaled);
    }
  });

  // Clear reusable map (prevent stale data leaks between calls)
  maxFlow.clear();
}
