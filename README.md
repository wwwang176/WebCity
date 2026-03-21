# WebCity

網頁版都市經營模擬遊戲，靈感來自 Cities: Skylines 與 SimCity。
在一塊空地上自由規劃道路、劃設區域、管理經濟與交通，打造一座活生生的城市。

## 快速開始

```bash
pnpm install
pnpm dev
```

開啟瀏覽器 `http://localhost:5173`，開始建造你的城市。

## 遊戲特色

- 3D Low Poly 等角視角，在瀏覽器中流暢運行
- 6 種道路類型 + 鐵路系統，自由規劃交通網路
- 6 種區域規劃（低/高密度住宅、商業、工業、辦公）
- 21 種區域建築，3 級升級系統
- 獨立市民模擬 — 每位市民擁有年齡、教育、幸福度、住所、工作
- 10 種市政服務（電力/供水/警察/消防/醫療/教育/垃圾/污水/殯葬/公園）
- 5 種大眾運輸（公車/地鐵/鐵路/渡輪/機場）
- 車道級交通模擬 — Bezier 曲線車道、紅綠燈、壅塞、行人
- 經濟系統 — 稅收、RCI 需求、預算、全球市場
- 環境模擬 — 污染擴散、天然資源、四季氣候
- 災害系統 — 地震、龍捲風、森林大火
- 行政區/政策/城市特化
- 里程碑解鎖 + 4 種偉大工程
- IndexedDB 本地存檔 + 自動存檔

## 技術架構

| 項目 | 選擇 |
|------|------|
| 語言 | TypeScript |
| 渲染 | Three.js (3D Low Poly) |
| 建構 | Vite |
| 測試 | Vitest (TDD, 1300+ 測試) |
| 套件管理 | pnpm |
| 多執行緒 | Web Workers (模擬/交通/尋路) |
| 資料同步 | SharedArrayBuffer + postMessage |
| UI | Preact / Solid |
| 存檔 | IndexedDB |

### 架構原則

```
Main Thread          Web Workers
┌──────────────┐     ┌─────────────────┐
│ Three.js 渲染 │     │ Pathfinding Pool│
│ UI (Preact)  │     │ Simulation      │
│ 輸入處理      │     │ Workplace Dist  │
└──────┬───────┘     └────────┬────────┘
       │  單向讀取              │
       ▼                      │
┌──────────────┐     SharedArrayBuffer
│   Core 邏輯   │◄────postMessage────┘
│ (純 TypeScript │
│  禁止 Three.js)│
└──────────────┘
```

- **Core 模組禁止 import Three.js** — 純邏輯，可獨立測試
- **渲染層單向讀取 Core 狀態** — 不回寫
- **模擬 Tick 與渲染幀脫鉤** — 邏輯穩定不受 FPS 影響
- **TDD 強制** — 所有新功能先寫測試再寫實作

## 專案結構

```
src/
├── core/               # 遊戲核心邏輯（純 TypeScript，無渲染依賴）
│   ├── grid/           #   網格、地形、座標系統
│   ├── road/           #   道路建設、路網圖
│   ├── rail/           #   鐵路、平交道
│   ├── zone/           #   區域規劃、密度規則
│   ├── building/       #   建築成長/升級/廢棄、基礎設施放置
│   ├── citizen/        #   市民生命週期、幸福度、移民、就業
│   ├── economy/        #   稅收、預算、地價、全球市場
│   ├── service/        #   電力/供水/警察/消防/醫療等 10 種服務
│   ├── traffic/        #   車道圖、車輛模擬、壅塞、行人
│   ├── transport/      #   公車/地鐵/鐵路/渡輪/機場
│   ├── district/       #   行政區、政策、特化
│   ├── environment/    #   污染、天然資源、水流
│   ├── climate/        #   季節、災害、預警
│   ├── simulation/     #   SimulationLoop、GameState、GameClock
│   ├── milestone/      #   里程碑、偉大工程
│   ├── overlay/        #   覆蓋層資料建構
│   ├── save/           #   序列化、存檔、遷移
│   ├── tutorial/       #   新手教程
│   └── utils/          #   共用工具函式
├── renderer/           # Three.js 渲染層
├── ui/                 # UI 元件
├── audio/              # 音效管理
├── workers/            # Web Worker 執行緒
├── Game.ts             # 遊戲主類（整合 Core + Renderer）
└── main.ts             # 進入點
docs/                   # 遊戲機制 Wiki（20 份文件）
```

## 遊戲機制 Wiki

完整的遊戲機制文件位於 [`docs/`](docs/index.md)，涵蓋所有系統的規則、數值和演算法。

### 城市建設

| 文件 | 內容 |
|------|------|
| [網格系統](docs/grid-system.md) | 世界結構、格子資料、地形生成、方向旗標 |
| [道路系統](docs/road-system.md) | 6 種道路、建設驗證、升級、路口、路網圖 |
| [鐵路系統](docs/rail-system.md) | 軌道建設、平交道、與道路共存規則 |
| [區域規劃](docs/zone-system.md) | 6 種區域類型、密度規則、規劃限制 |
| [建築系統](docs/building-system.md) | 21 種建築、成長/升級/廢棄機制、基礎設施 |

### 市民與經濟

| 文件 | 內容 |
|------|------|
| [市民系統](docs/citizen-system.md) | 生命週期、教育、幸福度、健康、移民、出生、搬遷、就業 |
| [經濟系統](docs/economy-system.md) | 雙軌稅制、RCI 需求、預算、地價、全球市場 |
| [區域與政策](docs/district-policy-system.md) | 行政區、5 種政策、7 種區域特化、7 種城市特化 |
| [里程碑](docs/milestone-greatworks.md) | 6 階里程碑解鎖、4 種偉大工程 |

### 服務與交通

| 文件 | 內容 |
|------|------|
| [市政服務](docs/services-system.md) | 10 種服務、道路距離覆蓋演算法、服務分數 |
| [交通系統](docs/traffic-system.md) | 車道圖、碰撞偵測、壅塞、紅綠燈、行人、通勤 |
| [大眾運輸](docs/transport-system.md) | 公車/地鐵/鐵路/渡輪/機場、模式選擇 |

### 環境與事件

| 文件 | 內容 |
|------|------|
| [環境系統](docs/environment-system.md) | 3 種污染、天然資源、水流、犯罪率 |
| [氣候與災害](docs/climate-disaster-system.md) | 四季效果、5 種天災、預警系統 |

### 介面與工具

| 文件 | 內容 |
|------|------|
| [模擬迴圈](docs/simulation-loop.md) | 遊戲時鐘、Tick 分層、完整執行順序 |
| [覆蓋層](docs/overlay-system.md) | 14 種地圖覆蓋層視覺化 |
| [存檔系統](docs/save-system.md) | 序列化、差分壓縮、版本遷移、Worker |
| [新手教程](docs/tutorial-system.md) | 9 步驟互動引導 |
| [除錯工具](docs/debug-viewmode.md) | Debug Panel、5 種 ViewMode |

## 開發

```bash
pnpm install     # 安裝依賴
pnpm dev         # 開發伺服器
pnpm test        # 執行測試
pnpm build       # 正式建構
```

## 授權

Private
