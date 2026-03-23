import { RoadType, RoadDirection } from '../road/types';
import { hasInwardFlag } from '../grid/EdgeUtils';
import { type ElevationManager } from '../elevation/ElevationManager';
import { MIN_ELEVATION_LEVEL, MAX_ELEVATION_LEVEL } from '../elevation/types';

export interface HighwayExternalConnection {
  populationIn: number;
  goodsIn: number;
  goodsOut: number;
}

export const HIGHWAY_EXTERNAL = {
  THROUGHPUT_PER_CONNECTION: 30,
  SPAWN_PER_100_POP: 1,
  MAX_PER_TICK: 3,
  CAP_RATIO: 0.9,
  MIDDAY_MULTIPLIER: 0.7,
  NIGHT_MULTIPLIER: 0.2,
} as const;

interface GridLike {
  getCell(x: number, y: number): { roadType: number; roadFlags: number } | null;
}

export class HighwayConnection {
  hasExternalConnection = false;
  externalConnection: HighwayExternalConnection = { populationIn: 0, goodsIn: 0, goodsOut: 0 };
  private edgeHighwayCells: { x: number; y: number }[] = [];

  getEdgeHighwayCells(): ReadonlyArray<{ x: number; y: number }> {
    return this.edgeHighwayCells;
  }

  getEdgeHighwayCellCount(): number {
    return this.edgeHighwayCells.length;
  }

  getThroughput(): number {
    return this.edgeHighwayCells.length * HIGHWAY_EXTERNAL.THROUGHPUT_PER_CONNECTION;
  }

  /**
   * Scan map border cells for HIGHWAY and update external connection state.
   * Called every 60 ticks from SimulationLoop.
   */
  private _elevationManager: ElevationManager | null = null;

  setElevationManager(em: ElevationManager): void {
    this._elevationManager = em;
  }

  updateExternalConnection(
    mapWidth: number,
    mapHeight: number,
    grid: GridLike,
  ): void {
    this.edgeHighwayCells = [];
    const seen = new Set<string>();

    const tryAdd = (x: number, y: number) => {
      const key = `${x},${y}`;
      if (seen.has(key)) return;
      seen.add(key);

      // Check ground-level highway
      const cell = grid.getCell(x, y);
      if (cell && cell.roadType === RoadType.HIGHWAY
          && hasInwardFlag(x, y, mapWidth, mapHeight, cell.roadFlags)) {
        this.edgeHighwayCells.push({ x, y });
        return;
      }

      // Check elevated highway segments at this edge cell
      if (this._elevationManager) {
        for (let lv = MIN_ELEVATION_LEVEL; lv <= MAX_ELEVATION_LEVEL; lv++) {
          const seg = this._elevationManager.get(x, y, lv);
          if (seg && seg.roadType === RoadType.HIGHWAY
              && hasInwardFlag(x, y, mapWidth, mapHeight, seg.roadFlags)) {
            this.edgeHighwayCells.push({ x, y });
            return;
          }
        }
      }
    };

    // Top and bottom edges
    for (let x = 0; x < mapWidth; x++) {
      tryAdd(x, 0);
      tryAdd(x, mapHeight - 1);
    }
    // Left and right edges (skip corners already covered)
    for (let y = 1; y < mapHeight - 1; y++) {
      tryAdd(0, y);
      tryAdd(mapWidth - 1, y);
    }

    this.hasExternalConnection = this.edgeHighwayCells.length > 0;

    if (this.hasExternalConnection) {
      const count = this.edgeHighwayCells.length;
      this.externalConnection = {
        populationIn: Math.max(1, count * 3),
        goodsIn: Math.max(1, count * 8),
        goodsOut: Math.max(1, count * 5),
      };
    } else {
      this.externalConnection = { populationIn: 0, goodsIn: 0, goodsOut: 0 };
    }
  }

  toJSON(): { hasExternalConnection: boolean; externalConnection: HighwayExternalConnection } {
    return {
      hasExternalConnection: this.hasExternalConnection,
      externalConnection: { ...this.externalConnection },
    };
  }

  static fromJSON(data: { hasExternalConnection: boolean; externalConnection: HighwayExternalConnection }): HighwayConnection {
    const hc = new HighwayConnection();
    hc.hasExternalConnection = data.hasExternalConnection;
    hc.externalConnection = { ...data.externalConnection };
    return hc;
  }
}
