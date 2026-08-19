/**
 * Simulation tuning constants — extracted from SimulationLoop to break
 * circular dependencies (CityHappinessContext/CityMetrics → SimulationLoop).
 */

import { DEFAULT_TAX_RATE } from '../economy/Tax';

/** Simulation tuning constants */
export const SIMULATION = {
  /** Ticks between service/RCI/growth updates */
  SLOW_TICK_INTERVAL: 6,
  /** Ticks between heavier computations: pollution, land value, vehicle spawning */
  MEDIUM_TICK_INTERVAL: 60,

  /**
   * 壅塞流量重算攤成幾個 tick。
   *
   * 比 MEDIUM_TICK_INTERVAL 小 —— 下一輪開始前這一輪要掃得完，不然永遠交不出件。
   */
  CONGESTION_FLOW_SPREAD_TICKS: 40,
  /** Ticks between job relocation checks */
  JOB_RELOCATION_INTERVAL: 60,
  /**
   * 換工作那一輪，每個 tick 最多做幾次距離查詢。
   *
   * 每個要換工作的市民都要一次 Dijkstra（家 → 所有可能的工作）。2436 人的
   * 城市裡實測一次約 4.3 毫秒、整輪約 340 次 = 1474 毫秒 —— 全部擠在同一個
   * tick 就是每隔幾秒卡一下（BUG-109）。
   *
   * 2 次 ≈ 9 毫秒，塞得進一個 60fps 的影格。整輪因此要 170 個 tick 才跑完，
   * 比原本的 60 慢 —— 換工作在遊戲時間裡變慢是刻意接受的代價，而且下一輪
   * 只在上一輪跑完之後才開始，所以它會自己節流。
   *
   * 這是止痛不是治本：總工作量沒有變。治本是讓 workplace 距離快取在有高架
   * 道路時也能用（BUG-109 的正解，記在 TODO）。
   */
  JOB_RELOCATION_SLICE: 2,
  /** Number of random cells sampled per growth tick */
  GROWTH_ATTEMPTS: 20,
  /** Chance per attempt for burned building auto-clearance */
  BURNED_CLEARANCE_CHANCE: 0.02,
  /** Default happiness used when city has no citizens */
  DEFAULT_HAPPINESS: 70,
  /** Business tax baseline — penalty applies above this rate */
  BUSINESS_TAX_BASELINE: DEFAULT_TAX_RATE,
  /** Demand penalty per percentage point above baseline */
  BUSINESS_TAX_PENALTY_PER_POINT: 2,
  /** Crime: max base crime rate */
  CRIME_BASE_MAX: 50,
  /** Crime: population factor for base crime */
  CRIME_POP_FACTOR: 0.02,
  /** Crime: coverage factor per police station */
  CRIME_COVERAGE_PER_STATION: 0.15,
  /** Crime: max reduction from police coverage */
  CRIME_MAX_REDUCTION: 0.6,
  /** Commute: max estimated average commute */
  COMMUTE_MAX: 25,
  /** Commute: base commute distance */
  COMMUTE_BASE: 1,
  /** Commute: multiplier for sqrt(resCount) */
  COMMUTE_SPREAD_FACTOR: 0.7,
  /** Commute: random jitter range */
  COMMUTE_JITTER: 6,
  /** Service coverage: power weight */
  SERVICE_POWER_WEIGHT: 2,
  /** Service coverage: water weight */
  SERVICE_WATER_WEIGHT: 2,
  /** Pollution threshold for service coverage bonus */
  LOW_POLLUTION_THRESHOLD: 10,
  /** Cell value maximum (uint8 range) */
  CELL_VALUE_MAX: 255,
  /** Vehicle cap: maximum vehicles on road */
  VEHICLE_CAP_MAX: 2000,
  /** Vehicle cap: base count */
  VEHICLE_CAP_BASE: 20,
  /** Vehicle cap: fraction of population */
  VEHICLE_CAP_POP_RATIO: 0.3,
  /** Ticks over which to spread commute spawning (higher = fewer vehicles per tick) */
  SPAWN_SPREAD_TICKS: 8,
  /** Minimum commute spawns per tick */
  MIN_SPAWN_PER_TICK: 5,
  /**
   * 背景補完通勤路線時，每個 tick 允許的**同步**路徑搜尋次數。
   *
   * 一次 `findLanePathVariants` 在 2 146 人的城市量到約 16 毫秒（內部最多跑
   * 4 次 A*），而一個 tick 在 1 倍速是 250 毫秒 —— 2 次就吃掉一成多。沒有
   * pathfinding worker 時（生產環境缺 COOP/COEP 就沒有 SharedArrayBuffer）
   * 只剩這條路，所以慢是刻意的：補得完比補得快重要。
   */
  COMMUTE_FILL_SEARCH_PER_TICK: 2,
  /** 有 worker 時每個 tick 排進去的路線數。排隊本身很便宜，算的人在別的執行緒。 */
  COMMUTE_FILL_ENQUEUE_PER_TICK: 32,
  /** 同一條路線最多試幾次就放棄，等下次路網改變。見 `commuteFillAttempts`。 */
  COMMUTE_FILL_MAX_ATTEMPTS: 3,
  /** 總覽面板要列出通勤最久的幾個住宅區。夠指出問題，不會變成一頁座標。 */
  COMMUTE_WORST_HOMES: 5,
  /** Commute sampling: minimum sample count */
  SAMPLE_COUNT_MIN: 50,
  /** Commute sampling: maximum sample count */
  SAMPLE_COUNT_MAX: 300,
  /** Commute sampling: eligible commuters per sample */
  SAMPLE_DIVISOR: 5,
  // 步行到站的上限已經依運具分開，見 core/transport/WalkRange —— 一個全域數字
  // 意味著公車站與捷運站的服務範圍一模一樣，而現實剛好相反。
  /** Max Manhattan distance for transfer walks between stops of different routes */
  TRANSFER_WALK_RANGE: 3,
  /**
   * 開車的參考速度（km/h）。模型裡「一格一 tick」就是這個速度。
   *
   * 這**不是速限**，是門到門的實際平均：路口、轉彎、找車位都算在內。速限是 50
   * （高速公路 100），但沒有人以速限完成一趟通勤。壅塞那一項
   * （`driveTime = 距離 × (1 + 壅塞)`）疊在這個平均之上，代表的是比平常更塞。
   *
   * 這個數字是整個時間尺度的分母。實測（見下）：拿速限當參考的話，走路貴到只有
   * 住在站牌隔壁的人肯搭大眾運輸，運輸系統形同虛設。
   */
  DRIVE_REFERENCE_KMH: 30,
  /** 走路速度（km/h）。 */
  WALK_KMH: 9,
  /**
   * 走路速度（格/tick）。
   *
   * 由上面兩個推導，不要各寫一個數字。這個值曾經是 1 —— 也就是走路跟開車一樣快，
   * 走一格到站牌跟開車走那一格成本相同。走遠路去搭車因此完全免費，唯一擋住它的
   * 是步行上限那個硬門檻。
   */
  WALK_SPEED: 9 / 30,
  /** Maximum legs per multi-modal trip (walk counts as a leg) */
  MAX_TRIP_LEGS: 7,
  /** Average wait = headway × this factor */
  AVERAGE_WAIT_FACTOR: 0.5,
  /** Industrial zone pollution reduction factor */
  INDUSTRIAL_POLLUTION_FACTOR: 0.2,
  /** Export demand base value for RCI calculation */
  EXPORT_DEMAND: 10,
  /** Fallback resident count when building type lookup fails */
  FALLBACK_RESIDENTS: 8,
  /** Population threshold before shopping access affects happiness */
  SHOPPING_POP_THRESHOLD: 50,
  /** Number of random cells sampled per upgrade tick */
  UPGRADE_ATTEMPTS: 30,
  /** Fraction of vehicle cap reserved for freight */
  FREIGHT_CAP_RATIO: 0.15,
  /** Throughput units per concurrent freight truck at a trade node */
  FREIGHT_TRUCKS_PER_THROUGHPUT: 10,
  /** Minimum Manhattan distance for commute trip */
  MANHATTAN_DISTANCE_THRESHOLD: 3,
  /** Abandonment: service normalization max (residential) */
  SERVICE_MAX_RES: 10,
  /** Abandonment: service normalization max (non-residential) */
  SERVICE_MAX_NON_RES: 6,
} as const;
