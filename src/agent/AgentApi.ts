import type { PlacementMode, ToolType } from '../Game';
import type { Rotation } from '../core/building/InfraConfig';

export type { PlacementMode, Rotation };

/**
 * 讓程式（而不是滑鼠）動手蓋東西的入口。
 *
 * ## 為什麼不直接呼叫 builder
 *
 * `RoadBuilder.buildRoad()` 之類的東西是 core 模組，從外面叫得到。但 `Game` 在呼叫
 * 它們之後還做了一整串**失效通知** —— `simLoop.markLaneGraphDirty()`、
 * `roadCoverageDirty`、`invalidateZoneBlockers()`。少掉任何一個，城市都會安靜地壞掉:
 * 通勤用的路網圖以 `commuteCache.roadGeneration` 為鍵快取，沒有通知就不會重算，
 * 於是市民繼續走一條已經被拆掉的路，而畫面上什麼都看不出來。
 *
 * 那一整串正確地寫在 `Game.handleToolAction()` 裡，而它**只吃格子座標，不吃滑鼠事件**。
 * 所以這一層要做的不是重寫，是把它包起來。
 *
 * ## 為什麼包一層而不是直接叫 handleToolAction
 *
 * `handleToolAction` 讀的是一組**留在 Game 上的狀態**:`currentTool`、`placementMode`、
 * `currentRoadType`、`elevationLevel`、`currentRotation`。而 `setTool()` 只對**非拖曳
 * 工具**重設 `placementMode` —— 道路與鐵軌會留著上一次的值。
 *
 * 後果很具體:玩家剛蓋完一段高架，`placementMode` 停在 `'elevated'`；程式接著
 * `setTool('road_2lane')` 再蓋路，**蓋出來的是高架橋，而且不會報錯**。
 *
 * 所以這裡每個動作都把**全部**相關狀態明寫一次，不繼承上一次留下的。
 */

/**
 * 這一層碰得到的東西。
 *
 * 用結構型別而不是直接收 `Game`,是為了能在沒有 Three.js 的情況下測 —— `Game` 一
 * import 就把整個渲染層拖進來。
 */
export interface ToolHost {
  currentTool: ToolType;
  placementMode: PlacementMode;
  elevationLevel: number;
  currentRotation: Rotation;
  /** 遊戲拒絕蓋的時候會把理由寫在這裡。 */
  notification: string | null;
  getState(): { readonly budget: { readonly funds: number } };
  setTool(tool: ToolType): void;
  handleToolAction(x1: number, y1: number, x2: number, y2: number): void;
}

export interface AgentAction {
  tool: ToolType;
  x1: number;
  y1: number;
  /** 省略就是單格。 */
  x2?: number;
  y2?: number;
  /** 只有道路與鐵軌吃得到;其餘工具給了也會被 `setTool` 蓋掉。 */
  elevated?: boolean;
  elevationLevel?: number;
  /** 角度，不是索引 —— `InfraConfig.Rotation` 是 0 / 90 / 180 / 270。 */
  rotation?: Rotation;
}

export interface AgentActionResult {
  /**
   * 遊戲沒有拒絕。
   *
   * **不等於「有東西改變」** —— 在已經有路的地方再蓋一次路不會被拒絕，也不會花錢。
   * `cost === 0 && ok` 多半代表這個動作什麼也沒做。要精確知道改了哪幾格，得在動作
   * 前後比對網格，那是還沒做的事。
   */
  ok: boolean;
  tool: ToolType;
  rect: { x1: number; y1: number; x2: number; y2: number };
  /** 花掉多少。負數代表退錢。 */
  cost: number;
  /** 被拒絕時遊戲自己的說法。 */
  reason?: string;
}

export const AGENT_LIMITS = {
  /**
   * 一次拆除最多幾格。
   *
   * 這個遊戲**沒有復原功能**（整個 repo 沒有 undo）。程式拆錯就只能重讀存檔。上限
   * 管的是單次動作的爆炸半徑 —— 拆一個街廓可以，拆掉半座城不行。
   */
  DEMOLISH_CELLS: 64,
  /** 動作記錄保留幾筆。 */
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
        // 連 handleToolAction 都不呼叫 —— 拒絕要發生在動手之前。
        return this.record({
          ok: false,
          tool: action.tool,
          rect,
          cost: 0,
          reason: `demolish area too large: ${cells} cells (limit ${AGENT_LIMITS.DEMOLISH_CELLS})`,
        });
      }
    }

    // 上一則通知還留著的話，會被當成這一次的失敗理由。
    this.host.notification = null;

    this.host.setTool(action.tool);
    // 順序是有意義的:`setTool` 自己會把 rotation 歸零、把非拖曳工具的 placementMode
    // 重設。這三行寫在它之後才有效。
    this.host.placementMode = action.elevated ? 'elevated' : 'ground';
    this.host.elevationLevel = action.elevationLevel ?? 1;
    this.host.currentRotation = action.rotation ?? 0;

    const fundsBefore = this.host.getState().budget.funds;
    this.host.handleToolAction(rect.x1, rect.y1, rect.x2, rect.y2);
    const cost = fundsBefore - this.host.getState().budget.funds;

    const reason = this.host.notification;
    return this.record({
      ok: reason === null,
      tool: action.tool,
      rect,
      cost,
      ...(reason === null ? {} : { reason }),
    });
  }

  /** 最近做過的事，新的在後面。 */
  history(): readonly AgentActionResult[] {
    return this.log.slice();
  }

  private record(result: AgentActionResult): AgentActionResult {
    this.log.push(result);
    if (this.log.length > AGENT_LIMITS.LOG_SIZE) this.log.shift();
    return result;
  }
}
