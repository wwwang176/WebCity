import type { PlacementMode, ToolType } from '../Game';
import type { Rotation } from '../core/building/InfraConfig';
import { EMPTY_DEMOLISH_TALLY, type DemolishTally } from '../core/building/DemolishTally';

export type { PlacementMode, Rotation };

/**
 * The entry point for building things from a program rather than a mouse.
 *
 * ## Why not call the builders directly
 *
 * `RoadBuilder.buildRoad()` and its kin are core modules, callable from outside. But `Game`
 * follows each call with a chain of **invalidations**: `simLoop.markLaneGraphDirty()`,
 * `roadCoverageDirty`, `invalidateZoneBlockers()`. Missing any one breaks the city silently:
 * the commute road graph is cached by `commuteCache.roadGeneration` and is not recomputed
 * without the notification, so citizens keep using a road that has been demolished and nothing
 * on screen shows it.
 *
 * That chain is written correctly in `Game.handleToolAction()`, which **takes cell coordinates,
 * not mouse events**. So this layer wraps it rather than reimplementing it.
 *
 * ## Why wrap rather than call handleToolAction directly
 *
 * `handleToolAction` reads a set of **state left on Game**: `currentTool`, `placementMode`,
 * `currentRoadType`, `elevationLevel`, `currentRotation`. And `setTool()` resets
 * `placementMode` only for **non-drag tools**, so roads and rails keep the previous value.
 *
 * The consequence is concrete: after the player builds an elevated section `placementMode` is
 * left at `'elevated'`, so a program that then calls `setTool('road_2lane')` and builds
 * **gets a bridge, with no error**.
 *
 * Every action here therefore writes **all** the relevant state explicitly rather than
 * inheriting what was left behind.
 */

/**
 * What this layer can reach.
 *
 * A structural type rather than `Game` itself, so it can be tested without Three.js: importing
 * `Game` pulls in the whole renderer.
 */
export interface ToolHost {
  currentTool: ToolType;
  placementMode: PlacementMode;
  elevationLevel: number;
  currentRotation: Rotation;
  /** Where the game writes its reason for refusing to build. */
  notification: string | null;
  /** What the district brush last did. `null` means that stroke was refused. */
  lastDistrictGesture: DistrictGesture;
  /** What the last demolition removed. `null` means nothing was demolished this round. */
  lastDemolishTally: DemolishTally | null;
  getState(): { readonly budget: { readonly funds: number } };
  setTool(tool: ToolType): void;
  handleToolAction(x1: number, y1: number, x2: number, y2: number): void;
}

/** The outcome of one district brush gesture. */
export type DistrictGesture = 'select' | 'deselect' | 'paint' | null;

export interface AgentAction {
  tool: ToolType;
  x1: number;
  y1: number;
  /** Omit for a single cell. */
  x2?: number;
  y2?: number;
  /** Honoured by roads and rails only; `setTool` overwrites it for every other tool. */
  elevated?: boolean;
  elevationLevel?: number;
  /** Degrees, not an index: `InfraConfig.Rotation` is 0 / 90 / 180 / 270. */
  rotation?: Rotation;
}

export interface AgentActionResult {
  /**
   * The game did not refuse.
   *
   * **Not the same as "something changed"**: building a road where one already exists is
   * neither refused nor charged for. `cost === 0 && ok` usually means the action did nothing.
   * Knowing exactly which cells changed would require diffing the grid around the action, which
   * is not implemented.
   */
  ok: boolean;
  tool: ToolType;
  rect: { x1: number; y1: number; x2: number; y2: number };
  /** How much was spent. Negative is a refund. */
  cost: number;
  /** The game's own wording when it refused. */
  reason?: string;
  /** The game said something despite succeeding (the district brush speaks on every stroke). */
  info?: string;
  /**
   * What this action demolished. **Present only for `demolish`**, and always present there — an
   * action stopped by the limit gets an all-zero tally.
   *
   * Demolition neither touches the wallet nor speaks, so `cost` is always 0 and `ok` always
   * true. Demolishing 42 cells and demolishing 0 produced word-for-word identical responses
   * (BUG-366), and this is the only thing that tells them apart.
   */
  demolished?: DemolishTally;
}

export const AGENT_LIMITS = {
  /**
   * The largest area one demolition may cover.
   *
   * The game **has no undo** anywhere in the repo, so a program that demolishes the wrong thing
   * can only reload a save. The limit bounds the blast radius of a single action: a block is
   * allowed, half a city is not.
   */
  DEMOLISH_CELLS: 64,
  /** How many action records are kept. */
  LOG_SIZE: 50,
} as const;

export class AgentApi {
  private readonly log: AgentActionResult[] = [];

  constructor(private readonly host: ToolHost) {}

  act(action: AgentAction): AgentActionResult {
    const x2 = action.x2 ?? action.x1;
    const y2 = action.y2 ?? action.y1;
    const rect = { x1: action.x1, y1: action.y1, x2, y2 };

    if (action.tool === 'demolish') {
      const cells = (Math.abs(x2 - action.x1) + 1) * (Math.abs(y2 - action.y1) + 1);
      if (cells > AGENT_LIMITS.DEMOLISH_CELLS) {
        // handleToolAction is not called at all: the refusal happens before anything is done.
        return this.record({
          ok: false,
          tool: action.tool,
          rect,
          cost: 0,
          demolished: { ...EMPTY_DEMOLISH_TALLY },
          reason: `demolish area too large: ${cells} cells (limit ${AGENT_LIMITS.DEMOLISH_CELLS})`,
        });
      }
    }

    // A leftover notification would be read as this action's failure reason.
    this.host.notification = null;
    this.host.lastDistrictGesture = null;
    // State left on Game like the notification: without clearing it, the previous demolition's
    // removals would be attributed to this action.
    this.host.lastDemolishTally = null;

    this.host.setTool(action.tool);
    // The order matters: `setTool` zeroes rotation and resets placementMode for non-drag tools,
    // so these three lines only take effect after it.
    this.host.placementMode = action.elevated ? 'elevated' : 'ground';
    this.host.elevationLevel = action.elevationLevel ?? 1;
    this.host.currentRotation = action.rotation ?? 0;

    const fundsBefore = this.host.getState().budget.funds;
    this.host.handleToolAction(rect.x1, rect.y1, rect.x2, rect.y2);
    const cost = fundsBefore - this.host.getState().budget.funds;

    const note = this.host.notification;
    // The district brush **speaks on every stroke**, deliberately: when the selected district is
    // off screen, "Downtown +15 cells" is the only trace. So its success cannot be read from
    // whether a notification appeared, only from what the brush actually did.
    const ok = action.tool === 'district'
      ? this.host.lastDistrictGesture !== null
      : note === null;

    return this.record({
      ok,
      tool: action.tool,
      rect,
      cost,
      ...(action.tool === 'demolish'
        ? { demolished: this.host.lastDemolishTally ?? { ...EMPTY_DEMOLISH_TALLY } }
        : {}),
      ...(note === null ? {} : ok ? { info: note } : { reason: note }),
    });
  }

  /** Recent actions, newest last. */
  history(): readonly AgentActionResult[] {
    return this.log.slice();
  }

  private record(result: AgentActionResult): AgentActionResult {
    this.log.push(result);
    if (this.log.length > AGENT_LIMITS.LOG_SIZE) this.log.shift();
    return result;
  }
}
